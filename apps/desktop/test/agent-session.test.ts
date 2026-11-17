import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentService, ASK_TOOLS, EDIT_TOOLS, rememberSecret, scrub, type ModelChoice, type PiSession, type SessionSpec } from '../src/main/agent/session'
import { TOOL_DEFS } from '../src/main/ai/tools'
import type { EngineApi } from '../src/main/engine/api'
import type { AgentEvent } from '../src/shared/agent-types'

const GRAPH = TOOL_DEFS.map((t) => t.function.name)
type ToolCallHandler = (e: { type: 'tool_call'; toolName: string; toolCallId: string; input: Record<string, unknown> }) => Promise<{ block: true; reason: string } | undefined>
type Listener = (e: unknown) => void
const tick = () => new Promise((r) => setTimeout(r, 0))

/** Phiên pi giả: chạy extension thật trên một `pi` giả, prompt() chạy kịch bản của test. */
class FakeSession {
  handler!: ToolCallHandler
  listeners: Listener[] = []
  active: string[]
  messages: { role: string; stopReason?: string; errorMessage?: string }[] = []
  model: { provider: string; id: string } | undefined
  aborted = false
  disposed = false
  script: (s: FakeSession, text: string) => Promise<void> = async (s) => s.finish()
  decisions: ({ block: true; reason: string } | undefined)[] = []
  constructor(public spec: SessionSpec) {
    this.active = [...spec.tools]
    spec.extension({ registerTool: () => {}, on: (ev: string, h: ToolCallHandler) => { if (ev === 'tool_call') this.handler = h } } as never)
  }
  subscribe(l: Listener) { this.listeners.push(l); return () => { this.listeners = this.listeners.filter((x) => x !== l) } }
  emit(e: unknown) { for (const l of this.listeners) l(e) }
  delta(t: string) { this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: t } }) }
  async call(toolName: string, input: Record<string, unknown>) {
    this.emit({ type: 'tool_execution_start', toolName })
    const d = await this.handler({ type: 'tool_call', toolName, toolCallId: 'c1', input })
    this.decisions.push(d)
    this.emit({ type: 'tool_execution_end', toolName, isError: !!d })
    return d
  }
  finish(stopReason = 'stop', errorMessage?: string) {
    this.messages.push({ role: 'assistant', stopReason: this.aborted ? 'aborted' : stopReason, errorMessage })
  }
  async prompt(text: string): Promise<void> { this.messages.push({ role: 'user' }); await this.script(this, text) }
  async abort() { this.aborted = true }
  dispose() { this.disposed = true; this.aborted = true }
  setActiveToolsByName(names: string[]) { this.active = names }
  getActiveToolNames() { return this.active }
  async setModel(m: { provider: string; id: string }) { this.model = m }
}

