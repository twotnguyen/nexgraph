import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import type { EngineCommand } from './engine/launcher'

/** Nơi giữ key theo project (bản thật mã hoá bằng safeStorage trong ipc.ts). */
export interface McpKeyStore {
  load(pid: string): string | null
  save(pid: string, key: string): void
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

/** Chuỗi JSON `mcpServers` để dán vào cấu hình trợ lý AI (stdio). */
export function mcpStdioConfig(cmd: EngineCommand, projectPath: string, dataDir: string): string {
  const args = [...cmd.args, 'mcp', '--project', projectPath, '--data-dir', dataDir]
  return JSON.stringify({ mcpServers: { nexgraph: { command: cmd.command, args } } }, null, 2)
}

/** Một MCP server HTTP (127.0.0.1, X-API-Key) cho mỗi project; dừng hết khi app thoát. */
export class McpHttpManager {
  private readonly running = new Map<string, Running>()

  constructor(
    private readonly getCommand: () => EngineCommand,
    private readonly dataDir: string,
    private readonly keys: McpKeyStore = memoryStore()
  ) {}

  status(pid: string): { url: string } | null {
    const r = this.running.get(pid)
    return r ? { url: r.url } : null
  }

  async start(pid: string, projectPath: string): Promise<{ url: string; key: string }> {
    const cur = this.running.get(pid)
    if (cur) return { url: cur.url, key: cur.key }
    let key = this.keys.load(pid)
    if (!key) {
      key = randomBytes(32).toString('hex')
      this.keys.save(pid, key)
    }
    const cmd = this.getCommand()
    const child = spawn(cmd.command, [...cmd.args, 'mcp', '--project', projectPath, '--data-dir', this.dataDir, '--http', '--port', '0'], {
      cwd: cmd.cwd,
      // Key chỉ đi qua biến môi trường, không qua argv.
      env: { ...process.env, NEXGRAPH_MCP_KEY: key, PYTHONUTF8: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (c: string) => (stderr = (stderr + c).slice(-2000)))
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => fail(`MCP HTTP không sẵn sàng sau ${READY_TIMEOUT_MS} ms`), READY_TIMEOUT_MS)
      const fail = (msg: string): void => {
        clearTimeout(timer)
        child.kill()
        reject(new Error(stderr.trim() ? `${msg}: ${stderr.trim()}` : msg))
      }
      child.once('error', (e) => fail(`Không chạy được MCP HTTP: ${e.message}`))
      child.once('exit', (code) => fail(`MCP HTTP thoát (exit ${code})`))
      createInterface({ input: child.stdout as NodeJS.ReadableStream }).on('line', (line) => {
        if (!line.startsWith('{')) return
        try {
          const msg = JSON.parse(line) as { event?: string; port?: number }
          if (msg.event === 'ready' && typeof msg.port === 'number') {
            clearTimeout(timer)
            child.removeAllListeners('exit')
            resolve(msg.port)
          }
        } catch {
          /* không phải dòng JSON */
        }
      })
    })
    const url = `http://127.0.0.1:${port}/mcp`
    this.running.set(pid, { child, url, key })
    child.once('exit', () => this.running.get(pid)?.child === child && this.running.delete(pid))
    return { url, key }
  }

  async stop(pid: string): Promise<void> {
    const r = this.running.get(pid)
    if (!r) return
    this.running.delete(pid)
    if (r.child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      r.child.once('exit', () => resolve())
      r.child.kill()
    })
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((pid) => this.stop(pid)))
  }
}
