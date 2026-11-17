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
    expect(list.find((p) => p.id === 'anthropic')).toMatchObject({ hasKey: true, oauth: true, custom: false })
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
    expect(target).toEqual({ provider: 'c1', baseUrl: 'https://a.example/v1' })
    await expect(svc.hasConsent('p1', target)).resolves.toBe(false)
    await svc.grantConsent('p1', target)
    await expect(svc.hasConsent('p1', target)).resolves.toBe(true)
    await expect(svc.hasConsent('p2', target)).resolves.toBe(false)
    expect(JSON.parse(readFileSync(prefs, 'utf8')).aiConsent).toEqual([JSON.stringify(['p1', 'c1', 'https://a.example/v1'])])

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
})
