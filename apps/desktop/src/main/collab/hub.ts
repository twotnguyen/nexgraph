import { randomInt } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import type { CollabEvent, CollabHello } from '../../shared/api'
import { UserError } from '../user-error'

const MAX_PEERS = 8
const MAX_MESSAGE = 16 * 1024 * 1024
const fail = (code: string, message: string) => new UserError(code, message)

/** Địa chỉ IPv4 trong mạng LAN của máy (bỏ loopback), để người khác nhập khi tham gia. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces()).flat().filter((n): n is NonNullable<typeof n> => !!n && n.family === 'IPv4' && !n.internal).map((n) => n.address)
}

const asBuffer = (data: RawData): Buffer => (Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data))

/**
 * Cộng tác trong LAN kiểu Wu nhưng ngang hàng, không qua máy chủ đám mây: máy chia sẻ mở WebSocket trên cổng ngẫu nhiên,
 * người tham gia nối thẳng bằng địa chỉ + mã 6 số. Main chỉ chuyển tiếp gói nhị phân (bản cập nhật Yjs, trạng thái con trỏ);
 * tài liệu và CRDT nằm ở renderer mỗi bên.
 */
export class CollabHub {
  private server: WebSocketServer | null = null
  private readonly peers = new Set<WebSocket>()
  private client: WebSocket | null = null
  private hello: CollabHello | null = null

  constructor(private readonly emit: (event: CollabEvent) => void) {}

  /** Bắt đầu chia sẻ; trả về địa chỉ và mã cho người tham gia. */
  async host(hello: CollabHello, port = 0): Promise<{ addresses: string[]; port: number; code: string }> {
    this.stop()
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const server = new WebSocketServer({ host: '0.0.0.0', port, maxPayload: MAX_MESSAGE, verifyClient: ({ req }, done) => {
      const given = new URL(req.url ?? '/', 'ws://x').searchParams.get('code')
      done(given === code && this.peers.size < MAX_PEERS, 401)
    } })
    await new Promise<void>((ok, err) => { server.once('listening', ok); server.once('error', err) })
    this.server = server
    this.hello = hello
    server.on('connection', (socket) => {
      this.peers.add(socket)
      socket.send(JSON.stringify(hello))
      this.emit({ type: 'peers', count: this.peers.size })
      // Người mới cần toàn bộ trạng thái hiện tại: renderer bên chia sẻ gửi lại.
      this.emit({ type: 'joined' })
      socket.on('message', (data, isBinary) => {
        if (!isBinary) return
        const message = asBuffer(data)
        this.emit({ type: 'message', data: new Uint8Array(message) })
        for (const other of this.peers) if (other !== socket && other.readyState === WebSocket.OPEN) other.send(message)
      })
      socket.on('close', () => { this.peers.delete(socket); this.emit({ type: 'peers', count: this.peers.size }) })
    })
    const address = server.address()
    return { addresses: lanAddresses(), port: typeof address === 'object' && address ? address.port : port, code }
  }

  /** Tham gia phiên của máy khác; trả về tệp đang chia sẻ. */
  async join(address: string, code: string): Promise<CollabHello> {
    this.stop()
    if (!/^[\w.-]+:\d{1,5}$/.test(address) || !/^\d{6}$/.test(code)) throw fail('bad_param', 'Địa chỉ phải dạng máy:cổng và mã gồm 6 chữ số')
    const socket = new WebSocket(`ws://${address}/?code=${code}`, { maxPayload: MAX_MESSAGE, handshakeTimeout: 8_000 })
    this.client = socket
    const hello = await new Promise<CollabHello>((ok, err) => {
      socket.once('message', (data, isBinary) => {
        try {
          const parsed: unknown = JSON.parse(asBuffer(data).toString('utf8'))
          if (isBinary || !parsed || typeof parsed !== 'object' || !('file' in parsed) || typeof parsed.file !== 'string') throw new Error()
          ok({ file: parsed.file, host: 'host' in parsed && typeof parsed.host === 'string' ? parsed.host : 'NexGraph' })
        } catch { err(fail('bad_peer', 'Máy chia sẻ trả lời không hợp lệ')) }
      })
      socket.once('error', (e) => err(fail('connect_failed', `Không nối được ${address}: ${e.message}`)))
      socket.once('unexpected-response', (_req, res) => err(fail('connect_failed', res.statusCode === 401 ? 'Sai mã hoặc phiên đã đủ người' : `Máy chia sẻ trả về ${res.statusCode}`)))
    })
    socket.on('message', (data, isBinary) => { if (isBinary) this.emit({ type: 'message', data: new Uint8Array(asBuffer(data)) }) })
    socket.on('close', () => { if (this.client === socket) { this.client = null; this.emit({ type: 'closed' }) } })
    return hello
  }

  /** Gói từ renderer: bên chia sẻ gửi mọi người, bên tham gia gửi về máy chia sẻ. */
  send(data: Uint8Array): void {
    if (data.byteLength > MAX_MESSAGE) return
    if (this.client?.readyState === WebSocket.OPEN) this.client.send(data)
    for (const peer of this.peers) if (peer.readyState === WebSocket.OPEN) peer.send(data)
  }

  stop(): void {
    for (const peer of this.peers) peer.close()
    this.peers.clear()
    this.server?.close()
    this.server = null
    this.hello = null
    if (this.client) { const c = this.client; this.client = null; c.close() }
  }

  get hosting(): CollabHello | null { return this.hello }
}
