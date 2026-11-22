import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs'
import type { BigIntStats } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import type { TaskDefinition } from '../../shared/api'
import { toProjectRelative } from '../agent/approval'
import { isProtectedRel, isWithin, MAX_EDIT_BYTES, resolveInside, writeProjectFile } from '../fs/project-fs'
import { UserError } from '../user-error'

type TaskSource = '.nexgraph/tasks.json' | '.vscode/tasks.json'

const readError = (source: TaskSource) => new UserError('tasks_read_failed', `Không thể đọc tệp ${source}.`)

function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
}

function readTasksFile(root: string, source: TaskSource): string | null {
  let fd: number | undefined
  try {
    const realRoot = realpathSync.native(root)
    const path = join(realRoot, source)
    // .nexgraph is intentionally protected by resolveInside; only this fixed file is allowed here.
    if (!isWithin(realRoot, path)) throw new UserError('outside_project', `Tệp ${source} nằm ngoài dự án.`)
    let target: string
    try {
      target = realpathSync.native(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && isWithin(realRoot, path)) return null
      throw error
    }
    if (!isWithin(realRoot, target)) throw new UserError('outside_project', `Tệp ${source} nằm ngoài dự án.`)
    const targetRel = relative(realRoot, target)
    if (isProtectedRel(targetRel) && !(source === '.nexgraph/tasks.json' && targetRel.toLowerCase() === join('.nexgraph', 'tasks.json'))) {
      throw new UserError('protected_path', `Tệp ${source} trỏ đến đường dẫn được bảo vệ.`)
    }
    fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    const before = fstatSync(fd, { bigint: true })
    if (!before.isFile() || before.size > BigInt(MAX_EDIT_BYTES)) throw readError(source)
    const unchanged = () => realpathSync.native(path) === target && isWithin(realRoot, path) &&
      sameFile(before, lstatSync(target, { bigint: true })) && sameFile(before, fstatSync(fd!, { bigint: true }))
    if (!unchanged()) throw readError(source)
    const buffer = Buffer.allocUnsafe(Number(before.size) + 1)
    let count = 0
    while (count < buffer.length) {
      const read = readSync(fd, buffer, count, buffer.length - count, null)
      if (read === 0) break
      count += read
    }
    if (count !== Number(before.size) || !unchanged()) throw readError(source)
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count))
  } catch (error) {
    if (error instanceof UserError) throw error
    throw readError(source)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function parseJsonc(input: string): unknown {
  let withoutComments = ''
  let quoted = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (quoted) {
      withoutComments += c
      if (c === '\\' && i + 1 < input.length) withoutComments += input[++i]
      else if (c === '"') quoted = false
    } else if (c === '"') {
      quoted = true
      withoutComments += c
    } else if (c === '/' && input[i + 1] === '/') {
      withoutComments += ' '
      i += 2
      while (i < input.length && input[i] !== '\n' && input[i] !== '\r') i++
      i--
    } else if (c === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2)
      if (end < 0) throw new SyntaxError('Unterminated comment')
      withoutComments += ' '
      i = end + 1
    } else {
      withoutComments += c
    }
  }

  let json = ''
  let previous = ''
  quoted = false
  for (let i = 0; i < withoutComments.length; i++) {
    const c = withoutComments[i]
    if (quoted) {
      json += c
      if (c === '\\' && i + 1 < withoutComments.length) json += withoutComments[++i]
      else if (c === '"') { quoted = false; previous = c }
    } else if (c === '"') {
      quoted = true
      json += c
    } else {
      if (c === ',') {
        let next = i + 1
        while (next < withoutComments.length && /[ \t\r\n]/.test(withoutComments[next])) next++
        if ((withoutComments[next] === ']' || withoutComments[next] === '}') && previous && !'[{,:'.includes(previous)) continue
      }
      json += c
      if (!/[ \t\r\n]/.test(c)) previous = c
    }
  }
  return JSON.parse(json.replace(/^\uFEFF/, ''))
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function taskDefinition(value: unknown): TaskDefinition | null {
  if (!record(value) || typeof value.label !== 'string' || !value.label.trim() ||
      typeof value.command !== 'string' || !value.command.trim() ||
      (value.type !== undefined && value.type !== 'shell' && value.type !== 'process') ||
      (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every((arg: unknown) => typeof arg === 'string'))) ||
      (value.options !== undefined && !record(value.options))) return null

  const options = record(value.options) ? value.options : undefined
  const cwd = value.cwd !== undefined ? value.cwd : options?.cwd
  const rawEnv = value.env !== undefined ? value.env : options?.env
  if (cwd !== undefined && typeof cwd !== 'string') return null
  let env: Record<string, string> | undefined
  if (rawEnv !== undefined) {
    if (!record(rawEnv) || !Object.values(rawEnv).every((entry) => typeof entry === 'string')) return null
    env = Object.fromEntries(Object.entries(rawEnv)) as Record<string, string>
  }

  return {
    label: value.label,
    command: value.command,
    ...(value.type !== undefined ? { type: value.type } : {}),
    ...(value.args !== undefined ? { args: value.args as string[] } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(env !== undefined ? { env } : {})
  }
}

