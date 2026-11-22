import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountService } from '../../../src/main/agent/accounts'
import { SecretStore, type SecretBox } from '../../../src/main/ai/settings'

// DNS giả: hostname công khai phân giải tới IP công khai; IP literal giữ nguyên để test chặn link-local.
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => [{ address: /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : '93.184.216.34', family: 4 }]
}))

const box: SecretBox = {
  available: () => true,
  encrypt: (s) => Buffer.from([...s].reverse().join('')).toString('base64'),
  decrypt: (b) => [...Buffer.from(b, 'base64').toString()].reverse().join('')
}

let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ng-acc-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rmSync(base, { recursive: true, force: true })
})

const make = async (over: { notify?: (e: unknown) => void; ask?: (p: unknown) => Promise<string | null>; secretBox?: SecretBox } = {}) => {
  const prefs = join(base, 'prefs.json')
  const svc = await AccountService.create({
    dataDir: base, prefsFile: prefs,
    secrets: new SecretStore(join(base, 'ai-key.json'), over.secretBox ?? box),
    openExternal: (url) => opens.push(url),
    notify: over.notify ?? (() => {}),
    ask: over.ask ?? (async () => 'answer')
  })
  return { svc, prefs }
}
const opens: string[] = []
const legacyAuth = () => join(base, 'agent', 'auth.json')
const vaultFile = () => join(base, 'agent', 'oauth-secrets.json')
const vault = () => JSON.parse(new SecretStore(vaultFile(), box).readStrict('credentials') ?? '{}') as Record<string, unknown>

/** Quét mọi tệp dưới dataDir, báo nếu chứa chuỗi. */
const scan = (needle: string): string[] => {
  const hits: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (readFileSync(p).includes(needle)) hits.push(p)
    }
  }
  walk(base)
  return hits
}

type OAuthHooks = NonNullable<Parameters<typeof AccountService.prototype.modelRuntime.registerProvider>[1]['oauth']>

const fakeOauthProvider = (svc: AccountService, login: OAuthHooks['login'], id = 'fakeoauth', refreshToken: OAuthHooks['refreshToken'] = async (c) => c): void => {
  svc.modelRuntime.registerProvider(id, {
    name: id,
    api: 'openai-completions',
    baseUrl: 'https://oauth.example/v1',
    oauth: {
      name: `${id} subscription`,
      login,
      refreshToken,
      getApiKey: (c) => c.access
    },
    models: [{ id: 'm', name: 'm', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 }]
  })
}

