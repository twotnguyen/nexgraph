import { existsSync } from 'node:fs'
import type { IPty } from 'node-pty'

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

export interface TerminalSink {
  data(id: number, chunk: string): void
  exit(id: number, code: number): void
}

/** Các phiên terminal (pty) của app; mỗi phiên chạy trong gốc một dự án. */
export class TerminalManager {
  private readonly sessions = new Map<number, IPty>()
  private nextId = 1

  constructor(private readonly sink: TerminalSink) {}

  async create(cwd: string, cols: number, rows: number): Promise<{ id: number; shell: string }> {
    const { spawn } = await loadPty()
    const shell = defaultShell()
    const term = spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: Math.max(2, Math.floor(cols) || 80),
      rows: Math.max(1, Math.floor(rows) || 24),
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'NexGraph' } as Record<string, string>
    })
    const id = this.nextId++
    this.sessions.set(id, term)
    term.onData((chunk) => this.sink.data(id, chunk))
    term.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.sink.exit(id, exitCode)
    })
    return { id, shell: shell.file.split(/[\\/]/).pop() ?? shell.file }
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
