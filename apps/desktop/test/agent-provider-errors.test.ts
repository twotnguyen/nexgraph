// F4 mục 2 (A2-F2): lỗi HTTP 4xx phải phân loại đúng, chỉ lỗi mạng mới là ai_unreachable.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AccountService } from '../src/main/features/agent/accounts'
import { AgentService, classifyProviderStatus } from '../src/main/features/agent/session'
import { SecretStore } from '../src/main/platform/settings'
import type { EngineApi } from '../src/main/platform/engine/api'
import type { AgentEvent, AiConsentTarget } from '../src/shared/agent-types'
import { fakeProvider, type Seen } from './fake-provider'

const KEY = 'sk-f4-provider-that'

describe('F4 mục 2 — phân loại lỗi nhà cung cấp', () => {
  const seen: Seen = { bodies: [], paths: [], auth: [] }
  let llm: Awaited<ReturnType<typeof fakeProvider>>
  let base: string
  let root: string
  let dataDir: string

  beforeAll(async () => {
    process.env.NEXGRAPH_ALLOW_HTTP_PROVIDER = '1'
    llm = await fakeProvider(seen)
    base = realpathSync.native(mkdtempSync(join(tmpdir(), 'ng-f4-errors-')))
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

  const account = async (): Promise<AccountService> => AccountService.create({
    dataDir, prefsFile: join(base, `prefs-${Math.random().toString(16).slice(2)}.json`),
    secrets: new SecretStore(join(base, 'key.json'), { available: () => true, encrypt: (s) => `enc:${s}`, decrypt: (s) => s.slice(4) }),
    openExternal: () => {}, notify: () => {}, notice: () => {}, modelsChanged: () => {}, ask: async () => null
  })

  const turn = async (provider: string, model: string, baseUrl = llm.url): Promise<AgentEvent[]> => {
    const accounts = await account()
    await accounts.saveCustomProvider({ id: provider, label: provider, baseUrl, model }, KEY)
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
  const lastError = (events: AgentEvent[]) => events.filter((e) => e.type === 'error').at(-1) as { code: string; message: string; detail?: string }

  it('provider trả 400: mã ai_bad_request kèm thông điệp ngắn của provider, không phải ai_unreachable', async () => {
    const end = lastError(await turn('rejects', 'rejects-params'))
    expect(end.code).toBe('ai_bad_request')
    expect(end.message).toMatch(/từ chối yêu cầu/)
    expect(end.detail).toContain('max_output_tokens')
  })

  it('model không tồn tại: mã ai_model_not_found kèm thông điệp provider', async () => {
    const end = lastError(await turn('missing', 'no-such-model'))
    expect(end.code).toBe('ai_model_not_found')
    expect(end.message).toMatch(/Không tìm thấy mô hình/)
    expect(end.detail).toContain('does not exist')
  })

  it('sai key: mã ai_unauthorized', async () => {
    expect(lastError(await turn('denied', 'denied')).code).toBe('ai_unauthorized')
  })

  it('server chết hẳn: vẫn là ai_unreachable (chỉ lỗi mạng mới là unreachable)', async () => {
    const end = lastError(await turn('offline', 'fake-1', 'http://127.0.0.1:9/v1'))
    expect(end.code).toBe('ai_unreachable')
  })

  it('phân loại đủ mã 4xx/5xx, che khoá trong thông điệp provider', () => {
    expect(classifyProviderStatus(400, '{"error":{"message":"bad param"}}')).toMatchObject({ code: 'ai_bad_request', detail: 'bad param' })
    expect(classifyProviderStatus(401)).toMatchObject({ code: 'ai_unauthorized' })
    expect(classifyProviderStatus(403)).toMatchObject({ code: 'ai_unauthorized' })
    expect(classifyProviderStatus(404, '{"error":{"message":"model not found"}}')).toMatchObject({ code: 'ai_model_not_found', detail: 'model not found' })
    expect(classifyProviderStatus(422, '{"error":{"message":"schema invalid"}}')).toMatchObject({ code: 'ai_bad_request', detail: 'schema invalid' })
    expect(classifyProviderStatus(429)).toMatchObject({ code: 'ai_rate_limited' })
    expect(classifyProviderStatus(500, 'upstream down')).toMatchObject({ code: 'ai_provider_error', detail: 'upstream down' })
    expect(classifyProviderStatus(400, `{"error":{"message":"bad key ${KEY}"}}`).detail).not.toContain(KEY)
  })
})
