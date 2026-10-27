import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'

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

export class EngineStartError extends Error {
  constructor(
    message: string,
    public readonly pid: number,
    public readonly stderrTail: string
  ) {
    super(message)
    this.name = 'EngineStartError'
  }
}

export function startEngine(
  cmd: EngineCommand,
  opts: { dataDir: string; readyTimeoutMs?: number; env?: NodeJS.ProcessEnv }
): Promise<EngineHandle> {
  const token = randomBytes(32).toString('hex')
  const isWin = process.platform === 'win32'
  const child = spawn(cmd.command, [...cmd.args, 'serve', '--data-dir', opts.dataDir, '--port', '0', '--exit-on-stdin-close'], {
    cwd: cmd.cwd,
    // Token chỉ đi qua biến môi trường, không bao giờ qua argv.
    env: { ...(opts.env ?? process.env), NEXGRAPH_TOKEN: token, PYTHONUTF8: '1' },
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
  const exitPromise = new Promise<void>((resolve) => {
    child.once('exit', (code, signal) => {
      exited = true
      exitInfo = [code, signal]
      exitCbs.forEach((cb) => cb(code, signal))
      resolve()
    })
  })

  const killTree = (signal: NodeJS.Signals): void => {
    if (exited || pid < 0) return
    if (isWin) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      try {
        process.kill(-pid, signal)
      } catch {
        child.kill(signal)
      }
    }
  }

  const stop = async (): Promise<void> => {
    if (exited) return
    killTree('SIGTERM')
    const timer = setTimeout(() => killTree('SIGKILL'), KILL_GRACE_MS)
    await exitPromise
    clearTimeout(timer)
    // Một số tiến trình con có thể còn sót trong nhóm sau khi tiến trình đầu đã thoát.
    if (!isWin) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        /* nhóm đã trống */
      }
    }
  }

  return new Promise<EngineHandle>((resolve, reject) => {
    let settled = false
    const fail = async (message: string): Promise<void> => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      await stop()
      reject(new EngineStartError(message, pid, stderrTail))
    }

    const timeout = setTimeout(() => void fail(`Engine không sẵn sàng sau ${opts.readyTimeoutMs ?? 20000} ms`), opts.readyTimeoutMs ?? 20000)

    child.once('error', (err) => void fail(`Không khởi động được engine: ${err.message}`))
    child.once('exit', (code) => void fail(`Engine thoát trước khi sẵn sàng (exit ${code})`))

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
