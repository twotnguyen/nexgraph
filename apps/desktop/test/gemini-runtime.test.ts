import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Type } from 'typebox'
import type { EngineApi } from '../src/main/platform/engine/api'
import type { AgentEvent, GeminiConsentTarget } from '../src/shared/agent-types'
import { GeminiAgentService, type GeminiAcpClient } from '../src/main/features/agent/gemini/service'
import { brokerPermission, GeminiMcpBroker } from '../src/main/features/agent/gemini/broker'
import { GeminiSessions } from '../src/main/features/agent/gemini/sessions'

const roots: string[] = []
const services: GeminiAgentService[] = []
afterEach(async () => { for (const service of services.splice(0)) service.closeAll(); await new Promise((resolve) => setTimeout(resolve, 30)); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const temp = () => { const root = mkdtempSync(join(tmpdir(), 'nexgraph-gemini-test-')); roots.push(root); return root }
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const TARGET: GeminiConsentTarget = { runtime: 'antigravity-cli', provider: 'google-antigravity', connectionId: 'connection-a' }

class FakeAcp implements GeminiAcpClient {
  sessionCwd: string
  initializeResult = { agentCapabilities: { loadSession: true, promptCapabilities: { image: false } } }
  handlers: Parameters<GeminiAcpClient['setHandlers']>[0] = {}
  stopped = false
  calls: { method: string; params: Record<string, unknown> }[] = []
  sid: string = randomUUID()
  mcp?: { url: string; headers: { name: string; value: string }[] }
  replay = ''
  script: (self: FakeAcp) => Promise<unknown> = async (self) => { self.delta('Gemini trả lời'); return { stopReason: 'end_turn' } }
  constructor(root: string) { this.sessionCwd = join(root, 'private-transport'); mkdirSync(this.sessionCwd, { recursive: true }) }
  setHandlers(handlers: Parameters<GeminiAcpClient['setHandlers']>[0]) { this.handlers = handlers }
  closed() { return this.stopped }
  async close() { this.stopped = true }
  notify(method: string, params: unknown) { this.calls.push({ method, params: params as Record<string, unknown> }) }
  async request<T>(method: string, params: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    options?.signal?.throwIfAborted()
    const data = params as Record<string, unknown>
    this.calls.push({ method, params: data })
    if (method === 'session/new' || method === 'session/load') {
      if (data.sessionId) this.sid = data.sessionId as string
      this.mcp = (data.mcpServers as FakeAcp['mcp'][])[0]
      if (this.replay) this.delta(this.replay)
      return { sessionId: this.sid, models: { currentModelId: 'auto', availableModels: [{ modelId: 'auto' }] } } as T
    }
    if (method === 'session/prompt') return await this.script(this) as T
    return {} as T
  }
  delta(text: string) { this.handlers.onNotification?.('session/update', { sessionId: this.sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } }) }
  async tool(name: string, args: unknown = {}) {
    const response = await fetch(this.mcp!.url, { method: 'POST', headers: { 'content-type': 'application/json', ...Object.fromEntries(this.mcp!.headers.map(({ name, value }) => [name, value])) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
    return await response.json() as { result?: { content: { text: string }[]; isError?: boolean }; error?: unknown }
  }
}

function setup() {
  const root = temp(); writeFileSync(join(root, 'a.ts'), 'export const value = 1\n')
  const events: AgentEvent[] = []; const clients: FakeAcp[] = []
  let connected = true; let consent = true; let identity = TARGET.connectionId; let dirty = false
  let script: FakeAcp['script'] | undefined
  const createClient = vi.fn(async (_root: string, _handlers?: object, _options?: { maxTurns?: number }) => {
    const client = new FakeAcp(root); if (script) client.script = script; clients.push(client); return client
  })
  const api = { aiSourceExcludes: vi.fn(async () => []), refresh: vi.fn(async () => {}), code: vi.fn(async (_pid: string, file: string, start: number, end: number) => ({ file, start, end, text: readFileSync(join(root, file), 'utf8') })) } as unknown as EngineApi
  const deps = { dataDir: join(root, 'data'), api, rootOf: async () => root, emit: (_pid: string, event: AgentEvent) => events.push(event), consentTarget: async () => connected ? { ...TARGET, connectionId: identity } : null,
    hasConsent: async () => consent, editorState: () => [{ file: 'a.ts', dirty }], connection: { connectionIdentity: () => identity, selectedModel: () => 'auto', createClient, configureSession: vi.fn(async () => {}) } }
  const service = new GeminiAgentService(deps); services.push(service)
  return { root, deps, service, events, clients, createClient, api, setConnected: (value: boolean) => { connected = value }, setConsent: (value: boolean) => { consent = value }, setIdentity: (value: string) => { identity = value }, setDirty: (value: boolean) => { dirty = value }, script: (value: FakeAcp['script']) => { script = value } }
}

describe('Gemini controlled runtime', () => {
  it('opens local history without creating a CLI client or sending source before consent', async () => {
    const f = setup(); f.setConsent(false)
    expect((await f.service.snapshot('p')).runtime).toBe('antigravity-cli')
    expect(f.createClient).not.toHaveBeenCalled()
    await expect(f.service.prompt('p', 'hello', TARGET)).rejects.toMatchObject({ code: 'consent_required' })
    expect(f.createClient).not.toHaveBeenCalled()
  })
  it('drops the old scope and native session when a project id is remapped to another root', async () => {
    const f = setup(); await f.service.prompt('p', 'old project', TARGET)
    const old = (await f.service.snapshot('p')).session!.id
    const replacement = temp(); writeFileSync(join(replacement, 'a.ts'), 'new source')
    f.deps.rootOf = async () => replacement
    const snapshot = await f.service.snapshot('p')
    expect(snapshot.session!.id).not.toBe(old); expect(snapshot.messages).toEqual([])
    expect(await f.service.listSessions('p')).toHaveLength(1)
  })
  it('revalidates the account after awaiting a slow old transport close', async () => {
    const f = setup(); let finishRun!: () => void; let finishClose!: () => void
    f.script(async () => { await new Promise<void>((resolve) => { finishRun = resolve }); return { stopReason: 'end_turn' } })
    const run = f.service.prompt('p', 'old account task', TARGET)
    await vi.waitFor(() => expect(finishRun).toBeTypeOf('function'))
    const client = f.clients[0]
    client.close = () => new Promise<void>((resolve) => { finishClose = () => { client.stopped = true; resolve() } })
    const replacement = temp(); f.deps.rootOf = async () => replacement
    const opening = f.service.snapshot('p')
    const rejected = expect(opening).rejects.toMatchObject({ code: 'ai_provider_changed' })
    await vi.waitFor(() => expect(finishClose).toBeTypeOf('function'))
    f.setIdentity('new-account'); f.service.selectionChanged()
    finishClose(); finishRun()
    await rejected; await run
    expect((await f.service.snapshot('p')).messages).toEqual([])
  })
  it('uses a private ACP cwd, streams once, stores native session and honest unknown usage', async () => {
    const f = setup()
    await f.service.prompt('p', 'hello', TARGET)
    const snapshot = await f.service.snapshot('p')
    expect(f.clients[0].calls[0]).toMatchObject({ method: 'session/new', params: { cwd: f.clients[0].sessionCwd } })
    expect(f.clients[0].sessionCwd).not.toBe(f.root)
    expect(snapshot.messages.map((message) => message.text)).toEqual(['hello', 'Gemini trả lời'])
    expect(snapshot.task).toMatchObject({ status: 'completed', runtime: 'antigravity-cli', turns: 0, turnsKnown: false })
    expect(snapshot.usage.costUsd).toBeNull()
    expect(f.events.filter((event) => event.type === 'text')).toHaveLength(1)
    await f.service.prompt('p', 'again', TARGET)
    expect(f.createClient).toHaveBeenCalledTimes(2)
    expect(f.clients[1].calls[0].method).toBe('session/load')
  })
  it('báo lượt đã được nhận trước sự kiện đầu tiên, không báo khi bị từ chối', async () => {
    const f = setup()
    const at: number[] = []
    f.setConsent(false)
    await expect(f.service.prompt('p', 'no consent', TARGET, undefined, () => at.push(f.events.length)))
      .rejects.toMatchObject({ code: 'consent_required' })
    expect(at).toEqual([])

    f.setConsent(true)
    await f.service.prompt('p', 'report accepted', TARGET, undefined, () => at.push(f.events.length))
    expect(at).toEqual([0])
    expect(f.events.length).toBeGreaterThan(0)
  })
  it('forks local history into a new native session with prior text and tool results in its first prompt', async () => {
    const f = setup()
    f.script(async (client) => {
      await client.tool('read', { path: 'a.ts' })
      client.delta('Original answer')
      return { stopReason: 'end_turn' }
    })
    await f.service.prompt('p', 'Original question', TARGET)
    const parent = await f.service.snapshot('p')
    const originalNative = f.clients[0].sid
    await f.service.renameSession('p', parent.session!.id, 'Named history')
    f.service.setExecution('p', { policy: 'auto', allowCommands: true })
    const fork = await f.service.forkSession('p', parent.session!.id)
    expect(fork.session?.id).not.toBe(parent.session!.id)
    expect(fork.session?.title).toBe('Named history')
    expect(fork.messages).toEqual(parent.messages)
    expect(fork.task).toBeNull()
    expect(fork.execution).toEqual({ policy: 'review', allowCommands: false })
    f.script(async (client) => { client.delta('Fork answer'); return { stopReason: 'end_turn' } })
    await f.service.prompt('p', 'Fork question', TARGET)
    const client = f.clients[1]
    expect(client.sid).not.toBe(originalNative)
    expect(client.calls[0].method).toBe('session/new')
    const sent = JSON.stringify(client.calls.find((call) => call.method === 'session/prompt')?.params.prompt)
    expect(sent).toContain('Original question')
    expect(sent).toContain('Original answer')
    expect(sent).toContain('read')
    expect(sent).toContain('value = 1')
    expect((await f.service.switchSession('p', parent.session!.id)).messages).toEqual(parent.messages)
    await expect(f.service.forkSession('other', parent.session!.id)).rejects.toMatchObject({ code: 'session_not_found' })
  })
  it('rejects a CLI that returns the parent native session ID for a fork', async () => {
    const f = setup()
    await f.service.prompt('p', 'source', TARGET)
    const parent = (await f.service.snapshot('p')).session!.id
    const nativeId = f.clients[0].sid
    await f.service.forkSession('p', parent)
    f.createClient.mockImplementationOnce(async () => {
      const client = new FakeAcp(f.root)
      client.sid = nativeId
      f.clients.push(client)
      return client
    })
    await expect(f.service.prompt('p', 'fork', TARGET)).rejects.toMatchObject({ code: 'session_fork_unavailable' })
    expect(f.clients[1].calls.some((call) => call.method === 'session/prompt')).toBe(false)
  })

  it('replays fork history again in a fresh native session after the first prompt is cancelled', async () => {
    const f = setup()
    await f.service.prompt('p', 'old question', TARGET)
    const parent = (await f.service.snapshot('p')).session!.id
    await f.service.forkSession('p', parent)
    f.script(async () => ({ stopReason: 'cancelled' }))
    await f.service.prompt('p', 'failed attempt', TARGET)
    f.script(async (client) => { client.delta('finished'); return { stopReason: 'end_turn' } })
    await f.service.prompt('p', 'retry', TARGET)
    expect(f.clients[2].calls[0].method).toBe('session/new')
    expect(JSON.stringify(f.clients[2].calls.find((call) => call.method === 'session/prompt')?.params.prompt)).toContain('old question')
  })


  it('sends image blocks only when the ACP image capability is advertised', async () => {
    const f = setup()
    const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aX0AAAAASUVORK5CYII=' }
    await expect(f.service.prompt('p', 'inspect', TARGET, { images: [image] })).rejects.toMatchObject({ code: 'image_not_supported' })
    expect(f.clients[0].calls.some((call) => call.method === 'session/prompt')).toBe(false)
    f.createClient.mockImplementationOnce(async () => {
      const client = new FakeAcp(f.root)
      client.initializeResult.agentCapabilities.promptCapabilities.image = true
      f.clients.push(client)
      return client
    })
    await f.service.prompt('p', '', TARGET, { images: [image] })
    const prompt = f.clients[1].calls.find((call) => call.method === 'session/prompt')!.params.prompt as unknown[]
    expect(prompt).toContainEqual({ type: 'image', ...image })
    expect((await f.service.snapshot('p')).messages.at(-2)?.text).toContain('ảnh')
  })

  it('restores the native CLI session and ignores ACP session/load transcript replay', async () => {
    const f = setup(); await f.service.prompt('p', 'first', TARGET)
    const nativeId = f.clients[0].sid
    f.service.closeAll(); await tick()
    f.createClient.mockImplementationOnce(async () => { const client = new FakeAcp(f.root); client.replay = 'OLD REPLAY'; f.clients.push(client); return client })
    await f.service.prompt('p', 'second', TARGET)
    expect(f.clients[1].calls[0]).toMatchObject({ method: 'session/load', params: { sessionId: nativeId, cwd: f.clients[1].sessionCwd } })
    expect((await f.service.snapshot('p')).messages.map((message) => message.text)).toEqual(['first', 'Gemini trả lời', 'second', 'Gemini trả lời'])
    expect(JSON.stringify(f.events)).not.toContain('OLD REPLAY')
  })
  it('restores a transcript snapshot without emitting a session event that invalidates its own read', async () => {
    const f = setup(); await f.service.prompt('p', 'restore this conversation', TARGET)
    const sid = (await f.service.snapshot('p')).session!.id
    expect(f.events.some((event) => event.type === 'session')).toBe(true)
    f.service.closeAll(); f.events.length = 0
    const restored = await f.service.snapshot('p')
    expect(restored.session?.id).toBe(sid)
    expect(restored.messages.map((message) => message.text)).toEqual(['restore this conversation', 'Gemini trả lời'])
    expect(f.events.some((event) => event.type === 'session')).toBe(false)
  })
  it('lưu mức dùng ngữ cảnh do CLI báo (usage_update) để vòng context còn sau khi mở lại, và bỏ số không đáng tin', async () => {
    const f = setup()
    f.script(async (client) => {
      const update = (value: Record<string, unknown>, sessionId = client.sid) => client.handlers.onNotification?.('session/update', { sessionId, update: { sessionUpdate: 'usage_update', ...value } })
      update({ used: 0, size: 1_048_576 }) // chưa có gì trong ngữ cảnh
      update({ used: 5_000, size: 0 }) // cửa sổ không hợp lệ
      update({ used: 'nhiều', size: 1_048_576 }) // không phải số
      update({ used: 9_999, size: 1_048_576 }, 'phiên-khác') // của phiên khác
      update({ used: 12_345, size: 1_048_576 })
      client.delta('Gemini trả lời')
      return { stopReason: 'end_turn' }
    })
    await f.service.prompt('p', 'hello', TARGET)
    expect(f.events.filter((event) => event.type === 'context')).toEqual([{ type: 'context', context: { tokens: 12_345, window: 1_048_576 } }])
    f.service.closeAll(); f.events.length = 0
    expect((await f.service.snapshot('p')).context).toEqual({ tokens: 12_345, window: 1_048_576 })
  })
  it('không có usage_update thì snapshot không có context; số hỏng trên đĩa bị bỏ chứ không làm hỏng việc mở lại', async () => {
    const f = setup(); await f.service.prompt('p', 'hello', TARGET)
    const first = await f.service.snapshot('p')
    expect(first.context).toBeUndefined()
    const store = new GeminiSessions(join(f.root, 'data'))
    const scope = { projectId: 'p', root: realpathSync.native(f.root), connectionId: TARGET.connectionId }
    const file = join(store.directory(scope), `${first.session!.id}.json`)
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), context: { tokens: -5, window: 'lớn' } }))
    f.service.closeAll()
    const reopened = await f.service.snapshot('p')
    expect(reopened.messages.map((message) => message.text)).toEqual(['hello', 'Gemini trả lời'])
    expect(reopened.context).toBeUndefined()
  })
  it('denies all ACP native filesystem, terminal and permission fallbacks', async () => {
    const f = setup()
    f.script(async (client) => {
      expect(await client.handlers.onRequest?.('session/request_permission', { toolCall: { title: 'nexgraph_write' } })).toEqual({ outcome: { outcome: 'cancelled' } })
      await expect(client.handlers.onRequest?.('fs/write_text_file', { path: join(f.root, 'a.ts'), content: 'bad' })).rejects.toMatchObject({ code: 'protected_path' })
      await expect(client.handlers.onRequest?.('terminal/create', { command: 'cmd' })).rejects.toMatchObject({ code: 'protected_path' })
      return { stopReason: 'end_turn' }
    })
    await f.service.prompt('p', 'attempt', TARGET)
    expect(readFileSync(join(f.root, 'a.ts'), 'utf8')).toContain('value = 1')
  })
  it.each(['ask', 'plan'] as const)('%s mode rejects direct MCP writes and commands', async (mode) => {
    const f = setup(); await f.service.setMode('p', mode)
    f.script(async (client) => {
      expect((await client.tool('write', { path: 'a.ts', content: 'bad' })).error).toBeTruthy()
      expect((await client.tool('run_process', { executable: 'node', args: [] })).error).toBeTruthy()
      return { stopReason: 'end_turn' }
    })
    await f.service.prompt('p', 'do it', TARGET)
    expect(readFileSync(join(f.root, 'a.ts'), 'utf8')).toContain('value = 1')
  })
  it('runs real scoped read/write tools, creates checkpoint and rolls it back after a later task', async () => {
    const f = setup(); await f.service.setMode('p', 'edit'); f.service.setExecution('p', { policy: 'auto', allowCommands: false })
    f.script(async (client) => {
      expect((await client.tool('read', { path: '.env' })).result?.isError).toBe(true)
      const result = await client.tool('write', { path: 'a.ts', content: 'export const value = 2\n' })
      expect(result.result?.isError).not.toBe(true)
      client.delta('Đã sửa'); return { stopReason: 'end_turn' }
    })
    await f.service.prompt('p', 'edit', TARGET)
    const firstTask = (await f.service.snapshot('p')).task!
    expect(firstTask.checkpointIds).toHaveLength(1)
    expect(readFileSync(join(f.root, 'a.ts'), 'utf8')).toContain('value = 2')
    f.script(async () => ({ stopReason: 'end_turn' }))
    await f.service.prompt('p', 'next task', TARGET)
    expect(await f.service.checkpoints('p', firstTask.id)).toHaveLength(1)
    expect((await f.service.rollback('p', firstTask.id)).restored).toEqual(['a.ts'])
    expect(readFileSync(join(f.root, 'a.ts'), 'utf8')).toContain('value = 1')
    expect((await f.service.snapshot('p')).task?.id).not.toBe(firstTask.id)
  })
  it('review approval rejects disk changes and dirty drafts at publication time', async () => {
    const f = setup(); await f.service.setMode('p', 'edit')
    f.script(async (client) => {
      const attempt = client.tool('write', { path: 'a.ts', content: 'bad' })
      await vi.waitFor(() => expect(f.events.some((event) => event.type === 'approval')).toBe(true))
      const approval = f.events.findLast((event) => event.type === 'approval')!
      if (approval.type !== 'approval') throw new Error('missing approval')
      writeFileSync(join(f.root, 'a.ts'), 'external edit\n')
      f.service.approve('p', approval.request.id, true)
      expect((await attempt).result?.isError).toBe(true)
      f.setDirty(true)
      expect((await client.tool('write', { path: 'a.ts', content: 'also bad' })).result?.isError).toBe(true)
      return { stopReason: 'end_turn' }
    })
    await f.service.prompt('p', 'review', TARGET)
    expect(readFileSync(join(f.root, 'a.ts'), 'utf8')).toBe('external edit\n')
    expect(f.service.pending('p')).toBe(0)
  })
  it('rechecks connection and generation inside rollback before publishing a file', async () => {
    const f = setup(); await f.service.setMode('p', 'edit'); f.service.setExecution('p', { policy: 'auto', allowCommands: false })
    f.script(async (client) => { await client.tool('write', { path: 'a.ts', content: 'edited\n' }); return { stopReason: 'end_turn' } })
    await f.service.prompt('p', 'edit', TARGET)
    const taskId = (await f.service.snapshot('p')).task!.id
    f.deps.editorState = () => { f.setIdentity('revoked'); return [] }
    await expect(f.service.rollback('p', taskId)).rejects.toMatchObject({ code: 'ai_provider_changed' })
    expect(readFileSync(join(f.root, 'a.ts'), 'utf8')).toBe('edited\n')
  })
  it('stops a pending tool approval, closes transport and ignores late chunks', async () => {
    const f = setup(); await f.service.setMode('p', 'edit')
    f.script(async (client) => { await client.tool('write', { path: 'a.ts', content: 'bad' }); client.delta('late'); return { stopReason: 'end_turn' } })
    const run = f.service.prompt('p', 'edit', TARGET)
    await vi.waitFor(() => expect(f.events.some((event) => event.type === 'approval')).toBe(true))
    await f.service.abort('p'); await run
    f.clients[0].delta('later')
    expect(f.clients[0].closed()).toBe(true)
    expect((await f.service.snapshot('p')).task?.status).toBe('cancelled')
    expect(JSON.stringify(f.events.filter((event) => event.type === 'text'))).not.toContain('late')
  })
  it('closes a CLI created after cancellation instead of leaking an orphan process', async () => {
    const f = setup(); let resolve!: (client: FakeAcp) => void
    f.createClient.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const run = f.service.prompt('p', 'wait', TARGET)
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await f.service.abort('p')
    const client = new FakeAcp(f.root); resolve(client); await run
    expect(client.closed()).toBe(true); expect(client.calls).toHaveLength(0)
  })

  it('allows a queued prompt only after abort and the old prompt have settled', async () => {
    const f = setup()
    await f.service.prompt('p', 'first', TARGET)
    let release!: (value: unknown) => void
    const gate = new Promise<unknown>((resolve) => { release = resolve })
    f.script(() => gate)
    const oldPrompt = f.service.prompt('p', 'old', TARGET)
    await vi.waitFor(() => expect(f.clients[1].calls.some((call) => call.method === 'session/prompt')).toBe(true))
    await f.service.abort('p')
    await expect(f.service.prompt('p', 'too early', TARGET)).rejects.toMatchObject({ code: 'agent_busy' })
    release({ stopReason: 'end_turn' })
    await oldPrompt
    f.script(async () => ({ stopReason: 'end_turn' }))
    await expect(f.service.prompt('p', 'queued', TARGET)).resolves.toBeUndefined()
    expect((await f.service.snapshot('p')).messages.at(-2)?.text).toBe('queued')
  })
  it('does not fall back to an API connection after disconnect and scopes history per identity', async () => {
    const f = setup(); await f.service.prompt('p', 'first identity', TARGET)
    f.setConnected(false); f.service.selectionChanged()
    expect((await f.service.snapshot('p')).session).toBeNull()
    await expect(f.service.prompt('p', 'again', TARGET)).rejects.toMatchObject({ code: 'ai_provider_changed' })
    f.setConnected(true); f.setIdentity('connection-b')
    expect((await f.service.snapshot('p')).messages).toEqual([])
    expect(await f.service.listSessions('p')).toHaveLength(1)
  })
  it('passes task settings and exact tool scope without reporting known model turns', async () => {
    const f = setup(); f.service.setLimits('p', { maxTurns: 4, maxDurationMs: 10000, maxTokens: 1000 })
    await f.service.prompt('p', 'first', TARGET)
    expect(f.createClient.mock.calls[0][2]).toMatchObject({ maxTurns: 4, mcpTools: expect.arrayContaining(['read', 'search']) })
    f.service.setLimits('p', { maxTurns: 5, maxDurationMs: 10000, maxTokens: 1000 })
    await f.service.prompt('p', 'second', TARGET)
    expect(f.clients[0].closed()).toBe(true)
    expect(f.createClient.mock.calls[1][2]).toMatchObject({ maxTurns: 5 })
    expect((await f.service.snapshot('p')).task?.turnsKnown).toBe(false)
  })
  it('checks a synthetic private fixture even before activation without reading project source', async () => {
    const f = setup(); f.setConnected(false)
    f.script(async (client) => {
      const text = (client.calls.at(-1)!.params.prompt as { text: string }[])[0].text
      const nonce = /nonce ([0-9a-f-]+)/.exec(text)![1]
      expect((await client.tool('nexgraph_probe', { nonce })).result?.isError).not.toBe(true)
      client.delta('NEXGRAPH_GEMINI_OK'); return { stopReason: 'end_turn' }
    })
    expect(await f.service.testConnection()).toEqual({ ok: true, message: expect.any(String), capabilities: { streaming: true, tools: true } })
    expect(f.createClient.mock.calls[0][0]).not.toBe(f.root)
    expect(f.api.aiSourceExcludes).not.toHaveBeenCalled(); expect(f.api.code).not.toHaveBeenCalled()
    expect(f.clients[0].closed()).toBe(true)
  })
  it('redacts API keys from both durable transcript and generated session title', async () => {
    const f = setup(); await f.service.prompt('p', 'sk-abcdef0123456789 test', TARGET)
    expect(JSON.stringify(await f.service.snapshot('p'))).not.toContain('sk-abcdef0123456789')
    expect(JSON.stringify(await f.service.listSessions('p'))).not.toContain('sk-abcdef0123456789')
  })
  it.each(['max_tokens', 'max_turn_requests', 'refusal', undefined])('never reports successful completion for stop reason %s', async (stopReason) => {
    const f = setup(); f.script(async (client) => { client.delta('partial'); return { stopReason } })
    await f.service.prompt('p', 'test', TARGET)
    expect(f.events.some((event) => event.type === 'done')).toBe(false)
    expect((await f.service.snapshot('p')).task?.status).toBe('failed')
    expect((await f.service.snapshot('p')).messages.at(-1)?.text).toBe('partial')
  })
})