export async function listTasks(root: string): Promise<TaskDefinition[]> {
  const tasks: TaskDefinition[] = []
  for (const source of ['.nexgraph/tasks.json', '.vscode/tasks.json'] as const) {
    const contents = readTasksFile(root, source)
    if (contents === null) continue
    let items: unknown[]
    try {
      const data = parseJsonc(contents)
      const list = source === '.nexgraph/tasks.json' && Array.isArray(data) ? data : record(data) ? data.tasks : undefined
      if (!Array.isArray(list)) throw new SyntaxError('Invalid task list')
      items = list
    } catch {
      throw new UserError('invalid_tasks', `Tệp ${source} có cấu hình tác vụ không hợp lệ.`)
    }
    for (const item of items) {
      const task = taskDefinition(item)
      if (task) tasks.push(task)
    }
  }
  return tasks
}

const TASK_SAMPLE = '// Cấu hình task (cú pháp VS Code tasks.json, cho phép chú thích).\n' +
  JSON.stringify({ version: '2.0.0', tasks: [] }, null, 2) + '\n'

/** Tệp cấu hình để mở trong editor: `.vscode/tasks.json` đã có hoặc mẫu vừa tạo. */
export async function ensureTasksFile(root: string): Promise<string> {
  if (readTasksFile(root, '.vscode/tasks.json') === null) {
    await writeProjectFile(root, '.vscode/tasks.json', TASK_SAMPLE, { eol: '\n', bom: false, expectedVersion: null })
  }
  return '.vscode/tasks.json'
}

export function resolveTask(root: string, task: TaskDefinition, context: { file?: string; line?: number }): TaskDefinition {
  const workspace = resolveInside(root, '.')
  const file = context.file ? resolveInside(root, toProjectRelative(root, context.file)) : undefined
  const values: Record<string, string | undefined> = {
    workspaceFolder: workspace,
    file,
    relativeFile: file === undefined ? undefined : relative(workspace, file),
    fileBasename: file === undefined ? undefined : basename(file),
    fileDirname: file === undefined ? undefined : dirname(file),
    lineNumber: context.line === undefined ? undefined : String(context.line)
  }
  const zed: Record<string, string> = {
    ZED_WORKTREE_ROOT: 'workspaceFolder', ZED_FILE: 'file', ZED_RELATIVE_FILE: 'relativeFile',
    ZED_FILENAME: 'fileBasename', ZED_DIRNAME: 'fileDirname', ZED_ROW: 'lineNumber'
  }
  const expand = (value: string) => value.replace(
    /\$\{(workspaceFolder|file|relativeFile|fileBasename|fileDirname|lineNumber|ZED_WORKTREE_ROOT|ZED_RELATIVE_FILE|ZED_FILENAME|ZED_DIRNAME|ZED_FILE|ZED_ROW)\}|\$(ZED_WORKTREE_ROOT|ZED_RELATIVE_FILE|ZED_FILENAME|ZED_DIRNAME|ZED_FILE|ZED_ROW)(?![A-Za-z0-9_])/g,
    (match: string, name: string | undefined, zedName: string | undefined) => {
      const key = name ?? zedName!
      const result = values[zed[key] ?? key]
      if (result === undefined) throw new UserError('missing_task_context', `Không có ngữ cảnh cho biến ${match}.`)
      return result
    }
  )
  return {
    ...task,
    label: expand(task.label),
    command: expand(task.command),
    ...(task.args !== undefined ? { args: task.args.map(expand) } : {}),
    ...(task.cwd !== undefined ? { cwd: expand(task.cwd) } : {}),
    ...(task.env !== undefined ? { env: Object.fromEntries(Object.entries(task.env).map(([key, value]) => [key, expand(value)])) } : {})
  }
}
