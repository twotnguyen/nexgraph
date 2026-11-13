// Máy chủ LLM giả tương thích OpenAI để kiểm chat không cần API key.
// Dùng: node scripts/fake-llm.mjs [cổng]   -> đặt Base URL = http://127.0.0.1:<cổng>/v1 trong Cài đặt.
// Kịch bản: gọi list_flows -> trace_flow (flow_id lấy từ kết quả tool trước) -> trả lời có trích dẫn dựng từ các bước, cộng một trích dẫn sai.
import http from 'node:http'

const toolCall = (name, args) => ({ choices: [{ message: { role: 'assistant', content: null,
  tool_calls: [{ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] })

export function createFakeLlm() {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (!req.url.endsWith('/chat/completions')) return send(404, {})
      const { messages = [], max_tokens } = JSON.parse(body || '{}')
      if (max_tokens === 1) return send(200, { choices: [{ message: { role: 'assistant', content: 'pong' } }] })
      const tools = messages.filter((m) => m.role === 'tool')
      if (tools.length === 0) return send(200, toolCall('list_flows', { query: 'login' }))
      if (tools.length === 1) {
        const flows = JSON.parse(tools[0].content).flows ?? []
        return send(200, toolCall('trace_flow', { flow_id: flows[0]?.id ?? 0 }))
      }
      const steps = JSON.parse(tools[1].content).steps ?? []
      const lines = steps.slice(0, 3).map((s, i) => `${i + 1}. ${s.node.label} [[${s.node.file}:${s.node.line_start}-${s.node.line_end}]]`)
      send(200, { choices: [{ message: { role: 'assistant', content: `${lines.join('\n')}\n${steps.length + 1}. Bước không có thật [[khong-co.ts:1-2]]` } }] })
    })
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 0)
  const server = createFakeLlm()
  server.listen(port, '127.0.0.1', () => console.log(`fake LLM: http://127.0.0.1:${server.address().port}/v1`))
}
