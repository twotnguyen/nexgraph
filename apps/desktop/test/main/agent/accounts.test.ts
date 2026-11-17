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

const make = async (over: { notify?: (e: unknown) => void; ask?: (p: unknown) => Promise<string | null> } = {}) => {
  const prefs = join(base, 'prefs.json')
  const svc = await AccountService.create({
    dataDir: base, prefsFile: prefs,
    secrets: new SecretStore(join(base, 'ai-key.json'), box),
    openExternal: (url) => opens.push(url),
    notify: over.notify ?? (() => {}),
    ask: over.ask ?? (async () => 'answer')
  })
  return { svc, prefs }
}
const opens: string[] = []

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

type FakeOAuthLogin = NonNullable<Parameters<typeof AccountService.prototype.modelRuntime.registerProvider>[1]['oauth']>['login']

const fakeOauthProvider = (svc: AccountService, login: FakeOAuthLogin, id = 'fakeoauth'): void => {
  svc.modelRuntime.registerProvider(id, {
    name: id,
    api: 'openai-completions',
    baseUrl: 'https://oauth.example/v1',
    oauth: {
      name: `${id} subscription`,
      login,
      refreshToken: async (c) => c,
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
    expect(svc.hasConsent('p1')).toBe(true) // host giữ nguyên nên consent cũ còn hiệu lực
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
    expect(svc.hasConsent('p1')).toBe(false)
    svc.grantConsent('p1')
    expect(svc.hasConsent('p1')).toBe(true)
    expect(JSON.parse(readFileSync(prefs, 'utf8')).aiConsent).toEqual(['p1|a.example'])
  })

  it('loginOAuth gọi openExternal với URL của nhà cung cấp và lưu thông tin đăng nhập vào auth.json có quyền 0600', async () => {
    const { svc } = await make()
    fakeOauthProvider(svc, async (cb) => {
      cb.onAuth({ url: 'https://oauth.example/authorize' })
      await cb.onPrompt({ message: 'Dán mã', placeholder: 'code' })
      return { refresh: 'r', access: 'a', expires: Date.now() + 3_600_000 }
    })
    const p = await svc.listProviders().then((l) => l.find((x) => x.id === 'fakeoauth'))
    expect(p).toMatchObject({ oauth: true, loggedIn: false, hasKey: false })
    await svc.loginOAuth('fakeoauth')
    expect(opens).toContain('https://oauth.example/authorize')
    const authFile = join(base, 'agent', 'auth.json')
    expect(readFileSync(authFile, 'utf8')).toContain('fakeoauth')
    if (process.platform === 'win32') {
      // Windows không có bit mode POSIX: chỉ kiểm tệp tồn tại và chứa provider.
      expect(existsSync(authFile)).toBe(true)
    } else {
      expect(statSync(authFile).mode & 0o777).toBe(0o600)
    }
    expect((await svc.listProviders()).find((x) => x.id === 'fakeoauth')?.loggedIn).toBe(true)
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
    const auth = join(base, 'agent', 'auth.json')
    expect(existsSync(auth) ? readFileSync(auth, 'utf8') : '{}').toBe('{}')
  })

  it('huỷ OAuth A không làm sống lại provider B đã đăng xuất trong lúc A chờ', async () => {
    const ask = parkedAsk()
    const { svc } = await make({ ask: ask.ask })
    const authFile = join(base, 'agent', 'auth.json')
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
    const stored = JSON.parse(readFileSync(authFile, 'utf8')) as Record<string, unknown>
    expect(stored.oautha).toBeUndefined()
    expect(stored.oauthb).toBeUndefined()
    expect(await svc.listProviders().then((l) => l.find((p) => p.id === 'oauthb')?.loggedIn)).toBe(false)
  })

  it('loginOAuth thất bại → không để lại trạng thái dở', async () => {
    const { svc } = await make()
    const auth = join(base, 'agent', 'auth.json')
    fakeOauthProvider(svc, async () => { throw new Error('invalid_grant') })
    await expect(svc.loginOAuth('fakeoauth')).rejects.toMatchObject({ code: 'ai_error' })
    expect(existsSync(auth) ? readFileSync(auth, 'utf8') : '{}').toBe('{}')
  })

  it('loginOAuth đăng ký ghi auth.json dở trước đó → khôi phục nội dung cũ khi thất bại', async () => {
    mkdirSync(join(base, 'agent'))
    writeFileSync(join(base, 'agent', 'auth.json'), JSON.stringify({ 'x-other': { type: 'oauth' } }))
    const { svc } = await make()
    fakeOauthProvider(svc, async () => { throw new Error('boom') })
    await expect(svc.loginOAuth('fakeoauth')).rejects.toBeInstanceOf(Error)
    expect(JSON.parse(readFileSync(join(base, 'agent', 'auth.json'), 'utf8'))['x-other']).toBeTruthy()
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
