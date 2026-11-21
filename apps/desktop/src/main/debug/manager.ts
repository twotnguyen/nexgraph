import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { DebugBreakpoints, DebugEvent, DebugFrame, DebugScope, DebugVariable } from '../../shared/api'
import { resolveInside } from '../fs/project-fs'
import { ADAPTERS, adapterDir, findPython, type DebugKind } from './adapters'
import { DapClient } from './dap-client'
import { UserError } from '../user-error'

const fail = (code: string, message: string) => new UserError(code, message)

type Session = {
  kind: DebugKind
  root: string
  adapter: ChildProcess
  /** Phiên điều khiển (js-debug: phiên con do startDebugging tạo; debugpy: chính phiên gốc). */
  control: DapClient
  clients: DapClient[]
  sockets: Socket[]
  breakpoints: DebugBreakpoints
}

/**
 * Một phiên gỡ lỗi tại một thời điểm, như bảng Debug của Wu: chạy tệp đang mở bằng js-debug (Node) hoặc debugpy (Python),
 * điểm dừng theo dòng, chạy tiếp/bước qua/bước vào/bước ra, xem ngăn xếp và biến.
 */
export class DebugManager {
  private session: Session | null = null

  constructor(private readonly adaptersBase: string, private readonly emit: (event: DebugEvent) => void) {}

  private abs(root: string, file: string) { return resolveInside(root, file) }
  private rel(root: string, path: string): string | null {
    if (!isAbsolute(path)) return null
    const r = relative(root, path)
    return r.startsWith('..') || isAbsolute(r) ? null : r.split(sep).join('/')
  }

  async start(kind: DebugKind, projectRoot: string, file: string, breakpoints: DebugBreakpoints): Promise<void> {
    await this.stop()
    // Đường dẫn thật (macOS: /var → /private/var) để khớp đường dẫn adapter trả về và đường dẫn điểm dừng.
    const root = realpathSync.native(projectRoot)
    const program = this.abs(root, file)
    this.emit({ type: 'state', state: 'starting' })
    try {
      const session = kind === 'python' ? await this.startPython(root, program, breakpoints) : await this.startNode(root, program, breakpoints)
      session.adapter.once('exit', () => this.finish(session))
    } catch (error) {
      if (this.session) this.finish(this.session)
      else this.emit({ type: 'state', state: 'terminated' })
      throw error
    }
  }

  private wire(session: Session, client: DapClient) {
    client.onEvent = ({ event, body = {} }) => {
      // Đầu ra đến từ mọi phiên (js-debug in lệnh chạy ở phiên gốc, stdout ở phiên con).
      if (event === 'output' && typeof body.output === 'string' && body.category !== 'telemetry') return this.emit({ type: 'output', category: String(body.category ?? 'console'), text: body.output })
      // Kết thúc khi phiên gốc kết thúc: phiên con của js-debug báo terminated trước khi đầu ra cuối kịp về.
      if (event === 'terminated' && client === session.clients[0]) return this.finish(session)
      if (client !== session.control) return
      if (event === 'stopped') this.emit({ type: 'state', state: 'stopped', reason: String(body.reason ?? ''), threadId: Number(body.threadId ?? 0) })
      else if (event === 'continued') this.emit({ type: 'state', state: 'running' })
    }
  }

  /** Sau sự kiện initialized: gửi điểm dừng của mọi tệp rồi configurationDone (thứ tự bắt buộc của DAP). */
  private async configure(client: DapClient, root: string, breakpoints: DebugBreakpoints) {
    for (const [file, lines] of Object.entries(breakpoints)) {
      await client.request('setBreakpoints', { source: { path: this.abs(root, file) }, breakpoints: lines.map((line) => ({ line })) }).catch(() => {})
    }
    await client.request('configurationDone')
  }

  private waitInitialized(client: DapClient): Promise<void> {
    return new Promise((resolveInit) => {
      const prior = client.onEvent
      client.onEvent = (event) => {
        if (event.event === 'initialized') { client.onEvent = prior; resolveInit() }
        prior(event)
      }
    })
  }

