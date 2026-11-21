import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentService, rememberSecret, scrub, type AgentAccounts, type PiSession, type SessionSpec } from '../src/main/agent/session'
import { ASK_TOOLS, EDIT_TOOLS } from '../src/main/agent/extension'
import { TOOL_DEFS } from '../src/main/ai/tools'
import type { EngineApi } from '../src/main/engine/api'
import type { AgentEvent } from '../src/shared/agent-types'

const GRAPH = TOOL_DEFS.map((t) => t.function.name)
const TARGET = { provider: 'nexgraph-custom', baseUrl: 'https://test.example/v1' }
type ToolCallHandler = (e: { type: 'tool_call'; toolName: string; toolCallId: string; input: Record<string, unknown> }) => Promise<{ block: true; reason: string } | undefined>
type Listener = (e: unknown) => void
const tick = () => new Promise((r) => setTimeout(r, 0))

/** Phiên pi giả: chạy extension thật trên một `pi` giả, prompt() chạy kịch bản của test. */
class FakeSession {
  handler!: ToolCallHandler
  startTurn?: () => void
  listeners: Listener[] = []
  active: string[]
  messages: { role: string; stopReason?: string; errorMessage?: string }[] = []
  model: { provider: string; id: string } | undefined
  aborted = false
  output = ''
  disposed = false
  script: (s: FakeSession, text: string) => Promise<void> = async (s) => s.finish()
  promptOptions?: Parameters<PiSession['prompt']>[1]
  decisions: ({ block: true; reason: string } | undefined)[] = []
  /** Số context mà `getContextUsage()` của Pi trả về (đặt trong kịch bản của từng test). */
  contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined
  contextFails = false
  constructor(public spec: SessionSpec) {
    this.active = [...spec.tools]
    this.messages = [...(spec.sessionManager?.buildSessionContext().messages ?? [])] as typeof this.messages
    spec.extension({
      registerTool: () => {},
      on: (event: string, handler: ToolCallHandler | (() => void)) => {
        if (event === 'tool_call') this.handler = handler as ToolCallHandler
        if (event === 'agent_start') this.startTurn = handler as () => void
      },
    } as never)
  }
  subscribe(l: Listener) { this.listeners.push(l); return () => { this.listeners = this.listeners.filter((x) => x !== l) } }
  emit(e: unknown) { for (const l of this.listeners) l(e) }
  delta(t: string) { this.output += t; this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: t } }) }
  async call(toolName: string, input: Record<string, unknown>) {
    this.emit({ type: 'tool_execution_start', toolName })
    const d = await this.handler({ type: 'tool_call', toolName, toolCallId: 'c1', input })
    this.decisions.push(d)
    this.emit({ type: 'tool_execution_end', toolName, isError: !!d })
    return d
  }
  finish(stopReason = 'stop', errorMessage?: string) {
    this.messages.push({ role: 'assistant', stopReason: this.aborted ? 'aborted' : stopReason, errorMessage })
    this.spec.sessionManager?.appendMessage({
      role: 'assistant', content: [{ type: 'text', text: this.output }], api: 'openai-completions', provider: TARGET.provider,
      model: 'm1', stopReason: this.aborted ? 'aborted' : stopReason, errorMessage, timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    } as never)
  }
  async prompt(text: string, options?: Parameters<PiSession['prompt']>[1]): Promise<void> {
    this.promptOptions = options
    this.output = ''
    this.aborted = false
    this.startTurn?.()
    this.messages.push({ role: 'user' })
    this.spec.sessionManager?.appendMessage({ role: 'user', content: text, timestamp: Date.now() })
    this.spec.beforeModelTurn?.()
    await this.script(this, text)
  }
  async abort() { this.aborted = true }
  dispose() { this.disposed = true; this.aborted = true }
  setActiveToolsByName(names: string[]) { this.active = names }
  getActiveToolNames() { return this.active }
  getContextUsage() { if (this.contextFails) throw new Error('Pi không tính được context'); return this.contextUsage }
  async setModel(m: { provider: string; id: string }) { this.model = m }
}

function setup(over: { consent?: boolean; selected?: null; accounts?: () => Promise<AgentAccounts>; rootOf?: (pid: string) => Promise<string> } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'ng-sess-'))
  const roots: Record<string, string> = { p1: join(base, 'p1'), p2: join(base, 'p2') }
  for (const r of Object.values(roots)) { mkdirSync(r); writeFileSync(join(r, 'a.py'), 'x\n') }
  const events: { pid: string; e: AgentEvent }[] = []
  const sessions: FakeSession[] = []
  const code = vi.fn(async (_pid: string, file: string, start: number, end: number) => {
    if (file !== 'a.py') throw Object.assign(new Error('no'), { code: 'file_not_found' })
    return { file, start, end, text: 'x' }
  })
  const fakeModel = { ...TARGET, id: 'm1' }
  const svc = new AgentService({
    api: { code } as unknown as EngineApi,
    dataDir: join(base, 'data'),
    accounts: over.accounts ?? (async () => ({
      modelRuntime: { getModel: () => fakeModel } as never,
      getSelectedModel: () => over.selected === null ? null : fakeModel,
      hasConsent: async () => over.consent ?? true,
    })),
    rootOf: over.rootOf ?? (async (pid) => { if (!roots[pid]) throw new Error('unknown'); return roots[pid] }),
    emit: (pid, e) => events.push({ pid, e }),
    createSession: async (spec) => { const s = new FakeSession(spec); sessions.push(s); return s as unknown as PiSession }
  })
  const of = (pid: string, type: AgentEvent['type']) => events.filter((x) => x.pid === pid && x.e.type === type).map((x) => x.e)
  return { svc, events, sessions, roots, base, of }
}

