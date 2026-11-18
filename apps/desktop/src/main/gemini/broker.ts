import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Check } from 'typebox/value'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolRun } from '../../shared/agent-types'
import { registerNexgraphTools, toolsFor, type NexgraphToolCall, type NexgraphToolDeps, type NexgraphToolGateResult, type NexgraphToolPort } from '../agent/extension'

const MAX_BODY = 256 * 1024
export type BrokerContent = { type: string; text?: string; data?: string; mimeType?: string }
export type BrokerReply = { content: BrokerContent[]; isError?: boolean }
export type BrokerTool = { name: string; description: string; inputSchema: object; execute(input: unknown, id: string, signal?: AbortSignal): Promise<BrokerReply> }
export type McpServerConfig = { type: 'http'; name: string; url: string; headers: { name: string; value: string }[] }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** CLI confirmation only forwards our known MCP call to the real NexGraph gate. */
export function brokerPermission(params: unknown, sessionId: string | null, names: readonly string[]): { outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: 'allow' } } {
  const request = record(params)
  const call = record(request.toolCall)
  const options = Array.isArray(request.options) ? request.options.map(record) : []
  // The pinned native server derives this name from its configured MCP server
  // and tool registry. Titles and arguments never grant access. The private
  // custom agent has no native filesystem, shell or subagent tools.
  if (sessionId && request.sessionId === sessionId && typeof call.name === 'string' && names.some((name) => call.name === `mcp_nexgraph_${name}`) &&
    options.some((option) => option.kind === 'allow_once' && option.optionId === 'allow')) return { outcome: { outcome: 'selected', optionId: 'allow' } }
  return { outcome: { outcome: 'cancelled' } }
}

const clean = (value: string, limit = 32_000) => value.slice(0, limit).replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [ẩn]').replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[khóa đã ẩn]')
const text = (value: string, isError = false): BrokerReply => ({ content: [{ type: 'text', text: clean(value) }], ...(isError ? { isError } : {}) })

/** The same tool definitions and before-call checks used by Pi, without loading a Pi session. */
export function nexgraphBrokerTools(deps: NexgraphToolDeps & {
  assertCurrent(): void
  getSignal(): AbortSignal | undefined
  onTool?(tool: AgentToolRun): void
}): BrokerTool[] {
  const definitions: ToolDefinition[] = []
  let before: ((event: NexgraphToolCall) => Promise<NexgraphToolGateResult>) | undefined
  const port: NexgraphToolPort = {
    registerTool: (tool) => { definitions.push(tool as ToolDefinition) },
    on: ((event: string, callback: (() => void) | ((event: NexgraphToolCall) => Promise<NexgraphToolGateResult>)) => {
      if (event === 'agent_start') (callback as () => void)()
      else before = callback as (event: NexgraphToolCall) => Promise<NexgraphToolGateResult>
    }) as NexgraphToolPort['on']
  }
  registerNexgraphTools(port, deps)
  return definitions.map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.parameters,
    async execute(input, id, signal) {
      deps.assertCurrent()
      const activeSignal = deps.getSignal()
      activeSignal?.throwIfAborted(); signal?.throwIfAborted()
      if (!toolsFor(deps.getMode?.() ?? 'ask').includes(definition.name)) throw new Error('Chế độ hiện tại chỉ cho phép đọc')
      if (!Check(definition.parameters, input)) throw new Error('Tham số công cụ không hợp lệ')
      const run: AgentToolRun = { id, name: definition.name, input: clean(JSON.stringify(input), 8000), output: '', status: 'running', startedAt: Date.now() }
      deps.onTool?.({ ...run })
      try {
        const result = await before?.({ toolName: definition.name, toolCallId: id, input })
        if (result?.block) throw new Error(result.reason)
        deps.assertCurrent()
        activeSignal?.throwIfAborted(); signal?.throwIfAborted()
        // Registered scoped tools consume no Pi extension context. Their entire
        // access surface is supplied in NexgraphToolDeps and AbortSignal.
        const value = await definition.execute(id, input, activeSignal ?? signal, undefined, undefined as never)
        deps.assertCurrent()
        const content = value.content as BrokerContent[]
        run.status = 'completed'
        run.output = clean(content.map((part) => part.text ?? '').join('\n'))
        run.durationMs = Date.now() - run.startedAt
        deps.onTool?.({ ...run })
        return { content }
      } catch (error) {
        run.status = 'failed'; run.durationMs = Date.now() - run.startedAt
        run.output = clean(error instanceof Error ? error.message : String(error))
        deps.onTool?.({ ...run })
        throw error
      }
    }
  }))
}