function setup(over: { consent?: boolean; selected?: null; models?: () => Promise<ModelChoice>; rootOf?: (pid: string) => Promise<string> } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ng-sess-')))
  const roots: Record<string, string> = { p1: join(base, 'p1'), p2: join(base, 'p2') }
  for (const r of Object.values(roots)) { mkdirSync(r); writeFileSync(join(r, 'a.py'), 'x\n') }
  const events: { pid: string; e: AgentEvent }[] = []
  const sessions: FakeSession[] = []
  const code = vi.fn(async (_pid: string, file: string, start: number, end: number) => {
    if (file !== 'a.py') throw Object.assign(new Error('no'), { code: 'file_not_found' })
    return { file, start, end, text: 'x' }
  })
  const fakeModel = { provider: 'nexgraph-custom', id: 'm1' }
  const svc = new AgentService({
    api: { code } as unknown as EngineApi,
    dataDir: join(base, 'data'),
    models: over.models ?? (async () => ({ modelRuntime: { getModel: () => fakeModel } as never, selected: over.selected === null ? null : { provider: 'nexgraph-custom', id: 'm1' } })),
    hasConsent: async () => over.consent ?? true,
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
    await svc.prompt('p1', 'chào')
    const spec = sessions[0].spec
    expect(spec.cwd).toBe(realpathSync(roots.p1))
    expect(spec.agentDir.startsWith(join(base, 'data'))).toBe(true)
    expect(sessions[0].active.sort()).toEqual([...ASK_TOOLS, ...GRAPH].sort())
    expect(ASK_TOOLS).toEqual(['read', 'grep', 'find', 'ls'])
    expect(EDIT_TOOLS).toEqual(['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'])
    expect(sessions[0].model).toEqual({ provider: 'nexgraph-custom', id: 'm1' })
  })

  it('text_delta → sự kiện text; kết thúc → done có citations đã kiểm chứng (trích dẫn sai bị đánh dấu)', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'hỏi') // phiên được tạo ở lượt đầu; kịch bản đặt cho lượt sau
    sessions[0].script = async (s) => { s.delta('Xem [[a.py:1-1]] '); s.delta('và [[sai.py:1-2]]'); s.finish() }
    await svc.prompt('p1', 'hỏi tiếp')
    expect(of('p1', 'text')).toEqual([{ type: 'text', delta: 'Xem [[a.py:1-1]] ' }, { type: 'text', delta: 'và [[sai.py:1-2]]' }])
    const done = of('p1', 'done').at(-1) as Extract<AgentEvent, { type: 'done' }>
    expect(done.text).toBe('Xem [[a.py:1-1]] và [[sai.py:1-2]]')
    expect(done.citations.map((c) => [c.file, c.valid])).toEqual([['a.py', true], ['sai.py', false]])
  })

  it('tool_execution_start/end → sự kiện tool', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'a')
    sessions[0].script = async (s) => { await s.call('search', { query: 'x' }); s.finish() }
    await svc.prompt('p1', 'b')
    expect(of('p1', 'tool')).toEqual([{ type: 'tool', name: 'search', status: 'start' }, { type: 'tool', name: 'search', status: 'end', error: false }])
  })

  it('setMode("edit") cấu hình lại phiên tại chỗ với tool sửa, giữ nguyên phiên', async () => {
    const { svc, sessions } = setup()
    await svc.prompt('p1', 'a')
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
    await svc.prompt('p1', 'a')
    expect(sessions[0].active.sort()).toEqual([...EDIT_TOOLS, ...GRAPH].sort())
  })

  it('lượt Sửa: write → approval; approve(true) cho qua, approve(false) chặn kèm lý do cho mô hình', async () => {
    const { svc, sessions, of } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a')
    const s = sessions[0]
    s.script = writeScript()
    let run = svc.prompt('p1', 'viết b.txt')
    await vi.waitFor(() => expect(of('p1', 'approval')).toHaveLength(1))
    const req = (of('p1', 'approval')[0] as Extract<AgentEvent, { type: 'approval' }>).request
    expect(req).toMatchObject({ tool: 'write', path: 'b.txt', before: '', after: 'mới' })
    expect(svc.pending('p1')).toBe(1)
    svc.approve('p1', req.id, true)
    await run
    expect(s.decisions.at(-1)).toBeUndefined()
    expect(of('p1', 'approval_closed')).toEqual([{ type: 'approval_closed', id: req.id }])

    run = svc.prompt('p1', 'viết lại')
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
    await svc.prompt('p1', 'a')
    sessions[0].script = writeScript()
    const run = svc.prompt('p1', 'viết')
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
    await svc.prompt('p1', 'a')
    sessions[0].script = writeScript()
    const run = svc.prompt('p1', 'viết')
    await vi.waitFor(() => expect(svc.pending('p1')).toBe(1))
    svc.setMode('p1', 'ask')
    await run
    expect(sessions[0].decisions.at(-1)).toMatchObject({ block: true })
    expect(svc.pending('p1')).toBe(0)
  })

  it('setMode("edit") khi đang chờ duyệt cũng từ chối yêu cầu cũ', async () => {
    const { svc, sessions } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a')
    sessions[0].script = writeScript()
    const run = svc.prompt('p1', 'viết')
    await vi.waitFor(() => expect(svc.pending('p1')).toBe(1))
    svc.setMode('p1', 'edit')
    await run
    expect(svc.pending('p1')).toBe(0)
  })

  it.each([
    ['401 Unauthorized', 'ai_unauthorized', 'API key bị từ chối'],
    ['429 Too Many Requests', 'ai_unreachable', 'Nhà cung cấp AI trả về 429'],
    ['fetch failed: ECONNREFUSED', 'ai_unreachable', 'Không kết nối được tới nhà cung cấp AI']
  ])('nhà cung cấp lỗi "%s" → sự kiện error tiếng Việt, prompt() không ném, lượt sau vẫn chạy', async (raw, code, message) => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'a')
    sessions[0].script = async (s) => { s.finish('error', raw) }
    await expect(svc.prompt('p1', 'b')).resolves.toBeUndefined()
    expect(of('p1', 'error').at(-1)).toEqual({ type: 'error', code, message })
    sessions[0].script = async (s) => { s.delta('ok'); s.finish() }
    await svc.prompt('p1', 'c')
    expect(of('p1', 'done').at(-1)).toMatchObject({ type: 'done', text: 'ok' })
  })

  it('session.prompt ném lỗi → sự kiện error, prompt() vẫn resolve', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'a')
    sessions[0].script = async () => { throw new Error('fetch failed') }
    await expect(svc.prompt('p1', 'b')).resolves.toBeUndefined()
    expect(of('p1', 'error').at(-1)).toMatchObject({ code: 'ai_unreachable' })
  })

  it('chưa đồng ý gửi mã → consent_required; chưa cấu hình → ai_not_configured; không tạo phiên', async () => {
    const a = setup({ consent: false })
    await expect(a.svc.prompt('p1', 'x')).rejects.toMatchObject({ code: 'consent_required' })
    const b = setup({ selected: null })
    await expect(b.svc.prompt('p1', 'x')).rejects.toMatchObject({ code: 'ai_not_configured' })
    expect(a.sessions.length + b.sessions.length).toBe(0)
  })

  it('đang trả lời thì lượt mới bị từ chối với agent_busy', async () => {
    const { svc, sessions } = setup()
    await svc.prompt('p1', 'a')
    let release = () => {}
    sessions[0].script = (s) => new Promise<void>((r) => { release = () => { s.finish(); r() } })
    const run = svc.prompt('p1', 'b')
    await tick()
    await expect(svc.prompt('p1', 'c')).rejects.toMatchObject({ code: 'agent_busy' })
    release()
    await run
  })

  it('hai dự án có phiên riêng; close(pid) dispose phiên và từ chối yêu cầu treo', async () => {
    const { svc, sessions, of } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a')
    await svc.prompt('p2', 'a')
    expect(sessions).toHaveLength(2)
    expect(svc.getMode('p2')).toBe('ask')
    sessions[0].script = writeScript()
    const run = svc.prompt('p1', 'viết')
    await vi.waitFor(() => expect(svc.pending('p1')).toBe(1))
    svc.close('p1')
    await run
    expect(sessions[0].disposed).toBe(true)
    expect(sessions[1].disposed).toBe(false)
    expect(sessions[0].decisions.at(-1)).toMatchObject({ block: true })
    expect(of('p1', 'approval_closed')).toHaveLength(1)
    expect(svc.pending('p1')).toBe(0)
    await svc.prompt('p1', 'mở lại')
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
    await svc.prompt('p1', 'a')
    let release = () => {}
    const gateOpen = new Promise<void>((r) => { release = r })
    sessions[0].script = async (s) => { await gateOpen; await s.call('write', { path: 'b.txt', content: 'x' }); s.finish() }
    const run = svc.prompt('p1', 'viết')
    await tick()
    await svc.abort('p1')
    release()
    await run
    expect(sessions[0].decisions.at(-1)).toMatchObject({ block: true })
    expect(of('p1', 'approval')).toHaveLength(0)
    expect(svc.pending('p1')).toBe(0)
    // lượt mới bỏ cờ dừng: lại hỏi duyệt bình thường
    sessions[0].script = writeScript()
    const next = svc.prompt('p1', 'viết lại')
    await vi.waitFor(() => expect(of('p1', 'approval')).toHaveLength(1))
    svc.close('p1')
    await next
  })

  it('sau close() không phát sự kiện approval cho tool_call đến muộn', async () => {
    const { svc, sessions, of } = setup()
    svc.setMode('p1', 'edit')
    await svc.prompt('p1', 'a')
    const s = sessions[0]
    svc.close('p1')
    expect(await s.handler({ type: 'tool_call', toolName: 'write', toolCallId: 'c', input: { path: 'b.txt', content: 'x' } })).toMatchObject({ block: true })
    expect(of('p1', 'approval')).toHaveLength(0)
  })

  it('abort khi tạo phiên thất bại không ném', async () => {
    const { svc } = setup()
    ;(svc as unknown as { deps: { createSession: () => Promise<never> } }).deps.createSession = async () => { throw new Error('nạp pi lỗi') }
    await svc.prompt('p1', 'a')
    await expect(svc.abort('p1')).resolves.toBeUndefined()
  })

  it('ai_error không chứa nguyên văn lỗi nhà cung cấp có dạng khoá, chi tiết bị cắt ngắn', async () => {
    const { svc, sessions, of } = setup()
    await svc.prompt('p1', 'a')
    sessions[0].script = async (s) => { s.finish('error', `weird failure sk-abcdef1234567890 Bearer xyz.secret ${'z'.repeat(500)}`) }
    await svc.prompt('p1', 'b')
    const e = of('p1', 'error').at(-1) as Extract<AgentEvent, { type: 'error' }>
    expect(e.code).toBe('ai_error')
    expect(e.message).toMatch(/^Trợ lý AI gặp lỗi/)
    expect(e.message).not.toContain('sk-abcdef1234567890')
    expect(e.message).not.toContain('xyz.secret')
    expect(e.message.length).toBeLessThanOrEqual(260)
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
  const modelChoice = {
    modelRuntime: { getModel: (): { provider: string; id: string } => ({ provider: 'x', id: 'm' }) } as unknown as ModelChoice['modelRuntime'],
    selected: { provider: 'x', id: 'm' }
  }

  it('closeAll trong lúc nạp model: lượt cũ không tạo phiên, không phát done/error', async () => {
    const gate = deferred<typeof modelChoice>()
    const { svc, events, sessions, base } = setup({ models: () => gate.promise })
    const run = svc.prompt('p1', 'hỏi')
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
    const run = svc.prompt('p1', 'hỏi')
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
    const { svc, of, sessions, base } = setup({ models: () => gate.promise })
    const run = svc.prompt('p1', 'hỏi')
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
    const { svc, of, base } = setup({ models: () => gate.promise })
    const old = svc.prompt('p1', 'cũ')
    svc.closeAll()
    gate.resolve(modelChoice)
    await old
    await svc.prompt('p1', 'mới')
    await svc.prompt('p1', 'mới nữa')
    expect(of('p1', 'done')).toHaveLength(2) // chỉ hai lượt mới, lượt cũ bị huỷ không phát gì
    expect(of('p1', 'error')).toHaveLength(0)
    rmSync(base, { recursive: true, force: true })
  })
})
