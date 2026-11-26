import type { Readable, Writable } from 'node:stream'

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

/**
 * JSON-RPC 2.0 qua stdio theo khung "Content-Length" của Language Server Protocol.
 * Yêu cầu từ server (workspace/configuration, đăng ký capability…) được trả lời bằng `onRequest`.
 */
export class LspConnection {
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  onRequest: (method: string, params: unknown) => unknown = () => null
  onNotification: (method: string, params: unknown) => void = () => {}

  constructor(input: Readable, private readonly output: Writable) {
    input.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.drain()
    })
  }

  private drain(): void {
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const length = Number(/Content-Length: *(\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString('ascii'))?.[1])
      if (!Number.isFinite(length)) { this.buffer = this.buffer.subarray(headerEnd + 4); continue }
      if (this.buffer.length < headerEnd + 4 + length) return
      const body = this.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')
      this.buffer = this.buffer.subarray(headerEnd + 4 + length)
      let message: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message: string } }
      try { message = JSON.parse(body) } catch { continue }
      if (message.method && message.id !== undefined) {
        let result: unknown = null
        try { result = this.onRequest(message.method, message.params) } catch { result = null }
        this.send({ jsonrpc: '2.0', id: message.id, result })
      } else if (message.method) {
        this.onNotification(message.method, message.params)
      } else if (typeof message.id === 'number') {
        const waiter = this.pending.get(message.id)
        if (!waiter) continue
        this.pending.delete(message.id)
        clearTimeout(waiter.timer)
        if (message.error) waiter.reject(new Error(message.error.message))
        else waiter.resolve(message.result)
      }
    }
  }

  private send(message: object): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8')
    this.output.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.output.write(body)
  }

  request<T>(method: string, params: unknown, timeoutMs = 15_000): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Language server không trả lời ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  /** Huỷ mọi yêu cầu đang chờ (server đã thoát). */
  close(reason: string): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error(reason))
    }
    this.pending.clear()
  }
}
