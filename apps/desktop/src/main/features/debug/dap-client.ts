import type { Readable, Writable } from 'node:stream'

type Pending = { resolve: (body: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
export type DapEvent = { event: string; body?: Record<string, unknown> }

/**
 * Debug Adapter Protocol qua một cặp stream (stdio của adapter hoặc socket TCP), khung "Content-Length" như LSP.
 * Yêu cầu ngược từ adapter (runInTerminal, startDebugging) trả lời bằng `onRequest`.
 */
export class DapClient {
  private buffer = Buffer.alloc(0)
  private seq = 1
  private readonly pending = new Map<number, Pending>()
  onEvent: (event: DapEvent) => void = () => {}
  onRequest: (command: string, args: Record<string, unknown>) => Promise<unknown> | unknown = () => { throw new Error('Không hỗ trợ') }

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
      let message: { type?: string; seq?: number; request_seq?: number; success?: boolean; message?: string; command?: string; event?: string; body?: Record<string, unknown>; arguments?: Record<string, unknown> }
      try { message = JSON.parse(body) } catch { continue }
      if (message.type === 'response' && typeof message.request_seq === 'number') {
        const waiter = this.pending.get(message.request_seq)
        if (!waiter) continue
        this.pending.delete(message.request_seq)
        clearTimeout(waiter.timer)
        if (message.success) waiter.resolve(message.body)
        else waiter.reject(new Error(message.message || `${message.command} thất bại`))
      } else if (message.type === 'event' && message.event) {
        this.onEvent({ event: message.event, body: message.body })
      } else if (message.type === 'request' && message.command) {
        const reply = (success: boolean, extra: object) => this.send({ type: 'response', request_seq: message.seq, command: message.command, success, ...extra })
        Promise.resolve().then(() => this.onRequest(message.command!, message.arguments ?? {}))
          .then((result) => reply(true, { body: result ?? {} }), (error: unknown) => reply(false, { message: error instanceof Error ? error.message : String(error) }))
      }
    }
  }

  private send(message: object): void {
    const body = Buffer.from(JSON.stringify({ seq: this.seq++, ...message }), 'utf8')
    this.output.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.output.write(body)
  }

  request<T = Record<string, unknown>>(command: string, args?: unknown, timeoutMs = 30_000): Promise<T> {
    const seq = this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(seq); reject(new Error(`Debug adapter không trả lời ${command}`)) }, timeoutMs)
      this.pending.set(seq, { resolve: resolve as (body: unknown) => void, reject, timer })
      this.send({ type: 'request', command, ...(args === undefined ? {} : { arguments: args }) })
    })
  }

  close(reason: string): void {
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(reason)) }
    this.pending.clear()
  }
}