/** Promise có resolve gọi được từ ngoài (không dùng timer). */
const deferred = <T,>() => {
  let resolve: (v: T) => void = () => {}
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
/** Kịch bản: gọi write trong dự án rồi kết thúc. */
const writeScript = (input: Record<string, unknown> = { path: 'b.txt', content: 'mới' }) => async (s: FakeSession) => {
  await s.call('write', input)
  s.finish()
}

describe('AgentService (phiên giả)', () => {
  it('chế độ mặc định là ask; phiên tạo ở gốc dự án (realpath), agentDir riêng, tool đọc + 9 tool đồ thị', async () => {
    const { svc, sessions, roots, base } = setup()
    expect(svc.getMode('p1')).toBe('ask')
    await svc.prompt('p1', 'chào', TARGET)
    const spec = sessions[0].spec
    expect(spec.cwd).toBe(realpathSync.native(roots.p1))
    expect(spec.agentDir.startsWith(join(base, 'data'))).toBe(true)
    expect(sessions[0].active.sort()).toEqual([...ASK_TOOLS, ...GRAPH].sort())
    expect(ASK_TOOLS).toEqual(['read', 'grep', 'find', 'ls'])
    expect(EDIT_TOOLS).toEqual(['read', 'grep', 'find', 'ls', 'edit', 'write', 'run_process'])
    expect(sessions[0].model).toEqual({ ...TARGET, id: 'm1' })
  })

  it('text_delta → sự kiện text; kết thúc → done có citations đã kiểm chứng (trích dẫn sai bị đánh dấu)', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'hỏi', TARGET) // phiên được tạo ở lượt đầu; kịch bản đặt cho lượt sau
    sessions[0].script = async (s) => { s.delta('Xem [[a.py:1-1]] '); s.delta('và [[sai.py:1-2]]'); s.finish() }
    await svc.prompt('p1', 'hỏi tiếp', TARGET)
    expect(of('p1', 'text')).toEqual([{ type: 'text', delta: 'Xem [[a.py:1-1]] ' }, { type: 'text', delta: 'và [[sai.py:1-2]]' }])
    const done = of('p1', 'done').at(-1) as Extract<AgentEvent, { type: 'done' }>
    expect(done.text).toBe('Xem [[a.py:1-1]] và [[sai.py:1-2]]')
    expect(done.citations.map((c) => [c.file, c.valid])).toEqual([['a.py', true], ['sai.py', false]])
  })

  it('tool_execution_start/end → sự kiện tool', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'a', TARGET)
    sessions[0].script = async (s) => { await s.call('search', { query: 'x' }); s.finish() }
    await svc.prompt('p1', 'b', TARGET)
    expect(of('p1', 'tool')).toEqual([{ type: 'tool', name: 'search', status: 'start' }, { type: 'tool', name: 'search', status: 'end', error: false }])
  })

  it('setMode("edit") cấu hình lại phiên tại chỗ với tool sửa, giữ nguyên phiên', async () => {
    const { svc, sessions } = setup()
    await svc.prompt('p1', 'a', TARGET)
    svc.setMode('p1', 'edit')
    expect(svc.getMode('p1')).toBe('edit')
    await tick()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].active.sort()).toEqual([...EDIT_TOOLS, ...GRAPH].sort())
    svc.setMode('p1', 'ask')
    await tick()
    expect(sessions[0].active.sort()).toEqual([...ASK_TOOLS, ...GRAPH].sort())
  })

  it('chế độ đặt trước khi có phiên được áp dụng khi tạo phiên', async () => {
    const { svc, sessions } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a', TARGET)
    expect(sessions[0].active.sort()).toEqual([...EDIT_TOOLS, ...GRAPH].sort())
  })

  it('lượt Sửa: write → approval; approve(true) cho qua, approve(false) chặn kèm lý do cho mô hình', async () => {
    const { svc, sessions, of } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a', TARGET)
    const s = sessions[0]
    s.script = writeScript()
    let run = svc.prompt('p1', 'viết b.txt', TARGET)
    await vi.waitFor(() => expect(of('p1', 'approval')).toHaveLength(1))
    const req = (of('p1', 'approval')[0] as Extract<AgentEvent, { type: 'approval' }>).request
    expect(req).toMatchObject({ tool: 'write', path: 'b.txt', before: '', after: 'mới' })
    expect(svc.pending('p1')).toBe(1)
    svc.approve('p1', req.id, true)
    await run
    expect(s.decisions.at(-1)).toBeUndefined()
    expect(of('p1', 'approval_closed')).toEqual([{ type: 'approval_closed', id: req.id }])

    run = svc.prompt('p1', 'viết lại', TARGET)
    await vi.waitFor(() => expect(of('p1', 'approval')).toHaveLength(2))
    const req2 = (of('p1', 'approval')[1] as Extract<AgentEvent, { type: 'approval' }>).request
    svc.approve('p1', req2.id, false)
    await run
    expect(s.decisions.at(-1)).toEqual({ block: true, reason: 'Người dùng từ chối thao tác này' })
    expect(svc.pending('p1')).toBe(0)
  })

  it('abort khi đang chờ duyệt → approval_closed, yêu cầu bị từ chối, prompt() kết thúc, không còn yêu cầu treo', async () => {
    const { svc, sessions, of } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a', TARGET)
    sessions[0].script = writeScript()
    const run = svc.prompt('p1', 'viết', TARGET)
    await vi.waitFor(() => expect(svc.pending('p1')).toBe(1))
    await svc.abort('p1')
    await run
    expect(sessions[0].decisions.at(-1)).toMatchObject({ block: true })
    expect(of('p1', 'approval_closed')).toHaveLength(1)
    expect(svc.pending('p1')).toBe(0)
    expect(of('p1', 'error').at(-1)).toEqual({ type: 'error', code: 'ai_cancelled', message: 'Đã dừng' })
  })

  it('setMode("ask") khi đang chờ duyệt → từ chối', async () => {
    const { svc, sessions } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a', TARGET)
    sessions[0].script = writeScript()
    const run = svc.prompt('p1', 'viết', TARGET)
    await vi.waitFor(() => expect(svc.pending('p1')).toBe(1))
    svc.setMode('p1', 'ask')
    await run
    expect(sessions[0].decisions.at(-1)).toMatchObject({ block: true })
    expect(svc.pending('p1')).toBe(0)
  })

  it('setMode("edit") khi đang chờ duyệt cũng từ chối yêu cầu cũ', async () => {
    const { svc, sessions } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a', TARGET)
    sessions[0].script = writeScript()
    const run = svc.prompt('p1', 'viết', TARGET)
    await vi.waitFor(() => expect(svc.pending('p1')).toBe(1))
    svc.setMode('p1', 'edit')
    await run
    expect(svc.pending('p1')).toBe(0)
  })

  it.each([
    ['401 Unauthorized', 'ai_unauthorized', 'API key bị từ chối'],
    ['429 Too Many Requests', 'ai_rate_limited', 'Đã chạm hạn mức hoặc giới hạn tốc độ của nhà cung cấp. Kiểm tra hạn mức rồi thử lại.'],
    ['fetch failed: ECONNREFUSED', 'ai_unreachable', 'Không kết nối được tới nhà cung cấp AI']
  ])('nhà cung cấp lỗi "%s" → sự kiện error tiếng Việt, prompt() không ném, lượt sau vẫn chạy', async (raw, code, message) => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'a', TARGET)
    sessions[0].script = async (s) => { s.finish('error', raw) }
    await expect(svc.prompt('p1', 'b', TARGET)).resolves.toBeUndefined()
    expect(of('p1', 'error').at(-1)).toEqual({ type: 'error', code, message })
    sessions[0].script = async (s) => { s.delta('ok'); s.finish() }
    await svc.prompt('p1', 'c', TARGET)
    expect(of('p1', 'done').at(-1)).toMatchObject({ type: 'done', text: 'ok' })
  })

  it('session.prompt ném lỗi → sự kiện error, prompt() vẫn resolve', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'a', TARGET)
    sessions[0].script = async () => { throw new Error('fetch failed') }
    await expect(svc.prompt('p1', 'b', TARGET)).resolves.toBeUndefined()
    expect(of('p1', 'error').at(-1)).toMatchObject({ code: 'ai_unreachable' })
  })

  it('chưa đồng ý gửi mã → consent_required; chưa cấu hình → ai_not_configured; không tạo phiên', async () => {
    const a = setup({ consent: false })
    await expect(a.svc.prompt('p1', 'x', TARGET)).rejects.toMatchObject({ code: 'consent_required' })
    const b = setup({ selected: null })
    await expect(b.svc.prompt('p1', 'x', TARGET)).rejects.toMatchObject({ code: 'ai_not_configured' })
    expect(a.sessions.length + b.sessions.length).toBe(0)
  })

  it('đang trả lời thì lượt mới bị từ chối với agent_busy', async () => {
    const { svc, sessions } = setup()
    await svc.prompt('p1', 'a', TARGET)
    let release = () => {}
    sessions[0].script = (s) => new Promise<void>((r) => { release = () => { s.finish(); r() } })
    const run = svc.prompt('p1', 'b', TARGET)
    await tick()
    await expect(svc.prompt('p1', 'c', TARGET)).rejects.toMatchObject({ code: 'agent_busy' })
    release()
    await run
  })

  it('hai dự án có phiên riêng; close(pid) dispose phiên và từ chối yêu cầu treo', async () => {
    const { svc, sessions, of } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a', TARGET)
    await svc.prompt('p2', 'a', TARGET)
    expect(sessions).toHaveLength(2)
    expect(svc.getMode('p2')).toBe('ask')
    sessions[0].script = writeScript()
    const run = svc.prompt('p1', 'viết', TARGET)
    await vi.waitFor(() => expect(svc.pending('p1')).toBe(1))
    svc.close('p1')
    await run
    expect(sessions[0].disposed).toBe(true)
    expect(sessions[1].disposed).toBe(false)
    expect(sessions[0].decisions.at(-1)).toMatchObject({ block: true })
    expect(of('p1', 'approval_closed')).toHaveLength(1)
    expect(svc.pending('p1')).toBe(0)
    await svc.prompt('p1', 'mở lại', TARGET)
    expect(sessions).toHaveLength(3)
    svc.closeAll()
    await tick()
    expect(sessions[1].disposed && sessions[2].disposed).toBe(true)
  })

  it('approve với id lạ hoặc dự án chưa có phiên không ném', () => {
    const { svc } = setup()
    expect(() => svc.approve('p9', 'x', true)).not.toThrow()
    expect(svc.pending('p9')).toBe(0)
  })

  it('sau khi abort bắt đầu, tool_call write đến muộn bị từ chối ngay, không có sự kiện approval', async () => {
    const { svc, sessions, of } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a', TARGET)
    let release = () => {}
    const gateOpen = new Promise<void>((r) => { release = r })
    sessions[0].script = async (s) => { await gateOpen; await s.call('write', { path: 'b.txt', content: 'x' }); s.finish() }
    const run = svc.prompt('p1', 'viết', TARGET)
    await tick()
    await svc.abort('p1')
    release()
    await run
    expect(sessions[0].decisions.at(-1)).toMatchObject({ block: true })
    expect(of('p1', 'approval')).toHaveLength(0)
    expect(svc.pending('p1')).toBe(0)
    // lượt mới bỏ cờ dừng: lại hỏi duyệt bình thường
    sessions[0].script = writeScript()
    const next = svc.prompt('p1', 'viết lại', TARGET)
    await vi.waitFor(() => expect(of('p1', 'approval')).toHaveLength(1))
    svc.close('p1')
    await next
  })

  it('allows a queued prompt after abort and the old prompt have both settled', async () => {
    const { svc, sessions } = setup()
    await svc.prompt('p1', 'first', TARGET)
    const gate = deferred<void>()
    sessions[0].script = async (session) => { await gate.promise; session.finish() }
    const oldPrompt = svc.prompt('p1', 'old', TARGET)
    await tick()
    await svc.abort('p1')
    await expect(svc.prompt('p1', 'too early', TARGET)).rejects.toMatchObject({ code: 'agent_busy' })
    gate.resolve()
    await oldPrompt
    sessions[0].script = async (session) => { session.finish() }
    await expect(svc.prompt('p1', 'queued', TARGET)).resolves.toBeUndefined()
    expect((await svc.snapshot('p1')).messages.at(-1)?.text).toBe('queued')
  })

  it('sau close() không phát sự kiện approval cho tool_call đến muộn', async () => {
    const { svc, sessions, of } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a', TARGET)
    const s = sessions[0]
    svc.close('p1')
    expect(await s.handler({ type: 'tool_call', toolName: 'write', toolCallId: 'c', input: { path: 'b.txt', content: 'x' } })).toMatchObject({ block: true })
    expect(of('p1', 'approval')).toHaveLength(0)
  })

  it('abort khi tạo phiên thất bại không ném', async () => {
    const { svc } = setup()
    ;(svc as unknown as { deps: { createSession: () => Promise<never> } }).deps.createSession = async () => { throw new Error('nạp pi lỗi') }
    await svc.prompt('p1', 'a', TARGET)
    await expect(svc.abort('p1')).resolves.toBeUndefined()
  })

  it('ai_error không chứa nguyên văn lỗi nhà cung cấp có dạng khoá, chi tiết bị cắt ngắn', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'a', TARGET)
    sessions[0].script = async (s) => { s.finish('error', `weird failure sk-abcdef1234567890 Bearer xyz.secret ${'z'.repeat(500)}`) }
    await svc.prompt('p1', 'b', TARGET)
    const e = of('p1', 'error').at(-1) as Extract<AgentEvent, { type: 'error' }>
    expect(e.code).toBe('ai_error')
    expect(e.message).toMatch(/^Trợ lý AI gặp lỗi/)
    expect(e.message).not.toContain('sk-abcdef1234567890')
    expect(e.message).not.toContain('xyz.secret')
    expect(e.message.length).toBeLessThanOrEqual(260)
  })
})