describe('authenticated Gemini MCP broker', () => {
  it('forwards only provenance-verified own MCP calls, never native or lookalike permissions', () => {
    const request = { sessionId: 'native-session', toolCall: { title: 'write', name: 'mcp_nexgraph_write' }, options: [{ kind: 'allow_once', optionId: 'allow' }] }
    expect(brokerPermission(request, 'native-session', ['write'])).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
    expect(brokerPermission(request, 'other-session', ['write']).outcome.outcome).toBe('cancelled')
    expect(brokerPermission(request, 'native-session', ['read']).outcome.outcome).toBe('cancelled')
    expect(brokerPermission({ ...request, toolCall: { title: 'nexgraph write' } }, 'native-session', ['write']).outcome.outcome).toBe('cancelled')
    expect(brokerPermission({ ...request, toolCall: { name: 'mcp_evil_write' } }, 'native-session', ['write']).outcome.outcome).toBe('cancelled')
  })
  it('requires scoped bearer, rejects browser origins and validates allowed tools', async () => {
    let active = false
    const broker = new GeminiMcpBroker({ assertCurrent: () => { if (!active) throw new Error('No task') }, tools: () => [{ name: 'probe', description: 'test', inputSchema: Type.Object({}), execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }] })
    const config = await broker.start()
    const headers = { 'content-type': 'application/json', Authorization: config.headers[0].value }
    const call = (method: string, params = {}, overrides = {}) => fetch(config.url, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    try {
      expect((await call('tools/list', {}, { Authorization: 'Bearer wrong' })).status).toBe(403)
      expect((await call('tools/list', {}, { Origin: 'https://evil.example' })).status).toBe(403)
      expect((await (await call('tools/call', { name: 'probe' })).json()).error).toBeTruthy()
      active = true
      expect((await (await call('tools/call', { name: 'probe' })).json()).result.content[0].text).toBe('ok')
      expect((await (await call('tools/call', { name: 'run_shell_command' })).json()).error).toBeTruthy()
    } finally { await broker.close() }
  })
})

describe('Gemini local session mapping', () => {
  it('rejects the 2001st session before changing the index or creating an orphan record', () => {
    const root = temp(); const store = new GeminiSessions(join(root, 'data')); const scope = { projectId: 'p', root, connectionId: 'a' }
    const directory = store.directory(scope); mkdirSync(directory, { recursive: true })
    const sessions = Array.from({ length: 2000 }, () => ({ id: randomUUID(), title: 'saved', createdAt: 1, updatedAt: 1, provider: 'google-antigravity', baseUrl: '', model: 'auto', messageCount: 0 }))
    const before = JSON.stringify({ version: 1, scope: store.key(scope), activeId: sessions[0].id, sessions })
    writeFileSync(join(directory, 'index.json'), before)
    expect(() => store.open(scope, 'auto', undefined, true)).toThrow(/giới hạn/)
    expect(readFileSync(join(directory, 'index.json'), 'utf8')).toBe(before)
    expect(readdirSync(directory)).toEqual(['index.json'])
    expect(store.list(scope)).toHaveLength(2000)
  })
  it('preserves active selection on rename and rejects foreign project/account/task mappings', () => {
    const root = temp(); const store = new GeminiSessions(join(root, 'data')); const scope = { projectId: 'p', root, connectionId: 'a' }
    const first = store.open(scope, 'auto'); const second = store.open(scope, 'auto', undefined, true)
    store.rename(scope, first.info.id, 'renamed')
    expect(store.open(scope, 'auto').info.id).toBe(second.info.id)
    expect(store.list({ ...scope, projectId: 'other' })).toEqual([])
    expect(store.list({ ...scope, connectionId: 'b' })).toEqual([])
    expect(() => store.open({ ...scope, connectionId: 'b' }, 'auto', first.info.id)).toThrow(/không thuộc/)
    expect(() => store.task(scope, randomUUID())).toThrow(/không thuộc/)
    expect(() => store.open(scope, 'auto', '../../escape')).toThrow()
  })
})
