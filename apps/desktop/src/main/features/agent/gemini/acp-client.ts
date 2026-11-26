import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { isUtf8 } from 'node:buffer'

export type AcpInitializeResult = {
  protocolVersion: number
  agentInfo?: { name: string; version?: string; title?: string }
  agentCapabilities?: {
    loadSession?: boolean
    promptCapabilities?: { embeddedContext?: boolean }
    mcpCapabilities?: { http?: boolean; sse?: boolean }
  }
  authMethods?: { id: string; name: string; description?: string }[]
}
export type AcpHandlers = {
  onNotification?: (method: string, params: unknown) => void
  onRequest?: (method: string, params: unknown) => Promise<unknown>
  onStderr?: (text: string) => void
  /** Ephemeral official browser authorization URL; never persisted as a log. */
  onAuthUrl?: (url: string) => void
  onClose?: (error: Error) => void
}
export class AcpError extends Error {
  constructor(
    public readonly code: number | string,
    message: string
  ) {
    super(message)
    this.name = 'AcpError'
  }
}
type Pending = {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  abort?: () => void
  signal?: AbortSignal
}
const MAX_FRAME = 8 * 1024 * 1024
export const safeGeminiMessage = (value: unknown): string =>
  String(value ?? 'Antigravity CLI gặp lỗi')
    .replace(/https?:\/\/[^\s<>"')]+/gi, '[liên kết đã ẩn]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [đã ẩn]')
    .replace(/AIza[\w-]{20,}/g, '[đã ẩn]')
    .replace(
      /((?:access_token|refresh_token|id_token|code_verifier|client_secret|api_key|nonce|state)["']?\s*[:=]\s*)["']?[^\s,"'}]+/gi,
      '$1[đã ẩn]'
    )
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[đã ẩn]')
    .replace(/\b(?:ya29\.|1\/\/)[\w./-]+/g, '[đã ẩn]')
    .slice(0, 2000)

/** One bounded NDJSON/JSON-RPC connection. The official CLI alone owns inference and OAuth. */
export class AcpClient {
  initializeResult?: AcpInitializeResult
  /** Isolated private CLI workspace; actual repository access is mediated by NexGraph's MCP tools. */
  sessionCwd = ''
  private sequence = 0
  private ended = false
  private readonly pending = new Map<number, Pending>()
  private readonly serverRequests = new Set<string | number>()
  private readonly stderrDecoder = new StringDecoder('utf8')
  private buffer = Buffer.alloc(0)
  private stderrLine = ''
  private readonly authUrls = new Set<string>()
  private closePromise?: Promise<void>
  private handlers: AcpHandlers

  static launch(options: {
    command: string
    args: string[]
    cwd: string
    env: NodeJS.ProcessEnv
    handlers?: AcpHandlers
  }): AcpClient {
    return new AcpClient(
      spawn(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        shell: false,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      }),
      options.handlers
    )
  }
  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    handlers: AcpHandlers = {}
  ) {
    this.handlers = handlers
    child.stdout.on('data', (data: Buffer) => this.receive(data))
    child.stderr.on('data', (data: Buffer) => this.receiveStderr(this.stderrDecoder.write(data)))
    child.stderr.on('end', () => this.receiveStderr(this.stderrDecoder.end() + '\n'))
    child.on('error', () =>
      this.fail(
        new AcpError('process_error', 'Không khởi động được Antigravity CLI. Kiểm tra bộ công cụ đã cài đặt.')
      )
    )
    child.on('exit', () =>
      this.fail(new AcpError('process_closed', 'Antigravity CLI đã dừng. Kết nối lại để tiếp tục.'))
    )
    child.stdin.on('error', () => this.fail(new AcpError('transport_closed', 'Mất kết nối tới Antigravity CLI.')))
  }
  setHandlers(handlers: AcpHandlers): void {
    this.handlers = handlers
  }
  closed(): boolean {
    return this.ended
  }
  private send(message: object): void {
    if (this.ended) throw new AcpError('process_closed', 'Antigravity CLI không còn kết nối')
    const frame = JSON.stringify(message)
    if (Buffer.byteLength(frame) > MAX_FRAME)
      throw new AcpError('frame_too_large', 'Nội dung ACP vượt giới hạn 8 MiB')
    this.child.stdin.write(frame + '\n')
  }
  request<T = unknown>(
    method: string,
    params: unknown,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<T> {
    if (this.ended) return Promise.reject(new AcpError('process_closed', 'Antigravity CLI không còn kết nối'))
    if (options.signal?.aborted) return Promise.reject(new AcpError('cancelled', 'Đã dừng yêu cầu Gemini'))
    if (this.pending.size >= 64)
      return Promise.reject(new AcpError('too_many_requests', 'Quá nhiều yêu cầu Gemini đang chờ'))
    if (
      options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 86_400_000)
    )
      return Promise.reject(new AcpError('invalid_timeout', 'Thời gian chờ Gemini không hợp lệ'))
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? 30_000
      const pending: Pending = {
        resolve: (value) => resolve(value as T),
        reject,
        timer: setTimeout(() => {
          this.remove(id)
          reject(new AcpError('timeout', 'Antigravity CLI không phản hồi trong thời gian chờ'))
        }, timeoutMs),
        signal: options.signal
      }
      pending.abort = () => {
        this.remove(id)
        reject(new AcpError('cancelled', 'Đã dừng yêu cầu Gemini'))
      }
      this.pending.set(id, pending)
      options.signal?.addEventListener('abort', pending.abort, { once: true })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.remove(id)
        reject(error)
      }
    })
  }
  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }
  private remove(id: number): Pending | undefined {
    const value = this.pending.get(id)
    if (value) {
      clearTimeout(value.timer)
      if (value.abort) value.signal?.removeEventListener('abort', value.abort)
      this.pending.delete(id)
    }
    return value
  }
  private receiveStderr(text: string): void {
    this.stderrLine += text
    if (this.stderrLine.length > 32_000) this.stderrLine = this.stderrLine.slice(-32_000)
    for (;;) {
      const at = this.stderrLine.indexOf('\n')
      if (at < 0) break
      const line = this.stderrLine.slice(0, at).replace(/\x1b\[[0-9;]*m/g, '')
      this.stderrLine = this.stderrLine.slice(at + 1)
      for (const [url] of line.matchAll(/https:\/\/accounts\.google\.com\/[^\s<>"')]+/g)) {
        try {
          const parsed = new URL(url)
          if (
            parsed.origin === 'https://accounts.google.com' &&
            /\/(?:o\/)?oauth2\//.test(parsed.pathname) &&
            !this.authUrls.has(url)
          ) {
            this.authUrls.add(url)
            this.handlers.onAuthUrl?.(url)
          }
        } catch {
          /* An incomplete URL is never opened. */
        }
      }
      if (line) this.handlers.onStderr?.(safeGeminiMessage(line))
    }
  }
  private receive(data: Buffer): void {
    if (this.ended) return
    this.buffer = Buffer.concat([this.buffer, data])
    if (this.buffer.length > MAX_FRAME && !this.buffer.includes(10))
      return this.fail(new AcpError('frame_too_large', 'Phản hồi Antigravity CLI vượt giới hạn'))
    for (;;) {
      const position = this.buffer.indexOf(10)
      if (position < 0) break
      const rawFrame = this.buffer.subarray(0, position)
      this.buffer = this.buffer.subarray(position + 1)
      if (rawFrame.length > MAX_FRAME || !isUtf8(rawFrame))
        return this.fail(
          new AcpError('invalid_frame', 'Phản hồi Antigravity CLI vượt giới hạn hoặc không phải UTF-8')
        )
      const frame = rawFrame.toString('utf8')
      if (!frame.trim()) continue
      if (Buffer.byteLength(frame) > MAX_FRAME)
        return this.fail(new AcpError('frame_too_large', 'Phản hồi Antigravity CLI vượt giới hạn'))
      let message: Record<string, unknown>
      try {
        message = JSON.parse(frame)
      } catch {
        return this.fail(new AcpError('invalid_json', 'Antigravity CLI gửi dữ liệu không đúng giao thức'))
      }
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0')
        return this.fail(new AcpError('invalid_message', 'Phản hồi ACP không hợp lệ'))
      if (typeof message.method === 'string') {
        if ('id' in message) {
          if (typeof message.id !== 'number' && typeof message.id !== 'string')
            return this.fail(new AcpError('invalid_id', 'Mã yêu cầu ACP không hợp lệ'))
          const id = message.id
          if (this.serverRequests.has(id) || this.serverRequests.size >= 64)
            return this.fail(
              new AcpError('too_many_requests', 'Antigravity CLI gửi quá nhiều yêu cầu đang chờ hoặc trùng mã')
            )
          this.serverRequests.add(id)
          void Promise.resolve()
            .then(() => {
              if (!this.handlers.onRequest) throw new Error('unsupported')
              return this.handlers.onRequest(message.method as string, message.params)
            })
            .then(
              (result) => {
                if (!this.ended) this.send({ jsonrpc: '2.0', id, result: result ?? null })
              },
              () => {
                if (!this.ended)
                  this.send({
                    jsonrpc: '2.0',
                    id,
                    error: { code: -32000, message: 'Yêu cầu không được phép trong kết nối NexGraph' }
                  })
              }
            )
            .catch(() => {})
            .finally(() => this.serverRequests.delete(id))
        } else {
          try {
            this.handlers.onNotification?.(message.method, message.params)
          } catch {
            this.fail(new AcpError('notification_error', 'Không xử lý được cập nhật từ Antigravity CLI'))
          }
        }
      } else if (typeof message.id === 'number') {
        const pending = this.remove(message.id)
        if (!pending) continue // Late response after timeout/cancel is deliberately discarded.
        if (message.error && typeof message.error === 'object') {
          const error = message.error as { code?: unknown; message?: unknown }
          pending.reject(
            new AcpError(
              typeof error.code === 'number' ? error.code : 'remote_error',
              safeGeminiMessage(error.message)
            )
          )
        } else if ('result' in message) pending.resolve(message.result)
        else pending.reject(new AcpError('invalid_response', 'Phản hồi ACP thiếu kết quả'))
      } else this.fail(new AcpError('invalid_response', 'Phản hồi ACP thiếu mã yêu cầu'))
    }
    if (this.buffer.length > MAX_FRAME)
      this.fail(new AcpError('frame_too_large', 'Phản hồi Antigravity CLI vượt giới hạn'))
  }
  private fail(error: Error): void {
    if (this.ended) return
    this.ended = true
    for (const id of [...this.pending.keys()]) this.remove(id)?.reject(error)
    try {
      this.handlers.onClose?.(error)
    } catch {
      /* Closing is unconditional, including consumer failures. */
    }
    void this.terminate()
  }
  private termination?: Promise<void>
  private terminate(): Promise<void> {
    return (this.termination ??= new Promise<void>((done) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) return done()
      const finish = () => {
        clearTimeout(timer)
        clearTimeout(softTimer)
        done()
      }
      const timer = setTimeout(() => {
        this.child.kill('SIGKILL')
        done()
      }, 3000)
      const softTimer = setTimeout(() => {
        this.child.kill('SIGTERM')
      }, 1000)
      this.child.once('exit', finish)
      // The connection manager closes native ACP sessions and workers before this parent.
      // Never terminate a process tree: the user's newly opened browser is user-owned.
      this.child.stdin.end()
    }))
  }
  close(): Promise<void> {
    return (this.closePromise ??= (async () => {
      this.fail(new AcpError('process_closed', 'Đã đóng kết nối Antigravity CLI'))
      await this.terminate()
      if (this.child.exitCode === null && this.child.signalCode === null)
        throw new AcpError('process_stop_failed', 'Chưa xác nhận Antigravity CLI đã dừng')
    })())
  }
}
