import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { NexClient, NexHttpError } from '../src/main/features/agent/nex/client'

const servers: Server[] = []
afterEach(() => { for (const server of servers.splice(0)) server.close() })

const start = async (handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; auth: () => string | undefined }> => {
  let authorization: string | undefined
  const server = createServer((req, res) => { authorization = req.headers.authorization; handler(req, res) })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { url: `http://127.0.0.1:${port}`, auth: () => authorization }
}

describe('NexClient', () => {
  it('gửi Basic Auth, tạo phiên với model và bóc envelope data', async () => {
    const { url, auth } = await start((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/session' && req.method === 'POST') { res.end(JSON.stringify({ data: { id: 'ses_1' } })); return }
      res.statusCode = 404; res.end('{}')
    })
    const client = new NexClient({ baseUrl: url, secret: 'pw' })
    const session = await client.createSession({ title: 'qa', model: { providerID: 'nexgraph', id: 'gpt' } })
    expect(session.id).toBe('ses_1')
    expect(auth()).toBe(`Basic ${Buffer.from('opencode:pw').toString('base64')}`)
  })

  it('ném NexHttpError khi sai mật khẩu, không trả body', async () => {
    const { url } = await start((_req, res) => { res.statusCode = 401; res.end('{"apiKey":"sk-leak"}') })
    const client = new NexClient({ baseUrl: url, secret: 'wrong' })
    await expect(client.info()).rejects.toBeInstanceOf(NexHttpError)
    await expect(client.info()).rejects.not.toThrow('sk-leak')
  })

  it('đọc frame SSE và bỏ qua heartbeat/frame hỏng', async () => {
    const { url } = await start((req, res) => {
      if (req.url !== '/api/event') { res.statusCode = 404; res.end('{}'); return }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': heartbeat\n\n')
      res.write(`data: ${JSON.stringify({ type: 'server.connected', data: {} })}\n\n`)
      res.write('data: {hỏng\n\n')
      res.write(`data: ${JSON.stringify({ type: 'session.text.delta', data: { sessionID: 'ses_1', delta: 'Xin chào' } })}\n\n`)
      setTimeout(() => res.end(), 20)
    })
    const client = new NexClient({ baseUrl: url, secret: 'pw', reconnectDelayMs: 5_000 })
    const events: string[] = []
    const stop = client.subscribe((event) => events.push(event.type))
    await new Promise((resolve) => setTimeout(resolve, 150))
    stop()
    expect(events).toEqual(['server.connected', 'session.text.delta'])
  })

  it('trả lời permission đúng đường dẫn và decision', async () => {
    const seen: string[] = []
    const { url } = await start((req, res) => {
      seen.push(`${req.method} ${req.url}`)
      res.statusCode = 204; res.end()
    })
    const client = new NexClient({ baseUrl: url, secret: 'pw' })
    await client.replyPermission('ses_1', 'per_1', 'once')
    await client.interrupt('ses_1')
    expect(seen).toEqual(['POST /api/session/ses_1/permission/per_1/reply', 'POST /api/session/ses_1/interrupt'])
  })
})