/** ask treo tới khi test trả lời; `asked` báo câu hỏi đã tới renderer (không dùng timer). */
const parkedAsk = () => {
  let reply: (v: string | null) => void = () => {}
  let markAsked: () => void = () => {}
  const asked = new Promise<void>((r) => { markAsked = r })
  return {
    ask: () => { markAsked(); return new Promise<string | null>((r) => { reply = r }) },
    asked,
    reply: (v: string | null) => reply(v)
  }
}
describe('AccountService', () => {
  it('setApiKey lưu bản mã hoá, không có khoá dạng thường trong bất kỳ tệp nào dưới dataDir', async () => {
    const { svc } = await make()
    const key = 'sk-secret-khong-tren-dia'
    await svc.setApiKey('anthropic', key)
    expect(scan(key)).toEqual([])
    expect(JSON.parse(readFileSync(join(base, 'ai-key.json'), 'utf8')).anthropic).toBeTruthy()
  })

  it('khởi động lại: khoá được nạp lại, listProviders báo hasKey', async () => {
    const { svc: first } = await make()
    await first.setApiKey('anthropic', 'sk-again')
    const { svc } = await make()
    const list = await svc.listProviders()
    expect(list.find((p) => p.id === 'anthropic')).toMatchObject({ hasKey: true, oauth: false, custom: false, authMethods: ['api_key'] })
  })

  it('saveCustomProvider baseUrl sai → bad_param; hợp lệ → listModels có model đó', async () => {
    const { svc } = await make()
    await expect(svc.saveCustomProvider({ id: 'smoke', label: 'S', baseUrl: 'ftp://x', model: 'fake' }))
      .rejects.toMatchObject({ code: 'bad_param' })
    // HTTP chỉ cho localhost khi bật cờ dev tường minh.
    process.env.NEXGRAPH_ALLOW_HTTP_PROVIDER = '1'
    try {
      await svc.saveCustomProvider({ id: 'smoke', label: 'Smoke', baseUrl: 'http://127.0.0.1:9/v1', model: 'fake' })
    } finally {
      delete process.env.NEXGRAPH_ALLOW_HTTP_PROVIDER
    }
    expect((await svc.listModels()).find((m) => m.provider === 'smoke' && m.id === 'fake')).toBeTruthy()
    const providers = await svc.listProviders()
    expect(providers.find((p) => p.id === 'smoke')).toMatchObject({ custom: true, label: 'Smoke' })
  })

  it('chặn HTTP công khai và IP link-local/private, kể cả khi có cờ dev cho localhost', async () => {
    const { svc } = await make()
    await expect(svc.saveCustomProvider({ id: 'pub', label: 'P', baseUrl: 'http://api.example.com/v1', model: 'm' }))
      .rejects.toMatchObject({ code: 'bad_param' })
    await expect(svc.saveCustomProvider({ id: 'link', label: 'L', baseUrl: 'http://169.254.169.254/latest', model: 'm' }))
      .rejects.toMatchObject({ code: 'bad_param' })
    await expect(svc.saveCustomProvider({ id: 'priv', label: 'R', baseUrl: 'https://10.0.0.5/v1', model: 'm' }))
      .rejects.toMatchObject({ code: 'bad_param' })
    process.env.NEXGRAPH_ALLOW_HTTP_PROVIDER = '1'
    try {
      await expect(svc.saveCustomProvider({ id: 'link2', label: 'L', baseUrl: 'http://169.254.169.254/latest', model: 'm' }))
        .rejects.toMatchObject({ code: 'bad_param' })
    } finally {
      delete process.env.NEXGRAPH_ALLOW_HTTP_PROVIDER
    }
    expect((await svc.listProviders()).filter((p) => p.custom)).toHaveLength(0)
  })

  it('không đăng ký lại provider tuỳ chỉnh không an toàn từ cấu hình cũ', async () => {
    writeFileSync(join(base, 'prefs.json'), JSON.stringify({
      aiCustomProviders: [{ id: 'old', label: 'Old', baseUrl: 'http://169.254.169.254/v1', model: 'm' }]
    }))
    const { svc } = await make()
    expect((await svc.listProviders()).find((p) => p.id === 'old')).toBeUndefined()
  })

  it('di trú cấu hình cũ một lần, không nhân đôi khi chạy lại', async () => {
    writeFileSync(join(base, 'prefs.json'), JSON.stringify({ aiBaseUrl: 'https://old.example/v1', aiModel: 'm-cũ', aiConsent: ['p1|old.example'] }))
    writeFileSync(join(base, 'ai-key.json'), JSON.stringify({ key: box.encrypt('sk-cũ') }))
    const { svc, prefs } = await make()
    const providers = await svc.listProviders()
    expect(providers.find((p) => p.id === 'custom-1')).toMatchObject({ custom: true, hasKey: true })
    expect(svc.getSelectedModel()).toEqual({ provider: 'custom-1', id: 'm-cũ' })
    await expect(svc.hasConsent('p1', (await svc.getConsentTarget())!)).resolves.toBe(false)
    const { svc: again } = await make()
    expect((await again.listProviders()).filter((p) => p.id === 'custom-1')).toHaveLength(1)
    expect(JSON.parse(readFileSync(prefs, 'utf8')).aiCustomProviders).toHaveLength(1)
  })

  it('removeApiKey xoá cả bản mã hoá', async () => {
    const { svc } = await make()
    await svc.setApiKey('anthropic', 'sk-remove')
    await svc.removeApiKey('anthropic')
    expect(JSON.parse(readFileSync(join(base, 'ai-key.json'), 'utf8')).anthropic).toBeUndefined()
    expect((await svc.listProviders()).find((p) => p.id === 'anthropic')?.hasKey).toBe(false)
  })

  it('selectModel chọn được; chọn model lạ → bad_param', async () => {
    const { svc, prefs } = await make()
    await svc.saveCustomProvider({ id: 'c1', label: 'C', baseUrl: 'https://a.example/v1', model: 'm1' })
    svc.selectModel('c1', 'm1')
    expect(svc.getSelectedModel()).toEqual({ provider: 'c1', id: 'm1' })
    expect(() => svc.selectModel('c1', 'm-không')).toThrow(expect.objectContaining({ code: 'bad_param' }))
    const target = (await svc.getConsentTarget())!
    expect(target).toMatchObject({ provider: 'c1', baseUrl: 'https://a.example/v1', accountId: expect.any(String) })
    await expect(svc.hasConsent('p1', target)).resolves.toBe(false)
    await svc.grantConsent('p1', target)
    await expect(svc.hasConsent('p1', target)).resolves.toBe(true)
    await expect(svc.hasConsent('p2', target)).resolves.toBe(false)
    expect(JSON.parse(readFileSync(prefs, 'utf8')).aiConsent).toEqual([JSON.stringify(['p1', 'c1', 'https://a.example/v1', target.accountId])])

    await svc.saveCustomProvider({ id: 'c2', label: 'C2', baseUrl: 'https://a.example/v1', model: 'm2' })
    svc.selectModel('c2', 'm2')
    await expect(svc.grantConsent('p1', target)).rejects.toMatchObject({ code: 'ai_provider_changed' })
    await expect(svc.hasConsent('p1', (await svc.getConsentTarget())!)).resolves.toBe(false)
    await svc.saveCustomProvider({ id: 'c1', label: 'C', baseUrl: 'https://a.example/v2', model: 'm1' })
    svc.selectModel('c1', 'm1')
    await expect(svc.hasConsent('p1', (await svc.getConsentTarget())!)).resolves.toBe(false)
  })

  it('loginOAuth mở URL nhà cung cấp và giữ token trong kho mã hoá qua khởi động lại', async () => {
    const { svc } = await make()
    fakeOauthProvider(svc, async (cb) => {
      cb.onAuth({ url: 'https://oauth.example/authorize' })
      await cb.onPrompt({ message: 'Dán mã', placeholder: 'code' })
      return { refresh: 'fake-secret-refresh', access: 'fake-secret-access', expires: Date.now() + 3_600_000 }
    })
    const p = await svc.listProviders().then((l) => l.find((x) => x.id === 'fakeoauth'))
    expect(p).toMatchObject({ oauth: true, loggedIn: false, hasKey: false })
    await svc.loginOAuth('fakeoauth')
    expect(opens).toContain('https://oauth.example/authorize')
    expect(existsSync(legacyAuth())).toBe(false)
    expect(vault().fakeoauth).toMatchObject({ type: 'oauth', access: 'fake-secret-access', refresh: 'fake-secret-refresh' })
    expect(scan('fake-secret-')).toEqual([])
    if (process.platform !== 'win32') expect(statSync(vaultFile()).mode & 0o777).toBe(0o600)
    expect((await svc.listProviders()).find((x) => x.id === 'fakeoauth')?.loggedIn).toBe(true)
    const { svc: reopened } = await make()
    fakeOauthProvider(reopened, async () => { throw new Error('không cần đăng nhập lại') })
    expect((await reopened.modelRuntime.getAuth('fakeoauth'))?.auth.apiKey).toBe('fake-secret-access')
  })

  it('loginOAuth huỷ bởi renderer → ai_cancelled, auth.json không để trạng thái dở', async () => {
    const ask = parkedAsk()
    const { svc } = await make({ ask: ask.ask })
    fakeOauthProvider(svc, (cb) =>
      new Promise((_resolve, reject) => {
        void cb.onPrompt({ message: 'Dán mã', placeholder: 'code' }).catch((e) => reject(e))
        cb.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }))
    const run = svc.loginOAuth('fakeoauth')
    await ask.asked
    ask.reply(null) // renderer trả lời null = huỷ
    await expect(run).rejects.toMatchObject({ code: 'ai_cancelled' })
    expect(existsSync(legacyAuth())).toBe(false)
    expect(vault()).toEqual({})
  })

  it('huỷ OAuth A không làm sống lại provider B đã đăng xuất trong lúc A chờ', async () => {
    const ask = parkedAsk()
    const { svc } = await make({ ask: ask.ask })
    fakeOauthProvider(svc, async () => ({ refresh: 'b', access: 'b', expires: Date.now() + 3_600_000 }), 'oauthb')
    await svc.loginOAuth('oauthb')
    expect(await svc.listProviders().then((l) => l.find((p) => p.id === 'oauthb')?.loggedIn)).toBe(true)
    fakeOauthProvider(svc, (cb) =>
      new Promise((_resolve, reject) => {
        void cb.onPrompt({ message: 'Dán mã' }).catch((e) => reject(e))
        cb.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }), 'oautha')
    const run = svc.loginOAuth('oautha')
    await ask.asked
    await svc.logout('oauthb') // B đăng xuất trong lúc A còn chờ
    ask.reply(null) // huỷ A
    await expect(run).rejects.toMatchObject({ code: 'ai_cancelled' })
    const stored = vault()
    expect(stored.oautha).toBeUndefined()
    expect(stored.oauthb).toBeUndefined()
    expect(await svc.listProviders().then((l) => l.find((p) => p.id === 'oauthb')?.loggedIn)).toBe(false)
  })

  it('loginOAuth thất bại → không để lại trạng thái dở', async () => {
    const { svc } = await make()
    fakeOauthProvider(svc, async () => { throw new Error('invalid_grant') })
    await expect(svc.loginOAuth('fakeoauth')).rejects.toMatchObject({ code: 'ai_error' })
    expect(existsSync(legacyAuth())).toBe(false)
    expect(vault()).toEqual({})
  })

  it('huỷ đăng nhập ChatGPT giữa chừng → ai_cancelled, không phải lỗi đăng nhập', async () => {
    let svc!: AccountService
    const made = await make({ notify: (raw) => {
      if ((raw as { type: string }).type === 'auth_url') svc.cancelLogin()
    } })
    svc = made.svc
    await expect(svc.loginOAuth('openai')).rejects.toMatchObject({ code: 'ai_cancelled' })
    expect(vault()).toEqual({})
  })

  it('API key đã lưu không che khuất đăng nhập ChatGPT, kể cả sau khởi động lại', async () => {
    const { svc } = await make()
    fakeOauthProvider(svc, async () => ({ refresh: 'r', access: 'a', expires: Date.now() + 3_600_000 }))
    await svc.setApiKey('fakeoauth', 'sk-shadowed-by-oauth')
    await svc.loginOAuth('fakeoauth')
    expect(svc.modelRuntime.isUsingOAuth('fakeoauth')).toBe(true)
    expect((await svc.modelRuntime.getAuth('fakeoauth'))?.source).toBe('OAuth')
    // Khởi động lại với cả credential OAuth của OpenAI lẫn API key OpenAI đã lưu trong ai-key.json.
    mkdirSync(join(base, 'agent'), { recursive: true })
    new SecretStore(vaultFile(), box).set('credentials', JSON.stringify({ openai: { type: 'oauth', access: 'openai-access',
      refresh: 'openai-refresh', expires: Date.now() + 3_600_000, clientId: 'oaiapp_saved', sub: 'openai-account' } }))
    new SecretStore(join(base, 'ai-key.json'), box).set('openai', 'sk-still-saved')
    const { svc: restarted } = await make()
    expect((await restarted.modelRuntime.getAuth('openai'))?.source).toBe('OAuth')
  })

  it('di trú auth.json, xóa bản rõ sau khi kiểm tra bản mã; logout không khôi phục token', async () => {
    mkdirSync(join(base, 'agent'))
    writeFileSync(legacyAuth(), JSON.stringify({ fakeoauth: { type: 'oauth', access: 'legacy-fake-access', refresh: 'legacy-fake-refresh', expires: Date.now() + 3_600_000 } }))
    const { svc } = await make()
    fakeOauthProvider(svc, async () => { throw new Error('boom') })
    expect(vault().fakeoauth).toMatchObject({ access: 'legacy-fake-access' })
    expect(existsSync(legacyAuth())).toBe(false)
    expect(scan('legacy-fake-')).toEqual([])
    await expect(svc.loginOAuth('fakeoauth')).rejects.toBeInstanceOf(Error)
    expect(vault().fakeoauth).toMatchObject({ access: 'legacy-fake-access' })
    await svc.logout('fakeoauth')
    await make()
    expect(vault()).toEqual({})
  })

  it('kho khoá vắng: không đọc token cũ vào Pi, không mở trình duyệt và di trú được khi kho hoạt động lại', async () => {
    mkdirSync(join(base, 'agent'))
    const legacy = JSON.stringify({ fakeoauth: { type: 'oauth', access: 'legacy-fake-access', refresh: 'legacy-fake-refresh', expires: Date.now() + 3_600_000 } })
    writeFileSync(legacyAuth(), legacy)
    const { svc } = await make({ secretBox: { ...box, available: () => false } })
    const login = vi.fn(async () => { throw new Error('không nên gọi provider') })
    fakeOauthProvider(svc, login)
    expect(await svc.modelRuntime.getAuth('fakeoauth')).toBeUndefined()
    expect((await svc.listProviders()).find((p) => p.id === 'fakeoauth')).toMatchObject({ loggedIn: false, oauthStorageIssue: expect.stringContaining('không khả dụng') })
    await expect(svc.loginOAuth('fakeoauth')).rejects.toMatchObject({ code: 'no_keychain' })
    expect(login).not.toHaveBeenCalled()
    expect(existsSync(vaultFile())).toBe(false)
    expect(readFileSync(legacyAuth(), 'utf8')).toBe(legacy)
    await make()
    expect(existsSync(legacyAuth())).toBe(false)
    expect(vault().fakeoauth).toMatchObject({ access: 'legacy-fake-access' })
  })

  it('refresh OAuth lưu token đã xoay vòng trong kho mã hoá', async () => {
    const { svc } = await make()
    const refresh = vi.fn(async () => ({ refresh: 'rotated-only-refresh', access: 'rotated-only-access', expires: Date.now() + 86_400_000 }))
    fakeOauthProvider(svc, async () => ({ refresh: 'initial-only-refresh', access: 'initial-only-access', expires: Date.now() + 3_600_000 }), 'fakeoauth', refresh)
    await svc.loginOAuth('fakeoauth')
    await svc.modelRuntime.getAuth('fakeoauth', { minOAuthValidityMs: 7_200_000 })
    expect(refresh).toHaveBeenCalledOnce()
    expect(vault().fakeoauth).toMatchObject({ refresh: 'rotated-only-refresh', access: 'rotated-only-access' })
    expect(scan('rotated-only-')).toEqual([])
  })

  it('logout đăng xuất; test() không có chọn model → ok false', async () => {
    const { svc } = await make()
    await expect(svc.test()).resolves.toMatchObject({ ok: false })
    fakeOauthProvider(svc, async () => ({ refresh: 'r', access: 'a', expires: Date.now() + 3_600_000 }))
    await svc.loginOAuth('fakeoauth')
    await svc.logout('fakeoauth')
    expect((await svc.listProviders()).find((x) => x.id === 'fakeoauth')?.loggedIn).toBe(false)
  })

  it('đổi origin custom không mang key cũ sang máy chủ mới; cùng origin vẫn giữ key', async () => {
    const { svc } = await make()
    const p = { id: 'local', label: 'Local', baseUrl: 'https://old.example/v1', model: 'm' }
    await svc.saveCustomProvider(p, 'sk-old-origin-only')
    await svc.saveCustomProvider({ ...p, baseUrl: 'https://old.example/v2' })
    expect(svc.hasKey('local')).toBe(true)
    await svc.saveCustomProvider({ ...p, baseUrl: 'https://new.example/v1' })
    expect(svc.hasKey('local')).toBe(false)
  })

  it('ID custom không thay thế provider có sẵn và dùng nhầm key của provider đó', async () => {
    const { svc } = await make()
    await svc.setApiKey('openai', 'sk-openai-only')
    await expect(svc.saveCustomProvider({
      id: 'openai', label: 'Endpoint khác', baseUrl: 'https://other.example/v1', model: 'm'
    })).rejects.toMatchObject({ code: 'bad_param' })
    expect((await svc.listProviders()).find((p) => p.id === 'openai')).toMatchObject({ custom: false, hasKey: true })
  })

  it('ChatGPT nhận UUID cài đặt ổn định qua lần đăng nhập và khởi động lại', async () => {
    const { svc } = await make()
    const login = vi.spyOn(svc.modelRuntime, 'login').mockResolvedValue({ type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() + 3600000 })
    await svc.loginOAuth('openai')
    const options = login.mock.calls[0][3]!
    expect(options.agentName).toBe('NexGraph')
    const installation = options.getDeviceId!()
    expect(installation).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
    const { svc: restarted } = await make()
    const later = vi.spyOn(restarted.modelRuntime, 'login').mockResolvedValue({ type: 'oauth', access: 'b', refresh: 'r2', expires: Date.now() + 3600000 })
    await restarted.loginOAuth('openai')
    expect(later.mock.calls[0][3]!.getDeviceId!()).toBe(installation)
  })

  it('runtime OpenAI dùng adapter phục hồi đăng ký mới và giữ key đang hoạt động khi đăng nhập thất bại', async () => {
    const realFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === 'https://auth.openai.com/api/accounts/oauth/token')
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      throw new Error('Test chỉ cho gọi endpoint đổi mã giả lập')
    })
    const authorizations: URLSearchParams[] = []
    const callbacks: Promise<unknown>[] = []
    const { svc } = await make({ notify: (raw) => {
      const event = raw as { type: string; url?: string }
      if (event.type !== 'auth_url' || !event.url) return
      const authorization = new URL(event.url).searchParams
      authorizations.push(authorization)
      const callback = new URL(authorization.get('redirect_uri')!)
      callback.searchParams.set('code', 'test-code')
      callback.searchParams.set('state', authorization.get('state')!)
      if (authorization.get('client_id') === 'dynamic_agent_client')
        callback.searchParams.set('client_id', 'oaiapp_test_registration')
      callbacks.push(realFetch(callback).then((response) => response.text()))
    } })
    await svc.setApiKey('openai', 'test-existing-key')
    await expect(svc.loginOAuth('openai')).rejects.toMatchObject({ code: 'ai_error' })
    await Promise.all(callbacks)
    expect(authorizations).toHaveLength(2)
    expect(authorizations[0].get('client_id')).toBe('dynamic_agent_client')
    expect(authorizations[1].get('client_id')).toBe('oaiapp_test_registration')
    expect(svc.hasKey('openai')).toBe(true)
  })

  it('đổi API key cùng endpoint làm consent cũ hết hiệu lực, accountId ổn định sau restart', async () => {
    const { svc } = await make()
    await svc.saveCustomProvider({ id: 'account-test', label: 'Account', baseUrl: 'https://example.com/v1', model: 'm' }, 'first-key-123456')
    svc.selectModel('account-test', 'm')
    const before = (await svc.getConsentTarget())!
    const identity = svc.sessionIdentity()
    await svc.grantConsent('project', before)
    await svc.setApiKey('account-test', 'second-key-123456')
    const after = (await svc.getConsentTarget())!
    expect(after.accountId).not.toBe(before.accountId)
    expect(svc.sessionIdentity()).not.toBe(identity)
    expect(scan('first-key-123456')).toEqual([])
    expect(scan('second-key-123456')).toEqual([])
    await expect(svc.hasConsent('project', before)).rejects.toMatchObject({ code: 'ai_provider_changed' })
    await expect(svc.hasConsent('project', after)).resolves.toBe(false)
    const { svc: restarted } = await make()
    expect((await restarted.getConsentTarget())!.accountId).toBe(after.accountId)
  })

  it('đăng xuất ChatGPT thu hồi phiên, giữ đăng ký mã hóa và không dùng id_token_hint sau khởi động lại', async () => {
    mkdirSync(join(base, 'agent'), { recursive: true })
    writeFileSync(legacyAuth(), JSON.stringify({ openai: { type: 'oauth', access: 'test-access', refresh: 'test-refresh',
      expires: Date.now() + 3600000, clientId: 'oaiapp_saved_registration', sub: 'test-subject', idToken: 'test-previous-id-token' } }))
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).endsWith('openid-configuration')
      ? Response.json({ revocation_endpoint: 'https://auth.openai.com/oauth/revoke' }) : new Response(null, { status: 200 }))
    const { svc } = await make()
    await expect(svc.forgetOpenAiRegistration()).rejects.toMatchObject({ code: 'bad_param' })
    await svc.logout('openai')
    expect((await svc.modelRuntime.listCredentials()).some((c) => c.providerId === 'openai')).toBe(false)
    expect(request).toHaveBeenCalledWith('https://auth.openai.com/oauth/revoke', expect.objectContaining({ method: 'POST', body: new URLSearchParams({ token: 'test-refresh', token_type_hint: 'refresh_token', client_id: 'oaiapp_saved_registration' }) }))
    expect(scan('test-subject')).toEqual([])
    expect(scan('test-previous-id-token')).toEqual([])
    const authorizations: URLSearchParams[] = []
    const { svc: restarted } = await make({ notify: (raw) => {
      const event = raw as { type: string; url?: string }
      if (event.type !== 'auth_url' || !event.url) return
      authorizations.push(new URL(event.url).searchParams)
      restarted.cancelLogin()
    } })
    await expect(restarted.loginOAuth('openai')).rejects.toThrow()
    expect(authorizations[0].get('client_id')).toBe('oaiapp_saved_registration')
    expect(authorizations[0].has('id_token_hint')).toBe(false)
    await restarted.forgetOpenAiRegistration()
    await expect(restarted.loginOAuth('openai')).rejects.toThrow()
    expect(authorizations[1].get('client_id')).toBe('dynamic_agent_client')
  })

  it('đăng xuất vẫn xóa token local và thông báo khi chưa xác nhận được thu hồi từ xa', async () => {
    mkdirSync(join(base, 'agent'), { recursive: true })
    writeFileSync(legacyAuth(), JSON.stringify({ openai: { type: 'oauth', access: 'test-access', refresh: 'test-refresh',
      expires: Date.now() + 3600000, clientId: 'oaiapp_saved_registration', sub: 'test-subject' } }))
    const notify = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}, { status: 503 }))
    const { svc } = await make({ notify })
    await svc.logout('openai')
    expect((await svc.modelRuntime.listCredentials()).some((c) => c.providerId === 'openai')).toBe(false)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'info', message: expect.stringContaining('Chưa xác nhận được thu hồi phiên từ xa') }))
  })

  it('không cho đăng nhập Anthropic OAuth qua chat NexGraph', async () => {
    const { svc } = await make()
    await expect(svc.loginOAuth('anthropic')).rejects.toMatchObject({ code: 'bad_param' })
    expect((await svc.listProviders()).find((p) => p.id === 'anthropic')?.oauth).toBe(false)
  })

  it('làm mới token OAuth giữ nguyên accountId và consent đã cấp', async () => {
    const { svc } = await make()
    fakeOauthProvider(svc, async () => ({ refresh: 'refresh-a', access: 'access-a', expires: Date.now() + 3600000 }),
      'fakeoauth', async () => ({ refresh: 'refresh-b', access: 'access-b', expires: Date.now() + 7200000 }))
    await svc.loginOAuth('fakeoauth')
    svc.selectModel('fakeoauth', 'm')
    const before = (await svc.getConsentTarget())!
    await svc.grantConsent('project', before)
    await svc.modelRuntime.getAuth('fakeoauth', { minOAuthValidityMs: 3700000 })
    expect(await svc.getConsentTarget()).toEqual(before)
    await expect(svc.hasConsent('project', before)).resolves.toBe(true)
  })

  it('Ollama local khám phá model, đọc context/công cụ, lưu và mở lại không cần cờ dev', async () => {
    const { svc } = await make()
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      return new Response(JSON.stringify(url.endsWith('/api/tags')
        ? { models: [{ name: 'coder:7b', size: 4200000000 }] }
        : { capabilities: ['completion', 'tools'], parameters: 'num_ctx 32768\n', model_info: { 'qwen3.context_length': 32768 } }))
    })
    expect(await svc.discoverLocal()).toEqual([{ id: 'coder:7b', label: 'coder:7b', sizeBytes: 4200000000 }])
    await svc.connectLocal('http://127.0.0.1:11434/v1', 'coder:7b')
    expect(svc.getSelectedModel()).toEqual({ provider: 'ollama-local', id: 'coder:7b' })
    expect((await svc.listModels()).find((m) => m.provider === 'ollama-local')).toMatchObject({
      contextWindow: 32768, maxTokens: 8192, supportsTools: true, pricing: 'local', cost: { input: null, output: null }
    })
    expect(request).toHaveBeenCalledWith('http://127.0.0.1:11434/api/show', expect.objectContaining({ method: 'POST', redirect: 'error' }))
    const { svc: restarted } = await make()
    expect((await restarted.listProviders()).find((p) => p.id === 'ollama-local')).toMatchObject({ kind: 'local', authMethods: ['none'] })
    expect(restarted.selectedModelPricing()).toBe('local')
  })

  it('Ollama chỉ chấp nhận loopback, không dò IP riêng/public hoặc URL chứa credential', async () => {
    const { svc } = await make()
    const request = vi.spyOn(globalThis, 'fetch')
    for (const url of ['http://10.0.0.2:11434/v1', 'http://169.254.169.254/v1', 'https://example.com/v1', 'http://u:p@localhost:11434/v1']) {
      await expect(svc.discoverLocal(url)).rejects.toMatchObject({ code: 'bad_param' })
    }
    expect(request).not.toHaveBeenCalled()
  })

  it('custom provider giữ metadata chưa biết, không hiển thị giá 0 hoặc context giả', async () => {
    const { svc } = await make()
    await svc.saveCustomProvider({ id: 'unknown', label: 'Unknown', baseUrl: 'https://example.com/v1', model: 'm' })
    svc.selectModel('unknown', 'm')
    expect((await svc.listModels()).find((m) => m.provider === 'unknown')).toEqual({
      provider: 'unknown', id: 'm', label: 'm', pricing: 'unknown', supportsImages: false, cost: { input: null, output: null }
    })
    expect(svc.selectedModelPricing()).toBe('unknown')
  })

  it('reports image support from the Pi model input capabilities', async () => {
    const { svc } = await make()
    await svc.saveCustomProvider({ id: 'image-check', label: 'Image check', baseUrl: 'https://example.com/v1', model: 'm' })
    const model = svc.modelRuntime.getModel('image-check', 'm') as { id: string; input: string[] }
    expect((await svc.listModels()).find((item) => item.provider === 'image-check')?.supportsImages).toBe(false)
    model.input.push('image')
    expect((await svc.listModels()).find((item) => item.provider === 'image-check')?.supportsImages).toBe(true)
  })

  it('kiểm tra kết nối xác minh cả stream lẫn tool call có marker đúng', async () => {
    const { svc } = await make()
    await svc.saveCustomProvider({ id: 'probe', label: 'Probe', baseUrl: 'https://example.com/v1', model: 'm' })
    svc.selectModel('probe', 'm')
    const stream = vi.spyOn(svc.modelRuntime, 'streamSimple').mockImplementation((_model, context) => {
      const text = context.messages[0].content
      const marker = typeof text === 'string' ? /"([^"]+)"/.exec(text)?.[1] : ''
      return {
        async *[Symbol.asyncIterator]() { yield { type: 'toolcall_delta' } },
        result: async () => ({ stopReason: 'toolUse', content: [{
          type: 'toolCall', name: 'nexgraph_connection_check', arguments: { value: marker }, id: 'probe'
        }] })
      } as unknown as ReturnType<typeof svc.modelRuntime.streamSimple>
    })
    await expect(svc.test()).resolves.toMatchObject({ ok: true, capabilities: { streaming: true, tools: true } })
    expect(stream).toHaveBeenCalledOnce()
    expect(stream.mock.calls[0][1].tools?.[0].name).toBe('nexgraph_connection_check')
  })

  it('Ollama chưa cấu hình context dùng giới hạn bảo thủ 4K và báo model chưa hỗ trợ công cụ', async () => {
    const { svc } = await make()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => new Response(JSON.stringify(String(input).endsWith('/api/tags')
      ? { models: [{ name: 'small' }] }
      : { capabilities: ['completion'], model_info: { 'llama.context_length': 131072 } })))
    await svc.connectLocal('http://localhost:11434', 'small')
    expect((await svc.listModels()).find((m) => m.provider === 'ollama-local')).toMatchObject({
      contextWindow: 4096, maxTokens: 1024, supportsTools: false
    })
  })
})