/** Authenticated Streamable-HTTP MCP, local to one CLI project session. */
export class GeminiMcpBroker {
  private server?: Server
  private readonly token = randomBytes(32).toString('base64url')
  private readonly mcpSession = randomUUID()
  private url = ''
  private closed = false
  private active = 0
  constructor(private readonly deps: { tools(): BrokerTool[]; assertCurrent(): void; onRequest?(method: string): void }) {}

  async start(): Promise<McpServerConfig> {
    if (this.server) return this.config()
    this.server = createServer(async (request, response) => {
      const reply = (status: number, body?: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'Mcp-Session-Id': this.mcpSession })
        response.end(body === undefined ? undefined : JSON.stringify(body))
      }
      this.deps.onRequest?.(request.method ?? '')
      if (this.closed || request.url !== '/mcp' || !this.authorized(request.headers.authorization) || request.headers.origin) return reply(403, { error: 'Access denied' })
      if (request.method === 'DELETE') return reply(204)
      if (request.method !== 'POST') return reply(405)
      if (!String(request.headers['content-type']).startsWith('application/json')) return reply(415)
      let id: unknown = null
      try {
        const chunks: Buffer[] = []; let bytes = 0
        for await (const chunk of request) {
          const data = Buffer.from(chunk)
          bytes += data.length
          if (bytes > MAX_BODY) return reply(413, { error: 'Request too large' })
          chunks.push(data)
        }
        const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown }
        id = message.id ?? null
        if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || Array.isArray(message)) throw new Error('Invalid JSON-RPC request')
        this.deps.onRequest?.(message.method)
        if (message.id === undefined) return reply(202)
        let result: unknown
        if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'nexgraph', version: '0.1.0' } }
        else if (message.method === 'ping') result = {}
        else if (message.method === 'tools/list') result = { tools: this.deps.tools().map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, _meta: { 'antigravity/alwaysLoad': true } })) }
        else if (message.method === 'tools/call') {
          this.deps.assertCurrent()
          if (this.active >= 8) throw new Error('Có quá nhiều công cụ đang chạy')
          const params = message.params as { name?: unknown; arguments?: unknown } | null
          if (!params || typeof params.name !== 'string') throw new Error('Missing tool name')
          const tool = this.deps.tools().find((candidate) => candidate.name === params.name)
          if (!tool) throw new Error('Công cụ không được phép dùng trong chế độ hiện tại')
          this.active++
          try { result = await tool.execute(params.arguments ?? {}, randomUUID()) }
          catch (error) { result = text(error instanceof Error ? error.message : String(error), true) }
          finally { this.active-- }
        } else return reply(200, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
        reply(200, { jsonrpc: '2.0', id, result })
      } catch (error) {
        reply(200, { jsonrpc: '2.0', id, error: { code: -32600, message: clean(error instanceof Error ? error.message : 'Invalid request', 2000) } })
      }
    })
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Không mở được cổng công cụ Gemini')
    this.url = `http://127.0.0.1:${address.port}/mcp`
    return this.config()
  }
  private authorized(raw: string | undefined): boolean {
    const expected = Buffer.from(`Bearer ${this.token}`)
    const actual = Buffer.from(raw ?? '')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }
  private config(): McpServerConfig { return { type: 'http', name: 'nexgraph', url: this.url, headers: [{ name: 'Authorization', value: `Bearer ${this.token}` }] } }
  async close(): Promise<void> {
    this.closed = true
    if (!this.server) return
    this.server.closeAllConnections()
    await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = undefined
  }
}
