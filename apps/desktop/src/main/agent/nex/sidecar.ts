import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { safeProcessEnv } from '../../process-env'

/** Biến môi trường trỏ tới binary Nex bản dev/QA (thay cho binary đóng gói). */
export const NEX_BIN_ENV = 'NEX_OPENCODE_BIN'
export const NEX_MAX_RESTARTS = 3
const STARTUP_TIMEOUT_MS = 30_000
const READY_POLL_MS = 100
const STDERR_TAIL = 4000
const KILL_GRACE_MS = 3000

export type NexSidecarOptions = {
  bin: string
  /** `<userData>/nex`; mỗi dự án có HOME riêng bên dưới. */
  dataDir: string
  projectKey: string
  cwd: string
  config: () => Record<string, unknown>
  /** Env riêng của provider (có key). Không bao giờ được ghi ra đĩa/log. */
  env?: Record<string, string>
  envSource?: NodeJS.ProcessEnv
  spawnImpl?: typeof spawn
  fetchImpl?: typeof fetch
  startupTimeoutMs?: number
  maxRestarts?: number
  /** Nhận dòng log của tiến trình con (đã lọc) để chẩn đoán; không chứa key. */
  log?: (line: string) => void
}

export class NexStartError extends Error {
  constructor(message: string, public readonly stderrTail: string) {
    super(message)
    this.name = 'NexStartError'
  }
}

export type NexSidecarStatus = 'stopped' | 'starting' | 'running' | 'failed'

/**
 * Binary Nex: `NEXGRAPH_NEX_OPENCODE_BIN` (đặt tên qua NEX_BIN_ENV) → bản đóng gói
 * `<resources>/opencode/opencode` → `~/.opencode/bin/opencode` khi dev.
 */
export function resolveNexBinary(o: {
  env?: NodeJS.ProcessEnv
  isPackaged?: boolean
  resourcesPath?: string
  home?: string
  platform?: NodeJS.Platform
  exists?: (path: string) => boolean
} = {}): string | null {
  const platform = o.platform ?? process.platform
  const exe = platform === 'win32' ? 'opencode.exe' : 'opencode'
  const exists = o.exists ?? existsSync
  const candidates: string[] = []
  const fromEnv = (o.env ?? process.env)[NEX_BIN_ENV]
  if (fromEnv) candidates.push(fromEnv)
  if (o.isPackaged && o.resourcesPath) candidates.push(join(o.resourcesPath, 'opencode', exe))
  candidates.push(join(o.home ?? homedir(), '.opencode', 'bin', exe))
  return candidates.find((path) => exists(path)) ?? null
}

const basicAuth = (password: string): string => `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`

/**
 * Tiến trình `nex serve` (OpenCode) cô lập: HOME/XDG/OPENCODE_CONFIG_DIR trong `<userData>/nex/<dự án>`,
 * cổng ngẫu nhiên trên loopback, Basic Auth bằng mật khẩu mới mỗi lần chạy, giới hạn khởi động lại.
 */
export class NexSidecar {
  private child: ChildProcess | null = null
  private password = ''
  private baseUrl = ''
  private restarts = 0
  private stopped = true
  private startup: Promise<{ baseUrl: string; password: string }> | null = null
  private stderrTail = ''
  private restartTimer: NodeJS.Timeout | null = null
  private exitListeners = new Set<(code: number | null) => void>()
  private _status: NexSidecarStatus = 'stopped'

  constructor(private readonly o: NexSidecarOptions) {}

  get status(): NexSidecarStatus { return this._status }
  get isRunning(): boolean { return this._status === 'running' }
  get url(): string { return this.baseUrl }
  /** Mật khẩu chỉ dùng cho client HTTP trong bộ nhớ, không ghi ra đĩa. */
  get secret(): string { return this.password }

  private get home(): string { return join(this.o.dataDir, this.o.projectKey, 'home') }

  async start(): Promise<{ baseUrl: string; password: string }> {
    if (this._status === 'running') return { baseUrl: this.baseUrl, password: this.password }
    if (this.startup) return this.startup
    this.stopped = false
    this.restarts = 0
    this._status = 'starting'
    const run = this.spawnOnce().catch((error: unknown) => {
      this._status = 'failed'
      this.startup = null
      throw error
    })
    this.startup = run
    return run
  }

