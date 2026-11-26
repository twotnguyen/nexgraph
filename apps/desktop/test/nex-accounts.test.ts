import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NexAccountManager, checkNexAuthUrl, deviceCodeFromInstructions, withAppKeys, withCustomProviders } from '../src/main/agent/nex/accounts'
import type { NexAccountsView } from '../src/shared/agent-types'

const SECRET = 'sk-live-should-never-leave-main'

const integration = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name,
  methods: [{ type: 'key' }, { type: 'env', names: ['OPENAI_API_KEY'] }, { id: 'chatgpt-token-sharing', type: 'oauth', label: 'Sign in with ChatGPT' }],
  connections: [],
  ...over
})

const waiters: Server[] = []
afterEach(async () => {
  await Promise.all(waiters.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function fakeSidecar(input: {
  integrations?: unknown[]
  models?: unknown[]
  fail?: boolean
  routes?: Record<string, (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void>
}): Promise<{ baseUrl: string; requests: string[] }> {
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
    if (input.routes?.[`${req.method} ${req.url}`]) {
      input.routes[`${req.method} ${req.url}`](req, res)
      return
    }
    if (input.fail) { res.statusCode = 500; res.end(JSON.stringify({ error: 'boom' })); return }
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/integration') {
      res.end(JSON.stringify({ data: input.integrations ?? [] }))
      return
    }
    if (req.url === '/api/model') {
      res.end(JSON.stringify({ data: input.models ?? [] }))
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  waiters.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { baseUrl: `http://127.0.0.1:${port}`, requests }
}

async function managerFor(input: Parameters<typeof fakeSidecar>[0]): Promise<{
  manager: NexAccountManager; prefsFile: string; requests: string[]; opened: string[]; logs: string[]
}> {
  const { baseUrl, requests } = await fakeSidecar(input)
  const dir = mkdtempSync(join(tmpdir(), 'n2a2-accounts-'))
  const prefsFile = join(dir, 'prefs.json')
  writeFileSync(prefsFile, '{}')
  const opened: string[] = []
  const logs: string[] = []
  const manager = new NexAccountManager({
    connect: async () => ({ baseUrl, password: 'test' }),
    openExternal: (url) => { opened.push(url) },
    prefsFile,
    log: (line) => { logs.push(line) }
  })
  return { manager, prefsFile, requests, opened, logs }
}

describe('NexAccountManager.list', () => {
  it('liệt kê đúng nhà cung cấp Nex, trạng thái kết nối, phương thức và model; không lộ key trong phản hồi /api/model', async () => {
    const { manager } = await managerFor({
      integrations: [
        integration('openai', 'OpenAI', {
          connections: [
            { type: 'credential', id: 'cred_1', label: 'ChatGPT', method: 'oauth' },
            { type: 'env', name: 'OPENAI_API_KEY' }
          ]
        }),
        integration('anthropic', 'Anthropic', { methods: [{ type: 'key' }, { type: 'env', names: ['ANTHROPIC_API_KEY'] }] }),
        integration('github-copilot', 'GitHub Copilot', {
          methods: [{ type: 'env', names: ['COPILOT_GITHUB_TOKEN'] }, { id: 'device', type: 'oauth', label: 'Login with GitHub Copilot', form: [{ key: 'deploymentType', title: 'Deployment', required: true, type: 'string', options: [{ value: 'github.com', label: 'GitHub.com' }] }] }],
          connections: [{ type: 'credential', id: 'cred_2', label: 'octocat', method: 'oauth', status: { status: 'needs_auth', message: 'Phiên đã hết hạn' } }]
        }),
        integration('some-unrelated', 'Unrelated')
      ],
      models: [
        { providerID: 'openai', id: 'gpt-x', name: 'GPT X', settings: { apiKey: SECRET } },
        { providerID: 'anthropic', id: 'claude-y', settings: { apiKey: SECRET } },
        { providerID: 'some-unrelated', id: 'nope' }
      ]
    })
    const view = await manager.list()
    expect(view.available).toBe(true)
    expect(view.providers.map((p) => p.id)).toEqual(['openai', 'anthropic', 'github-copilot'])
    const openai = view.providers[0]
    expect(openai.connected).toBe(true)
    expect(openai.methods.map((m) => m.type)).toEqual(['key', 'oauth'])
    expect(openai.models).toEqual([{ id: 'gpt-x', label: 'GPT X' }])
    const copilot = view.providers[2]
    expect(copilot.methods.find((m) => m.type === 'oauth')?.form?.[0].key).toBe('deploymentType')
    expect(copilot.connections[0].problem).toEqual({ message: 'Phiên đã hết hạn' })
    expect(JSON.stringify(view)).not.toContain(SECRET)
  })

  it('trả available=false kèm lý do khi sidecar lỗi hoặc máy không có runtime', async () => {
    const broken = await managerFor({ fail: true })
    expect(await broken.manager.list()).toMatchObject({ available: false, reason: 'sidecar_error', providers: [] })
    const noRuntime = new NexAccountManager({
      connect: async () => { throw Object.assign(new Error('missing'), { code: 'nex_not_available' }) },
      openExternal: () => {},
      prefsFile: join(mkdtempSync(join(tmpdir(), 'n2a2-accounts-')), 'prefs.json')
    })
    expect(await noRuntime.list()).toMatchObject({ available: false, reason: 'no_runtime' })
  })
})

describe('chọn model mặc định', () => {
  it('chỉ nhận model sidecar có và lưu vào prefs của app', async () => {
    const { manager, prefsFile } = await managerFor({
      integrations: [integration('openai', 'OpenAI')],
      models: [{ providerID: 'openai', id: 'gpt-x', name: 'GPT X' }]
    })
    await expect(manager.selectModel('openai', 'khong-co')).rejects.toMatchObject({ code: 'bad_param' })
    expect(manager.selected()).toBeNull()
    await manager.selectModel('openai', 'gpt-x')
    expect(manager.selected()).toEqual({ provider: 'openai', id: 'gpt-x' })
    const prefs = JSON.parse(readFileSync(prefsFile, 'utf8')) as Record<string, unknown>
    expect(prefs.nexSelectedModel).toEqual({ provider: 'openai', id: 'gpt-x' })
  })
})

describe('checkNexAuthUrl', () => {
  it('chỉ cho https + host trong danh sách (kể cả tên miền con), chặn http/userinfo/host giả', () => {
    expect(checkNexAuthUrl('https://auth.openai.com/api/accounts/authorize?x=1')).toMatchObject({ ok: true })
    expect(checkNexAuthUrl('https://console.opencode.ai/auth/device')).toMatchObject({ ok: true })
    expect(checkNexAuthUrl('https://github.com/login/device')).toMatchObject({ ok: true })
    expect(checkNexAuthUrl('http://auth.openai.com/x')).toEqual({ ok: false, reason: 'invalid_url' })
    expect(checkNexAuthUrl('https://user:pass@auth.openai.com/x')).toEqual({ ok: false, reason: 'invalid_url' })
    expect(checkNexAuthUrl('https://github.com.evil.example/x')).toEqual({ ok: false, reason: 'host_not_allowed' })
    expect(checkNexAuthUrl('not a url')).toEqual({ ok: false, reason: 'invalid_url' })
    expect(deviceCodeFromInstructions('Enter code: 520C-1E7F')).toBe('520C-1E7F')
    expect(deviceCodeFromInstructions(undefined)).toBeUndefined()
  })
})

describe('đăng nhập qua sidecar', () => {
  const json = (res: import('node:http').ServerResponse, body: unknown, status = 200): void => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }

  it('OAuth: mở đúng URL auth.openai.com sau khi kiểm và theo dõi trạng thái tới complete', async () => {
    const { manager, opened } = await managerFor({
      integrations: [integration('openai', 'OpenAI')],
      routes: {
        'POST /api/integration/openai/connect/oauth': (_req, res) => json(res, {
          data: { attemptID: 'con_1', url: 'https://auth.openai.com/api/accounts/authorize?client_id=x', instructions: 'Complete authorization in your browser.', mode: 'auto' }
        }),
        'GET /api/integration/openai/connect/oauth/con_1': (_req, res) => json(res, { data: { status: 'complete' } })
      }
    })
    const view = await manager.startAuth('openai', 'chatgpt-token-sharing')
    expect(view).toMatchObject({ kind: 'oauth', attemptId: 'con_1', opened: true, integrationId: 'openai' })
    expect(opened).toEqual(['https://auth.openai.com/api/accounts/authorize?client_id=x'])
    expect(await manager.authStatus('oauth', 'openai', 'con_1')).toEqual({ status: 'complete' })
  })

  it('device flow: hiện mã trong instructions và mở trang xác nhận', async () => {
    const { manager, opened } = await managerFor({
      integrations: [integration('github-copilot', 'GitHub Copilot', { methods: [{ id: 'device', type: 'oauth', label: 'Login with GitHub Copilot' }] })],
      routes: {
        'POST /api/integration/github-copilot/connect/oauth': (_req, res) => json(res, {
          data: { attemptID: 'con_dev', url: 'https://github.com/login/device', instructions: 'Enter code: 520C-1E7F', mode: 'auto' }
        })
      }
    })
    const view = await manager.startAuth('github-copilot', 'device', { deploymentType: 'github.com' })
    expect(view).toMatchObject({ kind: 'oauth', userCode: '520C-1E7F', opened: true })
    expect(opened).toEqual(['https://github.com/login/device'])
  })

  it('URL host lạ: không gọi openExternal, trả blockedReason', async () => {
    const { manager, opened } = await managerFor({
      integrations: [integration('openai', 'OpenAI')],
      routes: {
        'POST /api/integration/openai/connect/oauth': (_req, res) => json(res, {
          data: { attemptID: 'con_x', url: 'https://evil.example/oauth', instructions: 'Sign in' }
        })
      }
    })
    const view = await manager.startAuth('openai', 'chatgpt-token-sharing')
    expect(view.blockedReason).toBe('host_not_allowed')
    expect(view.opened).toBe(false)
    expect(opened).toEqual([])
  })

  it('API key không đi qua sidecar; Claude cần CLI trả hướng dẫn', async () => {
    const keyed = await managerFor({ integrations: [integration('anthropic', 'Anthropic', { methods: [{ type: 'key' }, { type: 'env', names: ['ANTHROPIC_API_KEY'] }] })] })
    const key = await keyed.manager.startAuth('anthropic', 'key')
    expect(key).toEqual({ kind: 'key', integrationId: 'anthropic' })
    expect(keyed.requests.filter((line) => line.startsWith('POST'))).toEqual([])

    const claude = await managerFor({
      integrations: [integration('claude-agent', 'Claude Agent', { methods: [{ id: 'claude-login', type: 'external', label: 'Claude Code login (claude auth login)' }] })],
      routes: { 'POST /api/integration/claude-agent/connect/external': (_req, res) => { res.statusCode = 204; res.end() } }
    })
    const external = await claude.manager.startAuth('claude-agent', 'claude-login')
    expect(external.kind).toBe('external')
    expect(external.instructions).toContain('claude auth login')
  })

  it('đăng xuất xoá mọi credential của integration và bỏ model đang chọn', async () => {
    const { manager, prefsFile, requests } = await managerFor({
      integrations: [integration('openai', 'OpenAI', {
        connections: [{ type: 'credential', id: 'cred_1', label: 'ChatGPT', method: 'oauth' }]
      })],
      routes: { 'DELETE /api/credential/cred_1': (_req, res) => { res.statusCode = 204; res.end() } }
    })
    writeFileSync(prefsFile, JSON.stringify({ nexSelectedModel: { provider: 'openai', id: 'gpt-x' } }))
    await manager.logout('openai')
    expect(requests).toContain('DELETE /api/credential/cred_1')
    expect(manager.selected()).toBeNull()
    expect(JSON.parse(readFileSync(prefsFile, 'utf8')).nexSelectedModel).toBeUndefined()
  })

  it('không log token/key trong phản hồi sidecar (kể cả khi lỗi)', async () => {
    const { manager, logs } = await managerFor({
      integrations: [integration('openai', 'OpenAI')],
      models: [{ providerID: 'openai', id: 'gpt-x', settings: { apiKey: SECRET } }]
    })
    await manager.list()
    expect(logs.join('\n')).not.toContain(SECRET)
    const broken = await managerFor({
      integrations: [integration('openai', 'OpenAI')],
      models: [{ providerID: 'openai', id: 'gpt-x', settings: { apiKey: SECRET } }],
      fail: true,
      routes: { 'GET /api/integration': (_req, res) => { res.statusCode = 500; res.end(JSON.stringify({ error: SECRET })) } }
    })
    await broken.manager.list()
    expect(broken.logs.join('\n')).not.toContain(SECRET)
  })
})

describe('withCustomProviders', () => {
  it('gộp nhà cung cấp OpenAI-compatible tuỳ chỉnh của app vào khối Nex', () => {
    const view: NexAccountsView = { available: true, providers: [], selected: null }
    const merged = withCustomProviders(view, [{
      id: 'qa', label: 'NexGraph QA', hasKey: true, models: [{ id: 'gpt-6-luna', label: 'gpt-6-luna' }]
    }])
    expect(merged.providers).toHaveLength(1)
    expect(merged.providers[0]).toMatchObject({ id: 'qa', name: 'NexGraph QA', connected: true, models: [{ id: 'gpt-6-luna', label: 'gpt-6-luna' }] })
    expect(merged.providers[0].methods.map((m) => m.id)).toEqual(['key'])
  })
})

// Review #72 vòng 1, finding 3: API key nhập trong khối Nex cho nhà cung cấp built-in nằm trong kho
// của app (không ở sidecar) — vẫn phải hiện "đã kết nối" để chọn được model.
describe('nhà cung cấp built-in có API key trong kho app', () => {
  const view = {
    available: true,
    providers: [
      { id: 'openai', name: 'OpenAI', connected: false, connections: [], methods: [{ id: 'key', type: 'key' as const, label: 'API key' }], models: [{ id: 'gpt-5', label: 'GPT-5' }] },
      { id: 'anthropic', name: 'Anthropic', connected: false, connections: [], methods: [], models: [] },
      { id: 'github', name: 'GitHub', connected: true, connections: [{ id: 'c1', label: 'oauth', method: 'oauth' }], methods: [], models: [] }
    ]
  }

  it('đánh dấu connected khi app dùng được key đó cho Nex; không đụng nhà cung cấp khác', () => {
    const out = withAppKeys(view as never, (id) => id === 'openai')
    expect(out.providers.find((p) => p.id === 'openai')).toMatchObject({ connected: true, connections: [{ id: 'openai', label: 'API key', method: 'key' }] })
    expect(out.providers.find((p) => p.id === 'anthropic')?.connected).toBe(false)
    expect(out.providers.find((p) => p.id === 'github')?.connections).toHaveLength(1)
  })
})
