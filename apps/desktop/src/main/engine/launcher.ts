import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { safeProcessEnv } from '../process-env'

export interface EngineCommand {
  command: string
  args: string[]
  cwd?: string
}

export interface EngineHandle {
  baseUrl: string
  token: string
  pid: number
  /** Diệt cả cây tiến trình; resolve khi đã thoát. */
  stop(): Promise<void>
  onExit(cb: (code: number | null, signal: NodeJS.Signals | null) => void): void
}

const STDERR_TAIL = 4000
const KILL_GRACE_MS = 3000

/** Biến của tiến trình cha đổi cách Python tìm gói; engine phải chạy bằng môi trường của chính nó. */
const PYTHON_ISOLATION = ['PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP']

/**
 * Biến ngoài danh sách hệ thống mà engine cần: `gh` đọc token từ biến môi trường
 * (GH_TOKEN/GITHUB_TOKEN) cho tính năng Pull request; engine gọi `gh pr list|view|diff` (chỉ đọc)
 * bằng env kế thừa nên bỏ hai biến này là tab Pull request mất đăng nhập khi người dùng dùng
 * token qua env thay vì `gh auth login`.
 */
const ENGINE_PASSTHROUGH = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR', 'XDG_CONFIG_HOME']
/** NEXGRAPH_* là cấu hình nội bộ của engine (token, chế độ hook, số worker…). */
const ENGINE_PREFIX = /^NEXGRAPH_/i

/**
 * Env cho engine: chỉ biến hệ thống trong `safeProcessEnv` (REV-14) + `ENGINE_PASSTHROUGH` +
 * NEXGRAPH_*, bỏ PYTHONPATH/PYTHONHOME/PYTHONSTARTUP. App mở từ shell có PYTHONPATH của công cụ
 * khác (Hermes, pipx…) làm `serve` chết ở import
 * (`ImportError: cannot import name 'ArgsKwargs' from 'pydantic_core._pydantic_core'`).
 * Engine parse mã của dự án (không tin được) nên không được nhận AWS_*, token npm, SSH agent…
 */
export function engineEnv(source: NodeJS.ProcessEnv = process.env, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const passthrough: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && (ENGINE_PREFIX.test(key) || ENGINE_PASSTHROUGH.includes(key.toUpperCase()))) {
      passthrough[key] = value
    }
  }
  const env: NodeJS.ProcessEnv = safeProcessEnv(source, { ...passthrough, ...extra })
  for (const key of Object.keys(env)) {
    if (PYTHON_ISOLATION.includes(key.toUpperCase())) delete env[key]
  }
  return { ...env, PYTHONNOUSERSITE: '1', PYTHONUTF8: '1' }
}

export class EngineStartError extends Error {
  constructor(
    message: string,
    public readonly pid: number,
    public readonly stderrTail: string,
    /** Khoá i18n của `message` (main không biết ngôn ngữ UI; renderer dịch). */
    public readonly messageKey?: string,
    public readonly messageVars?: Record<string, string | number>
  ) {
    super(message)
    this.name = 'EngineStartError'
  }
}

/** Gửi tín hiệu theo PID/nhóm của tiến trình đã spawn, có phương án khi taskkill bị từ chối. */
export function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): Promise<void> {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      const fallback = () => {
        if (child.exitCode === null && child.signalCode === null) {
          if (signal === 'SIGTERM' && child.stdin) child.stdin.destroy() // Engine và tiến trình Python con nghe EOF.
          else child.kill(signal)
        }
        resolve()
      }
      const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      taskkill.once('error', fallback)
      taskkill.once('exit', (code) => {
        if (code !== 0) fallback()
        else resolve()
      })
    })
  }
  try { process.kill(-pid, signal) } catch { child.kill(signal) }
  return Promise.resolve()
}