describe('AgentService durable conversations and task limits', () => {
  it('restores the selected Pi transcript after close/reopen, with original user text and verified citations', async () => {
    const { svc, sessions } = setup()
    await svc.prompt('p1', 'bắt đầu', TARGET)
    sessions[0].script = async (session) => { session.delta('Xem [[a.py:1-1]]'); session.finish() }
    await svc.prompt('p1', 'tìm hàm', TARGET)
    const before = await svc.snapshot('p1')
    const id = before.session!.id
    svc.close('p1')
    await tick()
    const reopened = new AgentService((svc as unknown as { deps: ConstructorParameters<typeof AgentService>[0] }).deps)
    const restored = await reopened.snapshot('p1')
    expect(restored.session?.id).toBe(id)
    expect(restored.messages.filter((message) => message.role === 'user').map((message) => message.text)).toEqual(['bắt đầu', 'tìm hàm'])
    expect(restored.messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Xem [[a.py:1-1]]', citations: [{ file: 'a.py', valid: true }] })
    expect(restored.task).toMatchObject({ status: 'completed', sessionId: id, turns: 1 })
    expect(restored.usage.costUsd).toBeNull()
    reopened.closeAll()
  })

  it('forks Pi history without its task or execution grants and keeps the source unchanged', async () => {
    const { svc, sessions } = setup()
    await svc.prompt('p1', 'question originale', TARGET)
    const source = await svc.snapshot('p1')
    await svc.renameSession('p1', source.session!.id, 'Conversation nommée')
    svc.setExecution('p1', { policy: 'auto', allowCommands: true })
    const fork = await svc.forkSession('p1', source.session!.id)
    expect(fork.session?.id).not.toBe(source.session!.id)
    expect(fork.session?.title).toBe('Conversation nommée')
    expect(fork.messages.map((message) => message.text)).toEqual(source.messages.map((message) => message.text))
    expect(fork.task).toBeNull()
    expect(fork.execution).toEqual({ policy: 'review', allowCommands: false })
    await svc.prompt('p1', 'dans la branche', TARGET)
    expect(sessions.at(-1)!.spec.sessionManager!.buildSessionContext().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'question originale' })
    ]))
    expect((await svc.switchSession('p1', source.session!.id)).messages.map((message) => message.text)).toEqual(source.messages.map((message) => message.text))
  })

  it('passes image attachments to capable Pi models and rejects unknown or unsupported capability', async () => {
    const model = { ...TARGET, id: 'm1', input: ['text', 'image'] }
    const { svc, sessions } = setup({ accounts: async () => ({
      modelRuntime: { getModel: () => model } as never, getSelectedModel: () => model, hasConsent: async () => true
    }) })
    const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aX0AAAAASUVORK5CYII=' }
    await svc.prompt('p1', '', TARGET, { images: [image] })
    expect(sessions[0].promptOptions?.images).toEqual([{ type: 'image', ...image }])
    model.input = ['text']
    await expect(svc.prompt('p1', 'x', TARGET, { images: [image] })).rejects.toMatchObject({ code: 'image_not_supported' })
    model.input = []
    await expect(svc.prompt('p1', 'x', TARGET, { images: [image] })).rejects.toMatchObject({ code: 'image_not_supported' })
    const unconfigured = setup({ selected: null })
    await expect(unconfigured.svc.prompt('p1', 'x', TARGET, { images: [image] })).rejects.toMatchObject({ code: 'image_not_supported' })
  })

  it('new, rename, switch and delete operate on the canonical session without mixing projects or accounts', async () => {
    let account = 'account-a'
    const model = { ...TARGET, id: 'm1' }
    const { svc } = setup({ accounts: async () => ({
      modelRuntime: { getModel: () => model } as never, getSelectedModel: () => model,
      hasConsent: async () => true, sessionIdentity: () => account
    }) })
    await svc.prompt('p1', 'private-first', TARGET)
    const first = (await svc.snapshot('p1')).session!.id
    const next = await svc.newSession('p1')
    expect(next.session?.id).not.toBe(first)
    expect(next.messages).toEqual([])
    await svc.renameSession('p1', first, 'Phân tích đăng nhập')
    expect((await svc.listSessions('p1')).find((item) => item.id === first)?.title).toBe('Phân tích đăng nhập')
    await svc.switchSession('p1', first)
    expect((await svc.snapshot('p1')).messages[0].text).toBe('private-first')
    await expect(svc.switchSession('p2', first)).rejects.toMatchObject({ code: 'session_not_found' })
    account = 'account-b'
    svc.selectionChanged()
    expect(await svc.listSessions('p1')).toEqual([])
    await expect(svc.switchSession('p1', first)).rejects.toMatchObject({ code: 'session_not_found' })
    account = 'account-a'
    await svc.deleteSession('p1', first)
    expect((await svc.listSessions('p1')).some((item) => item.id === first)).toBe(false)
    await expect(svc.switchSession('p1', first)).rejects.toMatchObject({ code: 'session_not_found' })
    svc.closeAll()
  })

  it('plan is read-only, and command/automatic execution grants reset when the project closes', async () => {
    const { svc, sessions } = setup()
    svc.setMode('p1', 'plan')
    svc.setExecution('p1', { policy: 'auto', allowCommands: true })
    await svc.prompt('p1', 'lập kế hoạch', TARGET)
    expect(sessions[0].getActiveToolNames()).not.toContain('edit')
    expect(sessions[0].getActiveToolNames()).not.toContain('run_process')
    sessions[0].script = writeScript()
    await svc.prompt('p1', 'đề xuất thay đổi', TARGET)
    expect(sessions[0].decisions.at(-1)).toMatchObject({ block: true })
    svc.close('p1')
    expect(svc.getExecution('p1')).toEqual({ policy: 'review', allowCommands: false })
  })

  it('isolates history when resolved provider credentials change despite the same synchronous identity', async () => {
    let accountId = 'runtime-credential-a'
    const model = { ...TARGET, id: 'm1' }
    const { svc } = setup({ accounts: async () => ({
      modelRuntime: { getModel: () => model } as never, getSelectedModel: () => model,
      getConsentTarget: async () => ({ ...TARGET, accountId }),
      hasConsent: async () => true, sessionIdentity: () => 'stable-installed-account'
    }) })
    await svc.prompt('p1', 'private-runtime-history', { ...TARGET, accountId })
    const first = (await svc.snapshot('p1')).session!.id
    accountId = 'runtime-credential-b'
    const rotated = await svc.snapshot('p1')
    expect(rotated.session?.id).not.toBe(first)
    expect(rotated.messages).toEqual([])
    await expect(svc.switchSession('p1', first)).rejects.toMatchObject({ code: 'session_not_found' })
    svc.closeAll()
  })

  it('bounded model turns end the task and a new prompt starts with a fresh budget', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'initialize', TARGET)
    svc.setLimits('p1', { maxTurns: 1, maxDurationMs: 10_000, maxTokens: 1000 })
    sessions[0].script = async (session) => { session.spec.beforeModelTurn!(); session.finish() }
    await svc.prompt('p1', 'loop', TARGET)
    expect(of('p1', 'error').at(-1)).toMatchObject({ code: 'agent_limit' })
    expect((await svc.snapshot('p1')).task).toMatchObject({ status: 'failed', turns: 1 })
    sessions[0].script = async (session) => { session.delta('finished'); session.finish() }
    await svc.prompt('p1', 'retry', TARGET)
    expect(of('p1', 'done').at(-1)).toMatchObject({ text: 'finished' })
    expect((await svc.snapshot('p1')).task?.status).toBe('completed')
    svc.closeAll()
  })

  it('duration cancellation ends waiting work and token usage stops an over-budget task', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'initialize', TARGET)
    svc.setLimits('p1', { maxTurns: 3, maxDurationMs: 30, maxTokens: 1000 })
    sessions[0].script = (session) => new Promise<void>((resolve) => {
      session.abort = async () => { session.aborted = true; session.finish(); resolve() }
    })
    await svc.prompt('p1', 'wait', TARGET)
    expect(of('p1', 'error').at(-1)).toMatchObject({ code: 'agent_limit', message: expect.stringContaining('thời gian') })
    svc.setLimits('p1', { maxTurns: 3, maxDurationMs: 10_000, maxTokens: 10 })
    sessions[0].script = async (session) => {
      session.emit({ type: 'message_end', message: { role: 'assistant', usage: { input: 8, output: 3, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } } } })
      session.finish()
    }
    await svc.prompt('p1', 'tokens', TARGET)
    expect(of('p1', 'error').at(-1)).toMatchObject({ code: 'agent_limit', message: expect.stringContaining('token') })
    expect((await svc.snapshot('p1')).usage).toMatchObject({ inputTokens: 8, outputTokens: 3, costUsd: null })
    svc.closeAll()
  })

  it('tool arguments/results and retry telemetry are bounded and redact the active secret', async () => {
    const { svc, sessions, of } = setup()
    rememberSecret('telemetry-test-credential')
    await svc.prompt('p1', 'initialize', TARGET)
    sessions[0].script = async (session) => {
      session.emit({ type: 'tool_execution_start', toolName: 'read', toolCallId: 'tool-a', args: { path: 'a.py', key: 'telemetry-test-credential' } })
      session.emit({ type: 'tool_execution_end', toolName: 'read', toolCallId: 'tool-a', isError: false, result: { content: [{ type: 'text', text: 'telemetry-test-credential ' + 'x'.repeat(50_000) }] } })
      session.emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 2, delayMs: 1000, errorMessage: 'telemetry-test-credential timeout' })
      session.delta('done'); session.finish()
    }
    await svc.prompt('p1', 'inspect', TARGET)
    const detail = of('p1', 'tool_detail').at(-1) as Extract<AgentEvent, { type: 'tool_detail' }>
    expect(detail.tool).toMatchObject({ id: 'tool-a', status: 'completed', durationMs: expect.any(Number) })
    expect(detail.tool.output.length).toBeLessThanOrEqual(32_000)
    expect(detail.tool.input + detail.tool.output).not.toContain('telemetry-test-credential')
    expect(JSON.stringify(of('p1', 'retry'))).not.toContain('telemetry-test-credential')
    expect((await svc.snapshot('p1')).messages.at(-1)?.tools[0].id).toBe('tool-a')
    svc.closeAll()
  })

  it.each([
    ['known', 0.25], ['unknown', null], ['subscription', null], ['local', null], ['free', 0]
  ] as const)('preserves honest %s pricing and accumulates each task only once', async (pricing, expectedCost) => {
    const model = { ...TARGET, id: 'm1' }
    const { svc, sessions, of } = setup({ accounts: async () => ({
      modelRuntime: { getModel: () => model } as never, getSelectedModel: () => model,
      hasConsent: async () => true, selectedModelPricing: () => pricing
    }) })
    await svc.prompt('p1', 'initialize', TARGET)
    sessions[0].script = async (session) => {
      for (let turn = 0; turn < 2; turn++) session.emit({ type: 'message_end', message: {
        role: 'assistant', usage: { input: 4, output: 2, cacheRead: 1, cacheWrite: 0, cost: { total: 0.125 } }
      } })
      session.finish()
    }
    await svc.prompt('p1', 'first task', TARGET)
    expect((await svc.snapshot('p1')).usage).toMatchObject({ inputTokens: 8, outputTokens: 4, cacheReadTokens: 2, costUsd: expectedCost })
    await svc.prompt('p1', 'second task', TARGET)
    expect((of('p1', 'usage').at(-1) as Extract<AgentEvent, { type: 'usage' }>).usage).toMatchObject({
      inputTokens: 16, outputTokens: 8, cacheReadTokens: 4, costUsd: expectedCost === null ? null : expectedCost * 2
    })
    svc.closeAll()
  })

  it('retains completed model usage when cancellation interrupts the rest of a task', async () => {
    const { svc, sessions } = setup()
    await svc.prompt('p1', 'initialize', TARGET)
    const received = deferred<void>()
    sessions[0].script = (session) => new Promise<void>((resolve) => {
      session.emit({ type: 'message_end', message: {
        role: 'assistant', usage: { input: 9, output: 3, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }
      } })
      session.abort = async () => { session.aborted = true; session.finish(); resolve() }
      received.resolve()
    })
    const run = svc.prompt('p1', 'work then wait', TARGET)
    await received.promise
    await svc.abort('p1')
    await run
    svc.close('p1')
    const restored = await svc.snapshot('p1')
    expect(restored.task?.status).toBe('cancelled')
    expect(restored.usage).toMatchObject({ inputTokens: 9, outputTokens: 3, costUsd: null })
    svc.closeAll()
  })

  it('counts summarization usage against the same task and session budget', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'initialize', TARGET)
    svc.setLimits('p1', { maxTurns: 5, maxDurationMs: 10_000, maxTokens: 10 })
    sessions[0].script = async (session) => {
      session.emit({ type: 'compaction_start', reason: 'threshold' })
      session.emit({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false, result: {
        summary: 'short context', usage: { input: 8, output: 4, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }
      } })
      session.finish()
    }
    await svc.prompt('p1', 'summarize', TARGET)
    expect(of('p1', 'error').at(-1)).toMatchObject({ code: 'agent_limit' })
    expect((await svc.snapshot('p1')).usage).toMatchObject({ inputTokens: 8, outputTokens: 4, costUsd: null })
    expect(of('p1', 'compaction')).toEqual([{ type: 'compaction', active: true }, { type: 'compaction', active: false }])
    svc.closeAll()
  })

  it('phát số context của Pi sau mỗi lượt gọi model, chỉ khi số đổi, và đưa vào snapshot', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'initialize', TARGET)
    expect((await svc.snapshot('p1')).context).toBeUndefined() // phiên trống: Pi chưa có số nào
    const report = (tokens: number | null) => { sessions[0].contextUsage = { tokens, contextWindow: 200_000, percent: tokens === null ? null : tokens / 2000 } }
    sessions[0].script = async (session) => {
      report(5_000); session.emit({ type: 'turn_end' })
      session.emit({ type: 'turn_end' }) // số không đổi thì không phát lại
      report(12_000); session.emit({ type: 'turn_end' })
      session.delta('xong'); session.finish()
    }
    await svc.prompt('p1', 'làm việc', TARGET)
    expect(of('p1', 'context')).toEqual([
      { type: 'context', context: { tokens: 5_000, window: 200_000 } },
      { type: 'context', context: { tokens: 12_000, window: 200_000 } }
    ])
    expect((await svc.snapshot('p1')).context).toEqual({ tokens: 12_000, window: 200_000 })
    // Sau khi tóm tắt Pi chưa có số mới (tokens null): phải ẩn chứ không giữ số cũ.
    sessions[0].script = async (session) => {
      report(null)
      session.emit({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false })
      session.finish()
    }
    await svc.prompt('p1', 'tóm tắt', TARGET)
    expect(of('p1', 'context').at(-1)).toEqual({ type: 'context', context: null })
    expect((await svc.snapshot('p1')).context).toBeUndefined()
    svc.closeAll()
  })

  it.each([[0, 200_000], [-5, 200_000], [Number.NaN, 200_000], [1_000, 0], [1_000, Number.POSITIVE_INFINITY]])('không phát số context vô nghĩa (%s / %s)', async (tokens, contextWindow) => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'initialize', TARGET)
    sessions[0].contextUsage = { tokens, contextWindow, percent: null }
    sessions[0].script = async (session) => { session.emit({ type: 'turn_end' }); session.finish() }
    await svc.prompt('p1', 'x', TARGET)
    expect(of('p1', 'context')).toEqual([])
    expect((await svc.snapshot('p1')).context).toBeUndefined()
    svc.closeAll()
  })

  it('Pi ném lỗi khi tính context thì lượt vẫn xong bình thường, chỉ không có vòng', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'initialize', TARGET)
    sessions[0].contextFails = true
    sessions[0].script = async (session) => { session.emit({ type: 'turn_end' }); session.delta('vẫn xong'); session.finish() }
    await svc.prompt('p1', 'x', TARGET)
    expect(of('p1', 'done').at(-1)).toMatchObject({ text: 'vẫn xong' })
    expect(of('p1', 'context')).toEqual([])
    expect((await svc.snapshot('p1')).context).toBeUndefined()
    svc.closeAll()
  })

  it('ẩn vòng context khi cửa sổ của model tuỳ chỉnh chỉ là giá trị mặc định chứ không phải số người dùng khai', async () => {
    const model = { ...TARGET, id: 'm1' }
    const { svc, sessions, of } = setup({ accounts: async () => ({
      modelRuntime: { getModel: () => model } as never, getSelectedModel: () => model,
      hasConsent: async () => true, selectedModelWindowKnown: () => false
    }) })
    await svc.prompt('p1', 'initialize', TARGET)
    sessions[0].contextUsage = { tokens: 3_000, contextWindow: 4096, percent: 73 }
    sessions[0].script = async (session) => { session.emit({ type: 'turn_end' }); session.finish() }
    await svc.prompt('p1', 'x', TARGET)
    expect(of('p1', 'context')).toEqual([])
    expect((await svc.snapshot('p1')).context).toBeUndefined()
    svc.closeAll()
  })

  it('snapshot dùng cửa sổ của model đang chọn vì phiên Pi chỉ đổi model ở lượt gửi kế tiếp', async () => {
    const model = { ...TARGET, id: 'm2', contextWindow: 1_000_000 }
    const { svc, sessions } = setup({ accounts: async () => ({
      modelRuntime: { getModel: () => model } as never, getSelectedModel: () => model, hasConsent: async () => true
    }) })
    await svc.prompt('p1', 'initialize', TARGET)
    sessions[0].contextUsage = { tokens: 40_000, contextWindow: 128_000, percent: 31 } // model cũ của phiên
    expect((await svc.snapshot('p1')).context).toEqual({ tokens: 40_000, window: 1_000_000 })
    svc.closeAll()
  })
})

