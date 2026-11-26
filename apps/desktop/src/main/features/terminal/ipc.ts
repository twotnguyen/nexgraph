import type { WebContents } from 'electron'
import { randomBytes } from 'node:crypto'
import type { TaskDefinition } from '../../../shared/api'
import { FsError } from '../../platform/project-fs'
import { type IpcContext, sendOwned } from '../../platform/ipc-context'
import { ensureTasksFile, listTasks, resolveTask } from './tasks'
import { createTaskSigner, taskContentKey } from './tasks/signature'
import { TerminalManager, resolveTerminalPath, validateTask } from './manager'
import { UserError } from '../../platform/user-error'

let terminals: TerminalManager | null = null
/** Khoá ký task sống theo phiên app: task renderer gửi lại phải do chính main cấp (REV-13). */
const taskSigner = createTaskSigner(randomBytes(32))

/** Giết terminal do một cửa sổ mở (reload, renderer chết, đóng cửa sổ). */
export const killTerminalsOwnedBy = (owner: WebContents): void => { terminals?.killOwned(owner) }
/** Giết mọi terminal khi thoát app. */
export const killAllTerminals = (): void => { terminals?.killAll() }

/** Terminal: shell của người dùng trong gốc dự án; dữ liệu về đúng cửa sổ đã mở terminal qua 'terminal:event'. */
export function registerTerminalIpc(ctx: IpcContext): void {
  const { on, onFrom, rootOf } = ctx
  const terminalManager = new TerminalManager({
    data: (id, chunk) => sendOwned(terminalManager.ownerOf(id), 'terminal:event', { id, type: 'data', data: chunk }),
    exit: (id, code) => sendOwned(terminalManager.ownerOf(id), 'terminal:event', { id, type: 'exit', code })
  })
  terminals = terminalManager
  const term = terminalManager
  // REV-13: task chỉ được chạy khi chính main ký — và main chỉ ký task khai trong tệp của dự án
  // (`tasks:resolve`). Chữ ký gắn projectId + root nên không replay sang dự án khác.
  // Đây là rào chắn cho *task*, không phải sandbox: terminal không task vẫn mở shell của người dùng.
  onFrom('terminal:create', async (owner, pid: string, cols: number, rows: number, task?: TaskDefinition) => {
    const root = await rootOf(pid)
    let approved: TaskDefinition | undefined
    if (task !== undefined) {
      validateTask(task)
      if (!taskSigner.verify({ projectId: pid, root }, task)) {
        throw new UserError('unapproved_task', 'Task không do NexGraph cấp, hãy chọn lại trong danh sách tác vụ.')
      }
      // Chỉ chuyển các trường đã ký; bỏ mọi thuộc tính lạ renderer gắn thêm.
      approved = { label: task.label, command: task.command, type: task.type, args: task.args, cwd: task.cwd, env: task.env }
    }
    return term.create(root, Number(cols), Number(rows), approved, owner)
  })
  /** Chỉ cửa sổ đã mở terminal mới được ghi/đổi kích thước/kill nó (id đoán được). */
  const ownsTerminal = (owner: WebContents, id: number): boolean => {
    const held = term.ownerOf(Number(id))
    return held === undefined || held === owner
  }
  onFrom('terminal:write', async (owner, id: number, data: string) => {
    if (ownsTerminal(owner, Number(id)) && typeof data === 'string') term.write(Number(id), data)
  })
  onFrom('terminal:resize', async (owner, id: number, cols: number, rows: number) => {
    if (ownsTerminal(owner, Number(id))) term.resize(Number(id), Number(cols), Number(rows))
  })
  onFrom('terminal:kill', async (owner, id: number) => { if (ownsTerminal(owner, Number(id))) term.kill(Number(id)) })
  on('terminal:resolve-path', async (pid: string, path: string) => resolveTerminalPath(await rootOf(pid), path))
  on('tasks:list', async (pid: string) => listTasks(await rootOf(pid)))
  on('tasks:config-file', async (pid: string) => ensureTasksFile(await rootOf(pid)))
  on('tasks:resolve', async (pid: string, task: TaskDefinition, context: { file?: string; line?: number }) => {
    validateTask(task)
    if (!context || typeof context !== 'object' ||
      (context.file !== undefined && typeof context.file !== 'string') ||
      (context.line !== undefined && (!Number.isInteger(context.line) || context.line < 1))) throw new FsError('bad_param', 'Ngữ cảnh task không hợp lệ')
    const root = await rootOf(pid)
    // Main tự đọc task của đúng dự án rồi so nội dung: renderer gửi task tự chế (command/args/env
    // tuỳ ý, lệnh gõ tay, hay task của dự án khác) không xin được chữ ký. Dùng bản của main để ký.
    const declared = (await listTasks(root)).find((candidate) => taskContentKey(candidate) === taskContentKey(task))
    if (!declared) throw new UserError('unapproved_task', 'Chỉ chạy được task khai trong .vscode/tasks.json hoặc .nexgraph/tasks.json của dự án.')
    return taskSigner.sign({ projectId: pid, root }, resolveTask(root, declared, context))
  })
}
