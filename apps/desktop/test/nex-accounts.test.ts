import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NexAccountManager, withCustomProviders } from '../src/main/agent/nex/accounts'
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
}): Promise<{ baseUrl: string; requests: string[] }> {
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
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

async function managerFor(input: Parameters<typeof fakeSidecar>[0]): Promise<{ manager: NexAccountManager; prefsFile: string; requests: string[] }> {
  const { baseUrl, requests } = await fakeSidecar(input)
  const dir = mkdtempSync(join(tmpdir(), 'n2a2-accounts-'))
  const prefsFile = join(dir, 'prefs.json')
  writeFileSync(prefsFile, '{}')
  const manager = new NexAccountManager({
    connect: async () => ({ baseUrl, password: 'test' }),
    openExternal: () => {},
    prefsFile
  })
  return { manager, prefsFile, requests }
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