export function startEngine(
  cmd: EngineCommand,
  opts: { dataDir: string; readyTimeoutMs?: number; env?: NodeJS.ProcessEnv }
): Promise<EngineHandle> {
  const token = randomBytes(32).toString('hex')
  const isWin = process.platform === 'win32'
  const child = spawn(cmd.command, [...cmd.args, 'serve', '--data-dir', opts.dataDir, '--port', '0', '--exit-on-stdin-close'], {
    cwd: cmd.cwd,
    // Token chỉ đi qua biến môi trường, không bao giờ qua argv. `opts.env` là biến main đặt thêm
    // (test hook), không phải env kế thừa từ shell — env kế thừa đi qua allowlist của `engineEnv`.
    env: engineEnv(process.env, { ...opts.env, NEXGRAPH_TOKEN: token }),
    windowsHide: true,
    // Nơi khác Windows: tạo nhóm tiến trình riêng để diệt được cả cây (ví dụ `uv run` -> python).
    detached: !isWin,
    // stdin là sợi dây sống: cha chết thì pipe đóng, engine thấy EOF và tự thoát.
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const pid = child.pid ?? -1

  let stderrTail = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL)
  })

  let exited = false
  let exitInfo: [number | null, NodeJS.Signals | null] = [null, null]
  const exitCbs: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []
  child.once('exit', (code, signal) => {
    exited = true
    exitInfo = [code, signal]
    exitCbs.forEach((cb) => cb(code, signal))
  })
  // uv có thể thoát trước Python. close chờ cả các pipe mà tiến trình con vẫn đang giữ.
  const closePromise = new Promise<void>((resolve) => {
    child.once('close', () => resolve())
  })

  let stopping: Promise<void> | undefined
  const stop = (): Promise<void> => {
    // Spawn thất bại không có PID và có thể không phát sự kiện exit.
    if (pid < 0) return Promise.resolve()
    stopping ??= (async () => {
      let forced: Promise<void> | undefined
      const timer = setTimeout(() => { forced = signalProcessTree(child, 'SIGKILL') }, KILL_GRACE_MS)
      try {
        // taskkill phải hoàn tất trước khi báo đã dừng cả cây, kể cả uv đã phát exit.
        await signalProcessTree(child, 'SIGTERM')
        await closePromise
        await forced
      } finally {
        clearTimeout(timer)
      }
      // Một số tiến trình con có thể còn sót trong nhóm sau khi tiến trình đầu đã thoát.
      if (!isWin) {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          /* nhóm đã trống */
        }
      }
    })()
    return stopping
  }

  return new Promise<EngineHandle>((resolve, reject) => {
    let settled = false
    const fail = async (message: string, messageKey?: string, messageVars?: Record<string, string | number>): Promise<void> => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      await stop()
      reject(new EngineStartError(message, pid, stderrTail, messageKey, messageVars))
    }

    const readyMs = opts.readyTimeoutMs ?? 20000
    const timeout = setTimeout(() => void fail(`Engine không sẵn sàng sau ${readyMs} ms`,
      'Engine không sẵn sàng sau {ms} ms', { ms: readyMs }), readyMs)

    child.once('error', (err) => void fail(`Không khởi động được engine: ${err.message}`,
      'Không khởi động được engine: {message}', { message: err.message }))
    child.once('exit', (code) => void fail(`Engine thoát trước khi sẵn sàng (exit ${code})`,
      'Engine thoát trước khi sẵn sàng (exit {code})', { code: code ?? 'unknown' }))

    const rl = createInterface({ input: child.stdout as NodeJS.ReadableStream })
    rl.on('line', (line) => {
      // Engine có thể in log trước dòng ready: chỉ xét dòng JSON.
      if (settled || !line.startsWith('{')) return
      let msg: { event?: string; port?: number }
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.event !== 'ready' || typeof msg.port !== 'number') return
      settled = true
      clearTimeout(timeout)
      resolve({
        baseUrl: `http://127.0.0.1:${msg.port}`,
        token,
        pid,
        stop,
        onExit(cb) {
          if (exited) cb(exitInfo[0], exitInfo[1])
          else exitCbs.push(cb)
        }
      })
    })
  })
}

export type { ChildProcess }
