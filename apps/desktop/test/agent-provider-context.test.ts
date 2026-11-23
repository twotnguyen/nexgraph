// F4 mục 1 (A2-F1): context window của nhà cung cấp tuỳ chỉnh + maxTokens sàn khi gọi model thật.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AccountService, CUSTOM_MODEL_SPEC } from '../src/main/agent/accounts'
import { AgentService, contextWindowFailure, createPiSession, CONTEXT_WINDOW_MESSAGE } from '../src/main/agent/session'
import { SecretStore } from '../src/main/ai/settings'
import type { EngineApi } from '../src/main/engine/api'
import type { AgentEvent, AiConsentTarget } from '../src/shared/agent-types'
import { fakeProvider, type Seen } from './fake-provider'

const KEY = 'sk-f4-provider-that'
const maxOutput = (body: string): number | undefined => {
  const j = JSON.parse(body) as { max_completion_tokens?: number; max_tokens?: number }
  return j.max_completion_tokens ?? j.max_tokens
}

describe('F4 mục 1 — context window provider tuỳ chỉnh', () => {
  const seen: Seen = { bodies: [], paths: [], auth: [] }
  let llm: Awaited<ReturnType<typeof fakeProvider>>
  let base: string
  let root: string
  let dataDir: string

  beforeAll(async () => {
    process.env.NEXGRAPH_ALLOW_HTTP_PROVIDER = '1' // provider giả chạy trên 127.0.0.1
    llm = await fakeProvider(seen)
    base = realpathSync.native(mkdtempSync(join(tmpdir(), 'ng-f4-context-')))
    root = join(base, 'proj')
    dataDir = join(base, 'data')
    mkdirSync(root)
    mkdirSync(dataDir)
    writeFileSync(join(root, 'a.py'), 'print(1)\n')
  }, 30_000)

  afterAll(async () => {
    await llm?.close()
    delete process.env.NEXGRAPH_ALLOW_HTTP_PROVIDER
    rmSync(base, { recursive: true, force: true })
  })

  /** Mỗi test một AccountService riêng để prefs/khoá không lẫn nhau. */
  const account = async (): Promise<AccountService> => AccountService.create({
    dataDir, prefsFile: join(base, `prefs-${Math.random().toString(16).slice(2)}.json`),
    secrets: new SecretStore(join(base, 'key.json'), { available: () => true, encrypt: (s) => `enc:${s}`, decrypt: (s) => s.slice(4) }),
    openExternal: () => {}, notify: () => {}, notice: () => {}, modelsChanged: () => {}, ask: async () => null
  })

  const turn = async (provider: string, model: string, opts: { contextWindow?: number } = {}): Promise<AgentEvent[]> => {
    const accounts = await account()
    await accounts.saveCustomProvider({ id: provider, label: provider, baseUrl: llm.url, model, ...opts }, KEY)
    accounts.selectModel(provider, model)
    const target = (await accounts.getConsentTarget()) as AiConsentTarget
    await accounts.grantConsent('p1', target)
    const events: AgentEvent[] = []
    const svc = new AgentService({
      api: { forModel() { return this }, aiSourceExcludes: async () => [], search: async () => [], code: async (_p: string, f: string, start: number, end: number) => ({ file: f, start, end, text: 'print(1)' }) } as unknown as EngineApi,
      dataDir, accounts: async () => accounts, rootOf: async () => root, emit: (_pid, e) => events.push(e)
    })
    try {
      await svc.prompt('p1', 'chào', target)
      return events
    } finally {
      svc.closeAll()
    }
  }
  const lastEnd = (events: AgentEvent[]) => events.filter((e) => e.type === 'done' || e.type === 'error').at(-1)

  it('model tuỳ chỉnh chưa khai báo dùng context window mặc định 128k, không phải 4096', async () => {
    const accounts = await account()
    await accounts.saveCustomProvider({ id: 'defaults', label: 'Defaults', baseUrl: 'https://example.com/v1', model: 'm' })
    const model = accounts.modelRuntime.getModel('defaults', 'm') as { contextWindow: number; maxTokens: number }
    expect(model.contextWindow).toBe(128_000)
    expect(model.maxTokens).toBe(4096)
    expect(CUSTOM_MODEL_SPEC('m').contextWindow).toBe(128_000)
  })

  it('lấy context_length từ /v1/models khi người dùng để trống ô context window', async () => {
    const accounts = await account()
    await accounts.saveCustomProvider({ id: 'discover', label: 'Discover', baseUrl: llm.url, model: 'fake-1' }, KEY)
    expect(seen.paths.some((p) => p === 'GET /v1/models')).toBe(true)
    expect((accounts.modelRuntime.getModel('discover', 'fake-1') as { contextWindow: number }).contextWindow).toBe(65_536)
  })

  it('ô context window người dùng nhập thắng giá trị dò được, và không gọi /v1/models', async () => {
    const accounts = await account()
    const before = seen.paths.filter((p) => p.endsWith('/models')).length
    await accounts.saveCustomProvider({ id: 'explicit', label: 'Explicit', baseUrl: llm.url, model: 'fake-1', contextWindow: 20_000 }, KEY)
    expect(seen.paths.filter((p) => p.endsWith('/models')).length).toBe(before)
    expect((accounts.modelRuntime.getModel('explicit', 'fake-1') as { contextWindow: number }).contextWindow).toBe(20_000)
  })

  it('"Kiểm tra kết nối" gửi max output hợp lệ (>= 16) dù context window nhỏ 4096', async () => {
    const accounts = await account()
    await accounts.saveCustomProvider({ id: 'probe', label: 'Probe', baseUrl: llm.url, model: 'fake-1', contextWindow: 4096 }, KEY)
    accounts.selectModel('probe', 'fake-1')
    const from = seen.bodies.length
    await expect(accounts.test()).resolves.toMatchObject({ ok: true })
    expect(maxOutput(seen.bodies[from])).toBeGreaterThanOrEqual(16)
  })

  it('lượt chat bình thường gửi max output >= 1024 (không bao giờ là 1)', async () => {
    const from = seen.bodies.length
    const events = await turn('normal', 'fake-1')
    expect(lastEnd(events)).toMatchObject({ type: 'done' })
    expect(maxOutput(seen.bodies[from])).toBeGreaterThanOrEqual(1024)
  })

  it('context window quá nhỏ: nói rõ số token của model và KHÔNG gửi yêu cầu nào (MIN-46 M3)', async () => {
    const from = seen.bodies.length
    const events = await turn('tiny', 'fake-1', { contextWindow: 2000 })
    expect(seen.bodies.length).toBe(from) // không có request nào rời app
    const end = lastEnd(events) as { code: string; message: string }
    expect(end).toMatchObject({ code: 'ai_context_small' })
    expect(end.message).toBe('Mô hình chỉ có 2000 token ngữ cảnh, không đủ cho system prompt + công cụ — chọn mô hình lớn hơn.')
  })

  it('câu lỗi ngữ cảnh theo đúng cửa sổ: nhỏ thì chỉ model lớn hơn, đủ rộng thì giữ câu cũ', () => {
    expect(contextWindowFailure(6000)).toMatchObject({
      code: 'ai_context_small', message: 'Mô hình chỉ có 6000 token ngữ cảnh, không đủ cho system prompt + công cụ — chọn mô hình lớn hơn.'
    })
    expect(contextWindowFailure(8000)).toEqual({ code: 'ai_context_window', message: CONTEXT_WINDOW_MESSAGE })
    expect(contextWindowFailure(128_000)).toEqual({ code: 'ai_context_window', message: CONTEXT_WINDOW_MESSAGE })
  })

  it('MIN-46 M2: sửa provider khi /v1/models lỗi vẫn giữ contextWindow đã dò của cùng model', async () => {
    const accounts = await account()
    await accounts.saveCustomProvider({ id: 'keep', label: 'Keep', baseUrl: llm.url, model: 'fake-1' }, KEY)
    expect((accounts.modelRuntime.getModel('keep', 'fake-1') as { contextWindow: number }).contextWindow).toBe(65_536)
    const offline = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    try {
      await accounts.saveCustomProvider({ id: 'keep', label: 'Keep đổi tên', baseUrl: llm.url, model: 'fake-1' })
    } finally { offline.mockRestore() }
    accounts.selectModel('keep', 'fake-1')
    expect((await accounts.listModels()).find((m) => m.provider === 'keep')?.contextWindow).toBe(65_536)
    expect(accounts.selectedModelWindowKnown()).toBe(true)
  })

  it('MIN-46 M3: Kiểm tra kết nối cảnh báo ngay khi cửa sổ ngữ cảnh quá nhỏ', async () => {
    const small = await account()
    await small.saveCustomProvider({ id: 'small', label: 'Small', baseUrl: llm.url, model: 'fake-1', contextWindow: 6000 }, KEY)
    small.selectModel('small', 'fake-1')
    await expect(small.test()).resolves.toMatchObject({ ok: true, contextWarning: 6000 })
    const wide = await account()
    await wide.saveCustomProvider({ id: 'wide', label: 'Wide', baseUrl: llm.url, model: 'fake-1' }, KEY)
    wide.selectModel('wide', 'fake-1')
    const wideResult = await wide.test()
    expect(wideResult).toMatchObject({ ok: true })
    expect(wideResult.contextWarning).toBeUndefined()
  })

  it('createPiSession không gửi maxTokens dưới sàn khi ngân sách tác vụ cạn', async () => {
    const accounts = await account()
    await accounts.saveCustomProvider({ id: 'floor', label: 'Floor', baseUrl: llm.url, model: 'fake-1' }, KEY)
    const model = accounts.modelRuntime.getModel('floor', 'fake-1')!
    const from = seen.bodies.length
    const session = await createPiSession({
      cwd: root, agentDir: join(dataDir, 'agent'), tools: [], modelRuntime: accounts.modelRuntime, model,
      extension: () => {}, remainingTokens: () => 1, assertDispatch: () => {}, assertRequest: () => {}
    })
    try {
      await session.prompt('chào', { expandPromptTemplates: false })
    } finally {
      session.dispose()
    }
    expect(maxOutput(seen.bodies[from])).toBeGreaterThanOrEqual(1024)
  }, 30_000)
})
