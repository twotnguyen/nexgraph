import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import type { IPty } from 'node-pty'
import type { TaskDefinition } from '../../shared/api'
import { resolveInside } from '../fs/project-fs'
import { userShellEnv } from '../process-env'
import { shellQuote } from './quote'
import { UserError } from '../user-error'

type PtyModule = typeof import('node-pty')
// Nạp khi mở terminal đầu tiên: module native, không cần lúc khởi động app.
let pty: PtyModule | null = null
const loadPty = async (): Promise<PtyModule> => (pty ??= await import('node-pty'))

/** Shell mặc định của người dùng, như terminal của Wu: $SHELL trên macOS/Linux, PowerShell (hoặc COMSPEC) trên Windows. */
export function defaultShell(platform = process.platform, env = process.env): { file: string; args: string[] } {
  if (platform === 'win32') {
    const pwsh = `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    return existsSync(pwsh) ? { file: pwsh, args: ['-NoLogo'] } : { file: env.COMSPEC ?? 'cmd.exe', args: [] }
  }
  const shell = env.SHELL && existsSync(env.SHELL) ? env.SHELL : platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  // Shell đăng nhập để nạp PATH của người dùng (app mở từ Finder không có PATH của shell).
  return { file: shell, args: ['-l'] }
}

/** Đường dẫn trên terminal chỉ mở được tệp thực sự trong dự án. */
export function resolveTerminalPath(root: string, path: string): string | null {
  if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path)) return null
  try {
    const realRoot = realpathSync.native(root)
    const abs = resolveInside(realRoot, path)
    return statSync(abs).isFile() ? relative(realRoot, abs).split(sep).join('/') : null
  } catch {
    return null
  }
}

export function validateTask(task: unknown): asserts task is TaskDefinition {
  if (!task || typeof task !== 'object') throw new UserError('bad_task', 'Task không hợp lệ')
  const t = task as Record<string, unknown>
  if (typeof t.label !== 'string' || typeof t.command !== 'string' || !t.command.trim() ||
    (t.type !== undefined && t.type !== 'shell' && t.type !== 'process') ||
    (t.cwd !== undefined && typeof t.cwd !== 'string') ||
    (t.args !== undefined && (!Array.isArray(t.args) || t.args.some((arg) => typeof arg !== 'string'))) ||
    (t.env !== undefined && (!t.env || typeof t.env !== 'object' || Array.isArray(t.env) || Object.values(t.env).some((v) => typeof v !== 'string')))) {
    throw new UserError('bad_task', 'Task không hợp lệ')
  }
}

function shellTask(shell: string, task: TaskDefinition): string[] {
  const windows = process.platform === 'win32'
  const cmd = windows && /^cmd(?:\.exe)?$/i.test(basename(shell))
  const quote = shellQuote(shell)
  const command = [task.command, ...(task.args ?? []).map(quote)].join(' ')
  return windows ? cmd ? ['/d', '/s', '/c', command] : ['-NoLogo', '-Command', command] : ['-l', '-c', command]
}

export interface TerminalSink {
  data(id: number, chunk: string): void
  exit(id: number, code: number): void
}

/** Các phiên terminal (pty) của app; mỗi phiên chạy trong gốc một dự án. */
export class TerminalManager {
  private readonly sessions = new Map<number, IPty>()
  private nextId = 1

  constructor(private readonly sink: TerminalSink) {}

  async create(root: string, cols: number, rows: number, task?: TaskDefinition): Promise<{ id: number; shell: string; cwd: string }> {
    if (task !== undefined) validateTask(task)
    const { spawn } = await loadPty()
    const shell = defaultShell()
    const cwd = task?.cwd ? resolveInside(root, relative(root, resolve(root, task.cwd))) : root
    const program = task?.type === 'process' ? task.command : shell.file
    const args = task?.type === 'process' ? task.args ?? [] : task ? shellTask(shell.file, task) : shell.args
    let term: IPty
    try {
      term = spawn(program, args, {
        name: 'xterm-256color',
        cols: Math.max(2, Math.floor(cols) || 80),
        rows: Math.max(1, Math.floor(rows) || 24),
        cwd,
        // Shell của người dùng: giữ env người dùng (CLI aws/gh/npm của họ cần), chỉ bỏ NEXGRAPH_TOKEN.
        env: userShellEnv(process.env, { ...task?.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'NexGraph' }) as Record<string, string>
      })
    } catch (error) {
      throw new UserError('terminal_spawn', `Không mở được ${program}: ${error instanceof Error ? error.message : String(error)}`)
    }
    const id = this.nextId++
    this.sessions.set(id, term)
    term.onData((chunk) => this.sink.data(id, chunk))
    term.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.sink.exit(id, exitCode)
    })
    return { id, shell: basename(shell.file), cwd }
  }

  write(id: number, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: number, cols: number, rows: number): void {
    if (cols >= 2 && rows >= 1) this.sessions.get(id)?.resize(Math.floor(cols), Math.floor(rows))
  }

  kill(id: number): void {
    this.sessions.get(id)?.kill()
    this.sessions.delete(id)
  }

  killAll(): void {
    for (const term of this.sessions.values()) term.kill()
    this.sessions.clear()
  }
}
