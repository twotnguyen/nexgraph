// Máy chủ LLM giả tương thích OpenAI để kiểm chat không cần API key.
// Dùng: node scripts/fake-llm.mjs [cổng]   -> đặt Base URL = http://127.0.0.1:<cổng>/v1 trong Cài đặt.
// Kịch bản: gọi list_flows -> trace_flow (flow_id lấy từ kết quả tool trước) -> trả lời có trích dẫn dựng từ các bước, cộng một trích dẫn sai.
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const toolCall = (name, args) => ({ role: 'assistant', content: null,
  tool_calls: [{ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
const text = (m) => (typeof m.content === 'string' ? m.content : (m.content ?? []).map((p) => p.text ?? '').join(''))

// Các tình huống ép tool call chỉ dùng trong hồ sơ tạm của smoke Electron.
const readOnlyTools = [
  'get_context', 'search', 'get_node', 'get_neighbors', 'read_code', 'list_flows', 'trace_flow',
  'get_architecture', 'get_impact', 'read', 'grep', 'find', 'ls'
]
const shellCall = toolCall('bash', { command: 'printf NEXGRAPH_SMOKE > smoke-shell-should-not-run.txt' })
const smokeCalls = {
  NEXGRAPH_SMOKE_ASK_WRITE: { editing: false, call: toolCall('write', {
    path: 'smoke-read-should-not-write.txt', content: 'NEXGRAPH_SMOKE'
  }) },
  NEXGRAPH_SMOKE_ASK_SHELL: { editing: false, call: shellCall },
  NEXGRAPH_SMOKE_EDIT_SHELL: { editing: true, call: shellCall },
  NEXGRAPH_SMOKE_EDIT_FILE: { editing: true, call: toolCall('edit', {
    path: 'smoke.ts', edits: [{ oldText: '  return true', newText: '  return false' }]
  }) }
}

function smokePolicy(scenario, advertised, results) {
  if (results.length) return { role: 'assistant', content: 'NEXGRAPH_SMOKE_POLICY_OK' }
  const expected = scenario.editing ? [...readOnlyTools, 'edit', 'write'] : readOnlyTools
  const names = (advertised ?? []).map((item) => item.function?.name)
  if (names.length !== expected.length || expected.some((name) => !names.includes(name))) {
    throw new Error('Bộ công cụ quảng bá của agent không đúng chế độ')
  }
  return scenario.call
}

/** Trả một tin nhắn dạng JSON thường, hoặc SSE khi client xin `stream: true` (harness pi luôn stream). */
function reply(res, stream, msg) {
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ choices: [{ message: msg }] }))
  }
  const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const tool_calls = msg.tool_calls?.map((t, index) => ({ index, ...t }))
  res.write(chunk({ role: 'assistant', content: msg.content, ...(tool_calls ? { tool_calls } : {}) }))
  res.write(chunk({}, tool_calls ? 'tool_calls' : 'stop'))
  res.end('data: [DONE]\n\n')
}

function readToolResult(message, name) {
  const content = text(message).trim()
  // runTool bọc dữ liệu trong delimiter; fixture cũ có thể gửi JSON trực tiếp.
  const opening = `<nexgraph_tool_result> tool="${name}"\n`
  const closing = '\n</nexgraph_tool_result>'
  const payload = content.startsWith(opening) && content.endsWith(closing)
    ? content.slice(opening.length, -closing.length)
    : content
  return JSON.parse(payload)
}

function complete(messages, maxTokens, advertised) {
  const lastUser = messages.findLastIndex((m) => m.role === 'user')
  const question = text(messages[lastUser] ?? {})
  if (question === 'NEXGRAPH_SMOKE') return { role: 'assistant', content: 'NEXGRAPH_SMOKE_OK' }
  if (maxTokens === 1) return { role: 'assistant', content: 'pong' }
  const tools = messages.slice(lastUser).filter((m) => m.role === 'tool')
  if (Object.hasOwn(smokeCalls, question)) return smokePolicy(smokeCalls[question], advertised, tools)
  if (tools.length === 0) return toolCall('list_flows', { query: 'login' })
  if (tools.length === 1) {
    const flows = readToolResult(tools[0], 'list_flows').flows ?? []
    return toolCall('trace_flow', { flow_id: flows[0]?.id ?? 0 })
  }
  const steps = readToolResult(tools[1], 'trace_flow').steps ?? []
  // Kịch bản chỉ dành cho bản sao fixture flow_app khi kiểm duyệt trong app.
  if (question.includes('NEXGRAPH_DEMO_EDIT')) {
    if (tools.length === 2) {
      const changed = steps.find((s) => s.node.file === 'service.py' && s.node.label.includes('login_user'))
      return toolCall('get_impact', { node_id: (changed ?? steps[0])?.node.id ?? '' })
    }
    if (tools.length === 3) return toolCall('edit', {
      path: 'service.py',
      edits: [{ oldText: 'return save_session(user)', newText: 'return save_session(user)  # NexGraph demo' }]
    })
  }
  const lines = steps.slice(0, 3).map((s, i) => `${i + 1}. ${s.node.label} [[${s.node.file}:${s.node.line_start}-${s.node.line_end}]]`)
  return { role: 'assistant', content: `${lines.join('\n')}\n${steps.length + 1}. Bước không có thật [[khong-co.ts:1-2]]` }
}

export function createFakeLlm() {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (!req.url.endsWith('/chat/completions')) return send(404, {})
      let msg, stream
      try {
        const payload = JSON.parse(body || '{}')
        msg = complete(payload.messages ?? [], payload.max_tokens, payload.tools)
        stream = payload.stream
      } catch {
        return send(400, { error: { message: 'Yêu cầu LLM giả hoặc kết quả tool không hợp lệ' } })
      }
      reply(res, stream, msg)
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? 0)
  const server = createFakeLlm()
  server.listen(port, '127.0.0.1', () => console.log(`fake LLM: http://127.0.0.1:${server.address().port}/v1`))
}