  private async startPython(root: string, program: string, breakpoints: DebugBreakpoints): Promise<Session> {
    const python = await findPython()
    const adapter = spawn(python, ['-m', 'debugpy.adapter'], {
      cwd: root, env: { ...process.env, PYTHONPATH: adapterDir(this.adaptersBase, 'python') }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true
    })
    const client = new DapClient(adapter.stdout!, adapter.stdin!)
    adapter.stdin!.on('error', () => {})
    const session: Session = { kind: 'python', root, adapter, control: client, clients: [client], sockets: [], breakpoints }
    this.session = session
    this.wire(session, client)
    await client.request('initialize', { clientID: 'nexgraph', adapterID: 'debugpy', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' })
    const initialized = this.waitInitialized(client)
    // debugpy chỉ trả lời launch sau configurationDone: không chờ launch trước.
    const launched = client.request('launch', { type: 'python', request: 'launch', program, cwd: root, console: 'internalConsole', justMyCode: true, python: [python] }, 60_000)
    launched.catch(() => {})
    await initialized
    await this.configure(client, root, breakpoints)
    await launched
    return session
  }

  private async startNode(root: string, program: string, breakpoints: DebugBreakpoints): Promise<Session> {
    const server = join(adapterDir(this.adaptersBase, 'node'), ...ADAPTERS.node.entry)
    const adapter = spawn(process.execPath, [server, '0', '127.0.0.1'], {
      cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
    })
    const port = await new Promise<number>((resolvePort, reject) => {
      let text = ''
      const timer = setTimeout(() => reject(fail('adapter_timeout', 'js-debug không khởi động')), 20_000)
      adapter.stdout!.on('data', (chunk: Buffer) => {
        text += chunk.toString()
        const match = /listening at .*?:(\d+)/i.exec(text)
        if (match) { clearTimeout(timer); resolvePort(Number(match[1])) }
      })
      adapter.once('exit', () => { clearTimeout(timer); reject(fail('adapter_exit', 'js-debug đã dừng')) })
    })
    const open = async () => {
      const socket = connect(port, '127.0.0.1')
      await new Promise<void>((ok, err) => { socket.once('connect', ok); socket.once('error', err) })
      return socket
    }
    const rootSocket = await open()
    const client = new DapClient(rootSocket, rootSocket)
    const session: Session = { kind: 'node', root, adapter, control: client, clients: [client], sockets: [rootSocket], breakpoints }
    this.session = session
    this.wire(session, client)
    // js-debug chạy chương trình trong phiên con: yêu cầu startDebugging → mở kết nối mới tới cùng server.
    client.onRequest = async (command, args) => {
      if (command !== 'startDebugging') throw new Error(`Không hỗ trợ ${command}`)
      const socket = await open()
      const child = new DapClient(socket, socket)
      session.sockets.push(socket)
      session.clients.push(child)
      session.control = child
      this.wire(session, child)
      await child.request('initialize', { clientID: 'nexgraph', adapterID: 'pwa-node', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsStartDebuggingRequest: true })
      const initialized = this.waitInitialized(child)
      const configuration = (args.configuration ?? {}) as Record<string, unknown>
      const started = child.request(args.request === 'attach' ? 'attach' : 'launch', configuration, 60_000)
      started.catch(() => {})
      await initialized
      await this.configure(child, root, session.breakpoints)
      return {}
    }
    await client.request('initialize', { clientID: 'nexgraph', adapterID: 'pwa-node', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsStartDebuggingRequest: true })
    const initialized = this.waitInitialized(client)
    const launched = client.request('launch', { type: 'pwa-node', request: 'launch', program, cwd: root, console: 'internalConsole', outputCapture: 'std' }, 60_000)
    launched.catch(() => {})
    await initialized
    await client.request('configurationDone')
    await launched
    return session
  }

  private active(): Session {
    if (!this.session) throw fail('no_session', 'Không có phiên gỡ lỗi nào')
    return this.session
  }

  async setBreakpoints(file: string, lines: number[]): Promise<void> {
    const session = this.session
    if (!session) return
    session.breakpoints = { ...session.breakpoints, [file]: lines }
    await session.control.request('setBreakpoints', { source: { path: this.abs(session.root, file) }, breakpoints: lines.map((line) => ({ line })) })
  }

  async step(action: 'continue' | 'next' | 'stepIn' | 'stepOut', threadId: number): Promise<void> {
    const session = this.active()
    await session.control.request(action, { threadId })
    this.emit({ type: 'state', state: 'running' })
  }

  async stackTrace(threadId: number): Promise<DebugFrame[]> {
    const session = this.active()
    const body = await session.control.request<{ stackFrames?: { id: number; name: string; line: number; column: number; source?: { path?: string } }[] }>('stackTrace', { threadId, startFrame: 0, levels: 50 })
    return (body.stackFrames ?? []).map((f) => ({ id: f.id, name: f.name, line: f.line, column: f.column, file: f.source?.path ? this.rel(session.root, resolve(f.source.path)) : null }))
  }

  async scopes(frameId: number): Promise<DebugScope[]> {
    const body = await this.active().control.request<{ scopes?: { name: string; variablesReference: number; expensive?: boolean }[] }>('scopes', { frameId })
    return (body.scopes ?? []).map((s) => ({ name: s.name, variablesReference: s.variablesReference, expensive: !!s.expensive }))
  }

  async variables(variablesReference: number): Promise<DebugVariable[]> {
    const body = await this.active().control.request<{ variables?: { name: string; value: string; type?: string; variablesReference: number }[] }>('variables', { variablesReference })
    return (body.variables ?? []).map((v) => ({ name: v.name, value: v.value, type: v.type ?? '', variablesReference: v.variablesReference }))
  }

  private finish(session: Session) {
    if (this.session !== session) return
    this.session = null
    for (const client of session.clients) client.close('Phiên gỡ lỗi đã kết thúc')
    for (const socket of session.sockets) socket.destroy()
    session.adapter.kill()
    this.emit({ type: 'state', state: 'terminated' })
  }

  async stop(): Promise<void> {
    const session = this.session
    if (!session) return
    await Promise.race([session.control.request('disconnect', { terminateDebuggee: true }, 3_000).catch(() => {}), new Promise((r) => setTimeout(r, 3_000))])
    this.finish(session)
  }
}
