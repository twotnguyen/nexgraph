// Máy chủ OpenAI-compatible giả dùng chung cho test F4 (mục 1: context window, mục 2: phân loại lỗi).
import http from 'node:http'

export type Seen = { bodies: string[]; paths: string[]; auth: string[] }

/** Lỗi theo model; thân yêu cầu khác nhận một câu trả lời SSE ngắn. */
export function fakeProvider(seen: Seen): Promise<{ url: string; close: () => Promise<void> }> {
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.paths.push(`${req.method} ${req.url}`)
      seen.auth.push(String(req.headers.authorization))
      if (req.method === 'GET' && req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ data: [{ id: 'fake-1', context_length: 65536 }, { id: 'other', context_length: 8192 }] }))
      }
      seen.bodies.push(body)
      const j = JSON.parse(body || '{}') as { model?: string; max_completion_tokens?: number; max_tokens?: number }
      const send = (c: object) => res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'fake-1', ...c })}\n\n`)
      if (j.model === 'no-such-model') {
        res.writeHead(404, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { message: 'The model `no-such-model` does not exist', type: 'invalid_request_error', code: 'model_not_found' } }))
      }
      if (j.model === 'rejects-params') {
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { message: "Invalid 'max_output_tokens': integer below minimum value. Expected a value >= 16, but got 1 instead.", type: 'invalid_request_error', param: 'max_output_tokens' } }))
      }
      if (j.model === 'denied') {
        res.writeHead(401, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }))
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      send({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Xong [[a.py:1-1]]' }, finish_reason: null }] })
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } })
      res.end('data: [DONE]\n\n')
    })
  })
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({
    url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`,
    close: () => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()) })
  })))
}