  private async spawnOnce(): Promise<{ baseUrl: string; password: string }> {
    if (this.stopped) throw new NexStartError('Đã dừng tiến trình Nex', this.stderrTail)
    const home = this.home
    const configDir = join(home, '.config', 'opencode')
    mkdirSync(configDir, { recursive: true })
    writeFileSync(join(configDir, 'opencode.json'), `${JSON.stringify(this.o.config(), null, 2)}\n`, { mode: 0o600 })
    const password = randomBytes(24).toString('base64url')
    const env = safeProcessEnv(this.o.envSource ?? process.env, {
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_STATE_HOME: join(home, '.local', 'state'),
      XDG_CACHE_HOME: join(home, '.cache'),
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      ...(this.o.env ?? {})
    })
    const spawnImpl = this.o.spawnImpl ?? spawn
    const child = spawnImpl(this.o.bin, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
      cwd: this.o.cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    })
    this.child = child
    this.password = password
    this.stderrTail = ''
    let buffered = ''
    let stderr = ''
    let port = 0
    child.stdout?.on('data', (chunk: Buffer | string) => {
      buffered += chunk.toString()
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        const match = /server listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(line)
        if (match) port = Number(match[1])
        this.o.log?.(line)
      }
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL)
      this.stderrTail = stderr
      for (const line of chunk.toString().split('\n')) if (line) this.o.log?.(line)
    })
    child.once('exit', (code, signal) => this.onChildExit(code, signal))
    let spawnError: Error | null = null
    child.once('error', (error: Error) => { spawnError = error })
    try {
      const ready = await this.waitReady(child, () => port, this.o.startupTimeoutMs ?? STARTUP_TIMEOUT_MS, () => spawnError)
      const baseUrl = `http://127.0.0.1:${ready}`
      const fetchImpl = this.o.fetchImpl ?? fetch
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null) throw new NexStartError('Tiến trình Nex thoát khi khởi động', this.stderrTail)
        try {
          const response = await fetchImpl(`${baseUrl}/api/info`, { headers: { Authorization: basicAuth(password) }, signal: AbortSignal.timeout(2_000) })
          if (response.ok) {
            this.baseUrl = baseUrl
            this._status = 'running'
            this.startup = null
            return { baseUrl, password }
          }
        } catch { /* chưa sẵn sàng */ }
        await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS))
      }
      throw new NexStartError('Tiến trình Nex không phản hồi sau khi khởi động', this.stderrTail)
    } catch (error) {
      // Mọi lỗi khởi động đều phải thu hồi child và đợi nó thoát: binary sống nhưng không báo
      // ready không được để lại tiến trình mồ côi.
      await this.terminate(child)
      throw error
    }
  }

  /** SIGTERM rồi SIGKILL sau thời gian chờ; resolve khi child đã thoát (hoặc không còn sống). */
  private async terminate(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, KILL_GRACE_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }

  /** Chờ dòng `server listening on …` hoặc tiến trình thoát/lỗi spawn. */
  private waitReady(child: ChildProcess, port: () => number, timeoutMs: number, spawnError?: () => Error | null): Promise<number> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now()
      const timer = setInterval(() => {
        const failed = spawnError?.()
        if (failed) {
          clearInterval(timer)
          reject(new NexStartError(`Không chạy được tiến trình Nex: ${failed.message}`, this.stderrTail))
          return
        }
        if (port() > 0) {
          clearInterval(timer)
          resolve(port())
          return
        }
        if (child.exitCode !== null || child.signalCode !== null) {
          clearInterval(timer)
          reject(new NexStartError('Tiến trình Nex thoát trước khi sẵn sàng', this.stderrTail))
          return
        }
        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer)
          reject(new NexStartError('Hết thời gian chờ tiến trình Nex khởi động', this.stderrTail))
        }
      }, 20)
    })
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    const wasRunning = this._status === 'running'
    this.child = null
    this.baseUrl = ''
    if (this.stopped) {
      this._status = 'stopped'
      return
    }
    // Thoát khi đang khởi động: để `waitReady`/`/api/info` báo lỗi, không khởi động lại vô hạn.
    if (!wasRunning) {
      this._status = 'failed'
      return
    }
    for (const listener of [...this.exitListeners]) {
      try { listener(code ?? (signal ? 1 : null)) } catch { /* listener của app không được làm sập sidecar */ }
    }
    const max = this.o.maxRestarts ?? NEX_MAX_RESTARTS
    if (this.restarts >= max) {
      this._status = 'failed'
      return
    }
    this.restarts++
    this._status = 'starting'
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.stopped) return
      void this.spawnOnce().catch(() => { this._status = 'failed' })
    }, 250)
  }

  /** Theo dõi tiến trình chết bất thường (sau khi đã sẵn sàng). Trả hàm huỷ đăng ký. */
  onUnexpectedExit(listener: (code: number | null) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  async stop(): Promise<void> {
    this.stopped = true
    this._status = 'stopped'
    this.startup = null
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    this.child = null
    this.baseUrl = ''
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, KILL_GRACE_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }
}
