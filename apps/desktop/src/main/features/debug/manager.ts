import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { DebugBreakpoint, DebugBreakpoints, DebugEvaluation, DebugEvent, DebugFrame, DebugLoadedSource, DebugModule, DebugScope, DebugVariable } from '../../../shared/api'
import { resolveInside } from '../../platform/project-fs'
import { safeProcessEnv } from '../../platform/process-env'
import { ADAPTERS, adapterDir, findPython, type DebugKind } from './adapters'
import { DapClient } from './dap-client'
import { launchSpec, type DebugSpec } from './launch-config'
import { UserError } from '../../platform/user-error'

const fail = (code: string, message: string) => new UserError(code, message)

/** Adapter debug chỉ nhận biến hệ thống; `extra` là phần NexGraph tự đặt (PYTHONPATH của adapter). */
export const debugEnv = (extra: NodeJS.ProcessEnv = {}, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv =>
  safeProcessEnv(source, extra)

export const toDapBreakpoints = (breakpoints: DebugBreakpoint[]) => breakpoints.filter((bp) => bp.enabled).map((bp) => ({
  line: bp.line,
  ...(bp.condition ? { condition: bp.condition } : {}),
  ...(bp.hitCondition ? { hitCondition: bp.hitCondition } : {}),
  ...(bp.logMessage ? { logMessage: bp.logMessage } : {})
}))

type Session = {
  spec: DebugSpec
  root: string
  supportsRestart: boolean
  state: 'starting' | 'running' | 'stopped'
  supportsModules: boolean
  supportsLoadedSources: boolean
  /** Tiến trình adapter do app chạy; null khi nối TCP thẳng vào adapter của tiến trình đích (attach Python). */
  adapter: ChildProcess | null
  /** Phiên điều khiển (js-debug: phiên con do startDebugging tạo; debugpy: chính phiên gốc). */
  control: DapClient
  clients: DapClient[]
  sockets: Socket[]
  breakpoints: DebugBreakpoints
  threadWaiters: Set<(id: number | null) => void>
}

/**
 * Một phiên gỡ lỗi tại một thời điểm, như bảng Debug của Wu: chạy tệp đang mở, một cấu hình trong dự án hoặc attach vào tiến trình đang chạy
 * bằng js-debug (Node) hoặc debugpy (Python), điểm dừng theo dòng, chạy tiếp/bước qua/bước vào/bước ra, xem ngăn xếp và biến.
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

  /** F5 mặc định: chạy tệp đang mở bằng adapter của `kind`. */
  async start(kind: DebugKind, projectRoot: string, file: string, breakpoints: DebugBreakpoints): Promise<void> {
    await this.stop()
    // Đường dẫn thật (macOS: /var → /private/var) để khớp đường dẫn adapter trả về và đường dẫn điểm dừng.
    const root = realpathSync.native(projectRoot)
    return this.run(root, launchSpec(kind, { program: this.abs(root, file), cwd: root }), breakpoints)
  }

  /** Chạy launch hoặc attach theo tham số adapter đã dựng (cấu hình trong dự án, form Attach); phiên đang có bị dừng trước. */
  async run(projectRoot: string, spec: DebugSpec, breakpoints: DebugBreakpoints): Promise<void> {
    await this.stop()
    const root = realpathSync.native(projectRoot)
    this.emit({ type: 'state', state: 'starting' })
    try {
      const session = spec.kind === 'python' ? await this.startPython(root, spec, breakpoints) : await this.startNode(root, spec, breakpoints)
      session.adapter?.once('exit', () => this.finish(session))
      if (this.session === session && session.state === 'starting') {
        session.state = 'running'
        this.emit({ type: 'state', state: 'running' })
      }
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
      if (event === 'thread' && body.reason === 'started' && typeof body.threadId === 'number') {
        for (const waiter of session.threadWaiters) waiter(body.threadId)
      }
      if (event === 'stopped') {
        session.state = 'stopped'
        this.emit({ type: 'state', state: 'stopped', reason: String(body.reason ?? ''), threadId: Number(body.threadId ?? 0) })
      } else if (event === 'continued' && session.state !== 'running') {
        session.state = 'running'
        this.emit({ type: 'state', state: 'running' })
      }
    }
  }

  /** Sau sự kiện initialized: gửi điểm dừng của mọi tệp rồi configurationDone (thứ tự bắt buộc của DAP). */
  private async configure(client: DapClient, root: string, breakpoints: DebugBreakpoints) {
    for (const [file, points] of Object.entries(breakpoints)) {
      await client.request('setBreakpoints', { source: { path: this.abs(root, file) }, breakpoints: toDapBreakpoints(points) })
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

  /** Chờ initialized; launch/attach bị adapter từ chối ngay (không có initialized) thì ném lỗi thay vì treo. */
  private ready(initialized: Promise<void>, started: Promise<unknown>): Promise<void> {
    return Promise.race([initialized, started.then(() => initialized)])
  }

  private async dial(host: string, port: number): Promise<Socket> {
    const socket = connect(port, host)
    await new Promise<void>((ok, err) => {
      socket.once('connect', ok)
      socket.once('error', () => err(fail('connect_failed', `Không kết nối được tới ${host}:${port}`)))
    })
    // Lỗi sau khi đã nối (tiến trình đích thoát đột ngột) kết thúc phiên qua sự kiện close; không được thành ngoại lệ của main.
    socket.on('error', () => {})
    return socket
  }

  private async startPython(root: string, spec: DebugSpec, breakpoints: DebugBreakpoints): Promise<Session> {
    let adapter: ChildProcess | null = null
    let python = ''
    let client: DapClient
    const sockets: Socket[] = []
    if (spec.request === 'attach') {
      // `debugpy.listen` của tiến trình đích đã tự chạy một adapter nghe DAP trên cổng đó: nối TCP thẳng thay vì chạy adapter riêng.
      const socket = await this.dial(spec.host, spec.port)
      sockets.push(socket)
      client = new DapClient(socket, socket)
    } else {
      python = await findPython()
      adapter = spawn(python, ['-m', 'debugpy.adapter'], {
        cwd: root, env: debugEnv({ PYTHONPATH: adapterDir(this.adaptersBase, 'python') }), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true
      })
      client = new DapClient(adapter.stdout!, adapter.stdin!)
      adapter.stdin!.on('error', () => {})
    }
    const session: Session = { spec, root, supportsRestart: false, supportsModules: false, supportsLoadedSources: false, state: 'starting', adapter, control: client, clients: [client], sockets, breakpoints, threadWaiters: new Set() }
    this.session = session
    if (!adapter) sockets[0].once('close', () => this.finish(session))
    this.wire(session, client)
    const capabilities = await client.request<{ supportsRestartRequest?: boolean; supportsModulesRequest?: boolean; supportsLoadedSourcesRequest?: boolean }>('initialize', { clientID: 'nexgraph', adapterID: 'debugpy', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' })
    session.supportsRestart = capabilities.supportsRestartRequest === true
    session.supportsModules = capabilities.supportsModulesRequest === true
    session.supportsLoadedSources = capabilities.supportsLoadedSourcesRequest === true
    const initialized = this.waitInitialized(client)
    // debugpy chỉ trả lời launch/attach sau configurationDone: không chờ trả lời trước.
    const started = client.request(spec.request, spec.request === 'launch' ? { ...spec.args, python: [python] } : spec.args, 60_000)
    started.catch(() => {})
    await this.ready(initialized, started)
    await this.configure(client, root, breakpoints)
    await started
    return session
  }

  private async startNode(root: string, spec: DebugSpec, breakpoints: DebugBreakpoints): Promise<Session> {
    const server = join(adapterDir(this.adaptersBase, 'node'), ...ADAPTERS.node.entry)
    const adapter = spawn(process.execPath, [server, '0', '127.0.0.1'], {
      cwd: root, env: debugEnv({ ELECTRON_RUN_AS_NODE: '1' }), stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true
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
    const open = () => this.dial('127.0.0.1', port)
    const rootSocket = await open()
    const client = new DapClient(rootSocket, rootSocket)
    const session: Session = { spec, root, supportsRestart: false, supportsModules: false, supportsLoadedSources: false, state: 'starting', adapter, control: client, clients: [client], sockets: [rootSocket], breakpoints, threadWaiters: new Set() }
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
      const childCaps = await child.request<{ supportsModulesRequest?: boolean; supportsLoadedSourcesRequest?: boolean }>('initialize', { clientID: 'nexgraph', adapterID: 'pwa-node', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsStartDebuggingRequest: true })
      session.supportsModules = childCaps.supportsModulesRequest === true
      session.supportsLoadedSources = childCaps.supportsLoadedSourcesRequest === true
      const initialized = this.waitInitialized(child)
      const configuration = (args.configuration ?? {}) as Record<string, unknown>
      const started = child.request(args.request === 'attach' ? 'attach' : 'launch', configuration, 60_000)
      started.catch(() => {})
      await this.ready(initialized, started)
      await this.configure(child, root, session.breakpoints)
      return {}
    }
    const capabilities = await client.request<{ supportsRestartRequest?: boolean; supportsModulesRequest?: boolean; supportsLoadedSourcesRequest?: boolean }>('initialize', { clientID: 'nexgraph', adapterID: 'pwa-node', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsStartDebuggingRequest: true })
    session.supportsRestart = capabilities.supportsRestartRequest === true
    session.supportsModules = capabilities.supportsModulesRequest === true
    session.supportsLoadedSources = capabilities.supportsLoadedSourcesRequest === true
    const initialized = this.waitInitialized(client)
    // Như Wu: js-debug luôn nhận cwd (mặc định gốc dự án), kể cả attach.
    const launched = client.request(spec.request, { cwd: root, ...spec.args }, 60_000)
    launched.catch(() => {})
    await this.ready(initialized, launched)
    await client.request('configurationDone')
    await launched
    return session
  }

  private active(): Session {
    if (!this.session) throw fail('no_session', 'Không có phiên gỡ lỗi nào')
    return this.session
  }

  async setBreakpoints(file: string, points: DebugBreakpoint[]): Promise<void> {
    const session = this.session
    if (!session) return
    const path = this.abs(session.root, file)
    session.breakpoints = { ...session.breakpoints, [file]: points }
    await session.control.request('setBreakpoints', { source: { path }, breakpoints: toDapBreakpoints(points) })
  }

  async step(action: 'continue' | 'next' | 'stepIn' | 'stepOut', threadId: number): Promise<void> {
    const session = this.active()
    session.state = 'running'
    this.emit({ type: 'state', state: 'running' })
    try { await session.control.request(action, { threadId }) }
    catch (error) {
      if (this.session === session && session.state === 'running') {
        session.state = 'stopped'
        this.emit({ type: 'state', state: 'stopped', threadId })
      }
      throw error
    }
  }

  async pause(): Promise<void> {
    const session = this.active()
    let notify: (id: number | null) => void = () => {}
    const started = new Promise<number | null>((resolveThread) => { notify = resolveThread })
    session.threadWaiters.add(notify)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const body = await session.control.request<{ threads?: { id: number }[] }>('threads')
      const threadId = body.threads?.[0]?.id ?? await Promise.race([
        started,
        new Promise<null>((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(null), 30_000) })
      ])
      if (threadId === null || this.session !== session) throw fail('no_thread', 'Không tìm thấy luồng đang chạy')
      await session.control.request('pause', { threadId })
    } finally {
      session.threadWaiters.delete(notify)
      if (timer) clearTimeout(timer)
    }
  }

  async restart(): Promise<void> {
    const session = this.active()
    // Attach không có tiến trình do app chạy để khởi động lại: nối lại từ cấu hình cũ.
    if (session.supportsRestart && session.spec.request === 'launch') {
      session.state = 'starting'
      this.emit({ type: 'state', state: 'starting' })
      try {
        await session.clients[0].request('restart', {})
        if (this.session === session && session.state === 'starting') {
          session.state = 'running'
          this.emit({ type: 'state', state: 'running' })
        }
        return
      } catch {
        // Adapter có thể báo hỗ trợ nhưng từ chối restart; chạy lại từ cấu hình cũ.
      }
    }
    await this.run(session.root, session.spec, session.breakpoints)
  }

  async evaluate(expression: string, frameId: number, context: 'watch' | 'repl'): Promise<DebugEvaluation> {
    const body = await this.active().control.request<{ result: string; variablesReference?: number }>('evaluate', { expression, frameId, context })
    return { result: body.result, variablesReference: body.variablesReference ?? 0 }
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

  /** Chỉ hỏi adapter có khai báo capability tương ứng; lỗi coi như danh sách rỗng và báo nhẹ. */
  async modules(): Promise<DebugModule[]> {
    const session = this.active()
    if (!session.supportsModules) return []
    try {
      const body = await session.control.request<{ modules?: { id: number | string; name: string; path?: string | null; version?: string | null }[] }>('modules')
      return (body.modules ?? []).map((m) => ({ id: m.id, name: m.name, path: m.path ?? null, version: m.version ?? null }))
    } catch (error) {
      this.emit({ type: 'notice', target: 'modules', code: 'debug.modules_failed', detail: error instanceof Error ? error.message : String(error) })
      return []
    }
  }

  async loadedSources(): Promise<DebugLoadedSource[]> {
    const session = this.active()
    if (!session.supportsLoadedSources) return []
    try {
      const body = await session.control.request<{ sources?: { name?: string; path?: string | null; sourceReference?: number }[] }>('loadedSources')
      return body.sources ?? []
    } catch (error) {
      this.emit({ type: 'notice', target: 'loadedSources', code: 'debug.sources_failed', detail: error instanceof Error ? error.message : String(error) })
      return []
    }
  }

  private finish(session: Session) {
    if (this.session !== session) return
    this.session = null
    for (const waiter of session.threadWaiters) waiter(null)
    session.threadWaiters.clear()
    for (const client of session.clients) client.close('Phiên gỡ lỗi đã kết thúc')
    for (const socket of session.sockets) socket.destroy()
    session.adapter?.kill()
    this.emit({ type: 'state', state: 'terminated' })
  }

  async stop(): Promise<void> {
    const session = this.session
    if (!session) return
    // Attach chỉ ngắt kết nối: tiến trình đích không do app chạy nên không được tắt.
    await Promise.race([session.control.request('disconnect', { terminateDebuggee: session.spec.request === 'launch' }, 3_000).catch(() => {}), new Promise((r) => setTimeout(r, 3_000))])
    this.finish(session)
  }
}