describe('scrub', () => {
  it('che gsk_, AIza, JWT, Bearer và giá trị key đang active', () => {
    rememberSecret('active-key-value-xyz')
    const raw = 'gsk_abcdef123456 AIzaSyA123456789 AIza eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig active-key-value-xyz Bearer tok sk-abcdef123456'
    const out = scrub(raw)
    for (const needle of ['gsk_abcdef123456', 'AIzaSyA123456789', 'eyJhbGciOiJIUzI1NiJ9', 'active-key-value-xyz', 'tok', 'sk-abcdef123456'])
      expect(out).not.toContain(needle)
    expect(out).toContain('***')
    expect(out.length).toBeLessThanOrEqual(200)
  })
})

describe('AgentService (huỷ lượt đang khởi động)', () => {
  const modelChoice: AgentAccounts = {
    modelRuntime: { getModel: () => ({ ...TARGET, id: 'm1' }) } as unknown as AgentAccounts['modelRuntime'],
    getSelectedModel: () => ({ provider: TARGET.provider, id: 'm1' }),
    hasConsent: async () => true,
  }

  it('đổi đích nhận lúc chờ kết quả đồng ý cũ → không tạo phiên', async () => {
    const checked = deferred<void>()
    const consent = deferred<boolean>()
    let selection = { ...TARGET, id: 'm1' }
    const { svc, sessions, events } = setup({
      accounts: async () => ({
        modelRuntime: { getModel: () => selection } as unknown as AgentAccounts['modelRuntime'],
        getSelectedModel: () => selection,
        hasConsent: async () => { checked.resolve(undefined); return consent.promise },
      }),
    })
    const run = svc.prompt('p1', 'hỏi', TARGET)
    await checked.promise
    selection = { ...selection, baseUrl: 'https://test.example/another-endpoint' }
    consent.resolve(true)

    await expect(run).rejects.toMatchObject({ code: 'ai_provider_changed' })
    expect(sessions).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('closeAll trong lúc nạp model: lượt cũ không tạo phiên, không phát done/error', async () => {
    const gate = deferred<typeof modelChoice>()
    const { svc, events, sessions, base } = setup({ accounts: () => gate.promise })
    const run = svc.prompt('p1', 'hỏi', TARGET)
    svc.closeAll()
    gate.resolve(modelChoice)
    await expect(run).resolves.toBeUndefined()
    expect(sessions).toHaveLength(0)
    expect(events).toHaveLength(0)
    rmSync(base, { recursive: true, force: true })
  })

  it('close trong lúc chờ root: không tạo phiên sau khi root về', async () => {
    const asked = deferred<void>()
    const gate = deferred<string>()
    const { svc, events, sessions, roots, base } = setup({
      rootOf: () => { asked.resolve(undefined); return gate.promise }
    })
    const run = svc.prompt('p1', 'hỏi', TARGET)
    await asked.promise
    svc.close('p1')
    gate.resolve(roots.p1)
    await expect(run).resolves.toBeUndefined()
    expect(sessions).toHaveLength(0)
    expect(events).toHaveLength(0)
    rmSync(base, { recursive: true, force: true })
  })

  it('abort trong lúc nạp model: panel nhận ai_cancelled ngay, phiên không được tạo', async () => {
    const gate = deferred<typeof modelChoice>()
    const { svc, of, sessions, base } = setup({ accounts: () => gate.promise })
    const run = svc.prompt('p1', 'hỏi', TARGET)
    await svc.abort('p1')
    expect(of('p1', 'error').at(-1)).toMatchObject({ type: 'error', code: 'ai_cancelled' })
    gate.resolve(modelChoice)
    await expect(run).resolves.toBeUndefined()
    expect(sessions).toHaveLength(0)
    expect(of('p1', 'done')).toHaveLength(0)
    rmSync(base, { recursive: true, force: true })
  })

  it('lượt mới sau closeAll không nhận done/error trễ của lượt cũ', async () => {
    const gate = deferred<typeof modelChoice>()
    const { svc, of, base } = setup({ accounts: () => gate.promise })
    const old = svc.prompt('p1', 'cũ', TARGET)
    svc.closeAll()
    gate.resolve(modelChoice)
    await old
    await svc.prompt('p1', 'mới', TARGET)
    await svc.prompt('p1', 'mới nữa', TARGET)
    expect(of('p1', 'done')).toHaveLength(2) // chỉ hai lượt mới, lượt cũ bị huỷ không phát gì
    expect(of('p1', 'error')).toHaveLength(0)
    rmSync(base, { recursive: true, force: true })
  })
})
