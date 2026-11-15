import http from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Type } from 'typebox'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const sse = (res: http.ServerResponse, chunks: object[]): void => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const c of chunks) res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'fake-1', ...c })}\n\n`)
  res.end('data: [DONE]\n\n')
}
function fakeServer(log: string[]): Promise<{ url: string; close: () => void }> {
  const srv = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => {
      const j = JSON.parse(b || '{}')
      const hasTool = (j.messages ?? []).some((m: { role: string }) => m.role === 'tool')
      log.push(`${req.method} ${req.url} tools=${(j.tools ?? []).map((t: { function: { name: string } }) => t.function.name).join(',')} hasToolResult=${hasTool}`)
      if (!hasTool) {
        const tc = (i: number, name: string, args: object) => ({ index: i, id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
        return sse(res, [
          { choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [tc(0, 'ping', { msg: 'hi' }), tc(1, 'bash', { command: 'echo pwned' }), tc(2, 'edit', { path: 'a.txt', oldText: 'hello', newText: 'bye' }), tc(3, 'write', { path: 'b.txt', content: 'x' })] }, finish_reason: null }] },
          { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
        ])
      }
      sse(res, [
        { choices: [{ index: 0, delta: { role: 'assistant', content: 'Xong ' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: 'rồi.' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }
      ])
    })
  })
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1`, close: () => srv.close() })))
}

export async function runPiSpike(): Promise<string[]> {
  const { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, isToolCallEventType } = await import('@earendil-works/pi-coding-agent')
  const out: string[] = []
  const log: string[] = []
  out.push(`electron=${process.versions.electron} node=${process.versions.node} chrome=${process.versions.chrome} platform=${process.platform}-${process.arch}`)
  const srv = await fakeServer(log)
  const dir = mkdtempSync(join(tmpdir(), 'ng-pi-'))
  writeFileSync(join(dir, 'a.txt'), 'hello')
  const factory = (pi: ExtensionAPI): void => {
    pi.registerProvider('fake', {
      name: 'Fake', baseUrl: srv.url, apiKey: 'fake-key', api: 'openai-completions',
      models: [{ id: 'fake-1', name: 'Fake 1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4096 }]
    })
    pi.registerTool({
      name: 'ping', label: 'Ping', description: 'Ping', parameters: Type.Object({ msg: Type.String() }),
      async execute(_id, params) { out.push(`ping.execute msg=${params.msg}`); return { content: [{ type: 'text', text: 'pong' }], details: undefined } }
    })
    pi.on('tool_call', async (event) => {
      out.push(`tool_call ${event.toolName} input=${JSON.stringify(event.input)}`)
      if (event.toolName !== 'ping') return { block: true, reason: 'chặn trong spike' }
      if (isToolCallEventType('bash', event)) return { block: true, reason: 'bash bị chặn trong spike' }
      return undefined
    })
  }
  const agentDir = join(dir, 'agent')
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json') })
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir, agentDir, extensionFactories: [factory],
    appendSystemPromptOverride: (base) => [...base, 'SPIKE-APPEND-MARKER']
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({ cwd: dir, sessionManager: SessionManager.inMemory(), tools: ['read', 'ping', 'bash', 'edit', 'write'], resourceLoader, modelRuntime })
  out.push(`active tools=${session.getActiveToolNames().join(',')}`)
  out.push(`providers with oauth=${modelRuntime.getProviders().filter((p) => p.auth.oauth).length}/${modelRuntime.getProviders().length}`)
  const m = modelRuntime.getModel('fake', 'fake-1')
  out.push(`model found=${!!m}`)
  if (m) await session.setModel(m)
  let deltas = 0, text = ''
  session.subscribe((e) => {
    if (e.type === 'message_update' && e.assistantMessageEvent.type === 'text_delta') { deltas++; text += e.assistantMessageEvent.delta }
  })
  await session.prompt('gọi ping rồi bash')
  out.push(`text_delta count=${deltas} text=${JSON.stringify(text)}`)
  out.push(`systemPrompt has marker=${session.systemPrompt.includes('SPIKE-APPEND-MARKER')}`)
  out.push(...log.map((l) => `server: ${l}`))
  const toolMsgs = session.messages.filter((x) => x.role === 'toolResult').map((x) => JSON.stringify(x.content))
  out.push(`toolResults=${toolMsgs.join(' | ')}`)
  session.dispose()
  srv.close()
  return out
}
