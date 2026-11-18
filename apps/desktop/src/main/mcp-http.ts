import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { signalProcessTree, type EngineCommand } from './engine/launcher'

/** Nơi giữ key theo project (bản thật mã hoá bằng safeStorage trong ipc.ts). */
export interface McpKeyStore {
  load(pid: string): string | null
  save(pid: string, key: string): void
}

/** Cổng lần trước theo project, để URL đã dán vào trợ lý AI vẫn dùng được sau khi khởi động lại. */
export interface McpPortStore {
  load(pid: string): number | null
  save(pid: string, port: number): void
}

const memoryPorts = (): McpPortStore => {
  const m = new Map<string, number>()
  return { load: (pid) => m.get(pid) ?? null, save: (pid, port) => void m.set(pid, port) }
}

const memoryStore = (): McpKeyStore => {
  const m = new Map<string, string>()
  return { load: (pid) => m.get(pid) ?? null, save: (pid, key) => void m.set(pid, key) }
}

const READY_TIMEOUT_MS = 20_000

interface Running {
  child: ChildProcess
  url: string
  key: string
}

type Endpoint = { url: string; key: string }

/** Chuỗi JSON `mcpServers` để dán vào cấu hình trợ lý AI (stdio). */
export function mcpStdioConfig(cmd: EngineCommand, projectPath: string, dataDir: string): string {
  const args = [...cmd.args, 'mcp', '--project', projectPath, '--data-dir', dataDir]
  return JSON.stringify({ mcpServers: { nexgraph: { command: cmd.command, args } } }, null, 2)
}

/** Một MCP server HTTP (127.0.0.1, X-API-Key) cho mỗi project; dừng hết khi app thoát. */
export class McpHttpManager {
  private readonly running = new Map<string, Running>()
  private readonly starting = new Map<string, { controller: AbortController; result: Promise<Endpoint> }>()
  private readonly stopping = new Map<string, Promise<void>>()

  constructor(
    private readonly getCommand: () => EngineCommand,
    private readonly dataDir: string,
    private readonly keys: McpKeyStore = memoryStore(),
    private readonly ports: McpPortStore = memoryPorts(),
    private readonly killGraceMs = 3000
  ) {}

  status(pid: string): { url: string } | null {
    const r = this.running.get(pid)
    return r ? { url: r.url } : null
  }

  start(pid: string, projectPath: string): Promise<Endpoint> {
    const pending = this.starting.get(pid)
    if (pending && !pending.controller.signal.aborted) return pending.result
    const stopping = this.stopping.get(pid)
    const current = this.running.get(pid)
    if (current && !stopping) return Promise.resolve({ url: current.url, key: current.key })

    const controller = new AbortController()
    const result = Promise.resolve(stopping).then(() => this.startServer(pid, projectPath, controller.signal)).finally(() => {
      if (this.starting.get(pid)?.controller === controller) this.starting.delete(pid)
    })
    this.starting.set(pid, { controller, result })
    return result
  }

  private async startServer(pid: string, projectPath: string, signal: AbortSignal): Promise<Endpoint> {
    signal.throwIfAborted()
    let key = this.keys.load(pid)
    if (!key) {
      key = randomBytes(32).toString('hex')
      this.keys.save(pid, key)
    }
    const last = this.ports.load(pid)
    let spawned: { child: ChildProcess; port: number }
    try {
      spawned = await this.spawn(projectPath, key, last ?? 0, signal)
    } catch (e) {
      signal.throwIfAborted()
      if (!last) throw e
      spawned = await this.spawn(projectPath, key, 0, signal) // cổng cũ đã bị chiếm
    }
    const { child, port } = spawned
    try {
      signal.throwIfAborted()
      this.ports.save(pid, port)
    } catch (error) {
      await this.terminate(child)
      throw error
    }
    const url = `http://127.0.0.1:${port}/mcp`
    this.running.set(pid, { child, url, key })
    child.once('exit', () => this.running.get(pid)?.child === child && this.running.delete(pid))
    return { url, key }
  }

  private async spawn(projectPath: string, key: string, port: number, signal: AbortSignal): Promise<{ child: ChildProcess; port: number }> {
    const cmd = this.getCommand()
    const child = spawn(cmd.command, [...cmd.args, 'mcp', '--project', projectPath, '--data-dir', this.dataDir, '--http', '--port', String(port)], {
      cwd: cmd.cwd,
      // Key chỉ đi qua biến môi trường, không qua argv.
      env: { ...process.env, NEXGRAPH_MCP_KEY: key, PYTHONUTF8: '1' },
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    // Nếu huỷ ngay khi spawn, lỗi của ChildProcess có thể đến sau khi bỏ listener chờ ready.
    child.on('error', () => {})
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (c: string) => (stderr = (stderr + c).slice(-2000)))
    const lines = createInterface({ input: child.stdout as NodeJS.ReadableStream })
    try {
      const ready = await new Promise<number>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
          child.off('error', onError)
          child.off('exit', onExit)
          lines.off('line', onLine)
        }
        const fail = (msg: string) => {
          cleanup()
          reject(new Error(stderr.trim() ? `${msg}: ${stderr.trim()}` : msg))
        }
        const onError = (e: Error) => fail(`Không chạy được MCP HTTP: ${e.message}`)
        const onExit = (code: number | null) => fail(`MCP HTTP thoát (exit ${code})`)
        const onLine = (line: string) => {
          if (!line.startsWith('{')) return
          try {
            const msg = JSON.parse(line) as { event?: string; port?: number }
            if (msg.event === 'ready' && typeof msg.port === 'number') {
              cleanup()
              resolve(msg.port)
            }
          } catch { /* không phải dòng JSON */ }
        }
        const abort = () => {
          cleanup()
          reject(signal.reason)
        }
        const timer = setTimeout(() => fail(`MCP HTTP không sẵn sàng sau ${READY_TIMEOUT_MS} ms`), READY_TIMEOUT_MS)
        child.once('error', onError)
        child.once('exit', onExit)
        lines.on('line', onLine)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
      return { child, port: ready }
    } catch (error) {
      await this.terminate(child)
      throw error
    }
  }

  private async terminate(child: ChildProcess): Promise<void> {
    const pid = child.pid
    if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      // Server còn giữ luồng của client AI có thể không chịu tắt: hết thời gian chờ thì diệt hẳn.
      const timer = setTimeout(() => signalProcessTree(child, 'SIGKILL'), this.killGraceMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      signalProcessTree(child, 'SIGTERM')
    })
    if (process.platform !== 'win32') {
      try { process.kill(-pid, 'SIGKILL') } catch { /* cây tiến trình đã trống */ }
    }
  }

  stop(pid: string): Promise<void> {
    const pending = this.starting.get(pid)
    pending?.controller.abort(new Error('Đã dừng khởi động MCP HTTP'))
    const previous = this.stopping.get(pid)
    if (previous) return previous

    const result = Promise.resolve(pending?.result).catch(() => {}).then(async () => {
      const server = this.running.get(pid)
      this.running.delete(pid)
      if (server) await this.terminate(server.child)
    }).finally(() => this.stopping.delete(pid))
    this.stopping.set(pid, result)
    return result
  }

  async stopAll(): Promise<void> {
    const ids = new Set([...this.running.keys(), ...this.starting.keys(), ...this.stopping.keys()])
    await Promise.all([...ids].map((pid) => this.stop(pid)))
  }
}
