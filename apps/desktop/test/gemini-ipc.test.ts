import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GeminiCliStatus, GeminiConnectionTest } from '../src/shared/gemini-types'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  userData: '', dataDir: '', root: '', cid: 'account-a', model: 'auto', authenticated: true,
  piProvider: 'google', piModel: 'api-model',
  status: vi.fn<() => Promise<GeminiCliStatus>>(),
  googleModels: vi.fn(), piModels: vi.fn(), googleTest: vi.fn<() => Promise<GeminiConnectionTest>>(), piTest: vi.fn(),
  googleSelect: vi.fn(), googleDisconnect: vi.fn(), googleForget: vi.fn(), googleLogin: vi.fn(),
  googlePrompt: vi.fn(), piPrompt: vi.fn(), googleFork: vi.fn(), piFork: vi.fn(), googleChanged: vi.fn(), piChanged: vi.fn(),
  piSelect: vi.fn(), setApiKey: vi.fn(), cancelLogin: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.userData, isPackaged: false },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => h.handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => ({}) },
  dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../src/main/engine/api', async (original) => {
  const actual = await original<typeof import('../src/main/engine/api')>()
  return { ...actual, EngineApi: class { listProjects() { return [{ project_id: 'p1', path: h.root }] } } }
})
vi.mock('../src/main/mcp-http', () => ({ McpHttpManager: class {} }))
vi.mock('../src/main/agent/accounts', () => ({ AccountService: {
  create: async () => ({
    getConsentTarget: async () => ({ provider: h.piProvider, baseUrl: 'https://api.example.com/v1' }),
    getSelectedModel: () => ({ provider: h.piProvider, id: h.piModel }), hasKey: () => true,
    listModels: (...args: unknown[]) => h.piModels(...args), test: (...args: unknown[]) => h.piTest(...args),
    selectModel: (...args: unknown[]) => h.piSelect(...args), setApiKey: (...args: unknown[]) => h.setApiKey(...args)
  })
} }))
vi.mock('../src/main/agent/session', () => ({
  AgentError: class extends Error { constructor(public code: string, message: string) { super(message) } },
  AgentService: class {
    selectionChanged() { h.piChanged() }
    prompt(...args: unknown[]) { return h.piPrompt(...args) }
    forkSession(...args: unknown[]) { return h.piFork(...args) }
    snapshot() { return { runtime: 'pi' } }
  }
}))
vi.mock('../src/main/gemini/connection', () => ({ GeminiConnectionManager: class {
  status() { return h.status() }
  connectionIdentity() { return h.cid }
  selectedModel() { return h.model }
  models() { return h.googleModels() }
  selectModel(id: string) { return h.googleSelect(id) }
  disconnect() { return h.googleDisconnect() }
  forget() { return h.googleForget() }
  login() { return h.googleLogin() }
  cancelLogin() { h.cancelLogin() }
} }))
vi.mock('../src/main/gemini/service', () => ({ GeminiAgentService: class {
  selectionChanged() { h.googleChanged() }
  testConnection() { return h.googleTest() }
  prompt(...args: unknown[]) { return h.googlePrompt(...args) }
  forkSession(...args: unknown[]) { return h.googleFork(...args) }
  snapshot() { return { runtime: 'antigravity-cli' } }
} }))

import { registerIpc } from '../src/main/ipc'

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
const trustedFrame = {}
const trustedEvent = { sender: { mainFrame: trustedFrame }, senderFrame: trustedFrame }
const invoke = <T = unknown,>(channel: string, ...args: unknown[]) => h.handlers.get(channel)!(trustedEvent, ...args) as Promise<Result<T>>
const prefs = () => JSON.parse(readFileSync(join(h.userData, 'prefs.json'), 'utf8')) as Record<string, unknown>
const pending = <T,>() => {
  let resolve!: (result: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const currentStatus = (): GeminiCliStatus => ({
  state: 'connected', installed: true, platformSupported: true, authenticated: h.authenticated,
  connectionId: h.cid, model: h.model, version: '1.5.11'
})
const ready = async () => {
  expect(await invoke('gemini:test')).toMatchObject({ ok: true, data: { ok: true } })
  expect(await invoke('gemini:activate')).toMatchObject({ ok: true })
}

beforeEach(() => {
  vi.resetAllMocks()
  const base = mkdtempSync(join(tmpdir(), 'ng-gemini-ipc-'))
  h.dataDir = base
  h.userData = join(base, 'user'); h.root = join(base, 'source')
  mkdirSync(h.userData); mkdirSync(h.root)
  writeFileSync(join(h.userData, 'prefs.json'), JSON.stringify({ aiRuntime: 'pi', aiGeminiEnabled: '0' }))
  h.cid = 'account-a'; h.model = 'auto'; h.authenticated = true; h.piProvider = 'google'; h.piModel = 'api-model'
  h.status.mockImplementation(async () => currentStatus())
  h.googleModels.mockResolvedValue([{ runtime: 'antigravity-cli', provider: 'google-antigravity', id: 'auto', label: 'Auto' }])
  h.piModels.mockResolvedValue([{ provider: 'google', id: 'api-model', label: 'Google API key' }])
  h.googleTest.mockResolvedValue({ ok: true, message: 'Gemini ready', capabilities: { streaming: true, tools: true } })
  h.piTest.mockResolvedValue({ ok: true, message: 'Pi ready' })
  h.googleSelect.mockImplementation(async (id: string) => { h.model = id })
  h.piSelect.mockImplementation((provider: string, id: string) => { h.piProvider = provider; h.piModel = id })
  h.googlePrompt.mockResolvedValue(undefined); h.piPrompt.mockResolvedValue(undefined)
  h.handlers.clear()
  registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => null, () => ({ command: 'engine', args: [] }), base)
})

describe('agent attachments and fork IPC', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aX0AAAAASUVORK5CYII='
  const target = { provider: 'google', baseUrl: 'https://api.example.com/v1' }

  it('rejects malformed, oversized and mismatched image payloads before dispatch', async () => {
    for (const images of [
      'not-an-array',
      [{ mimeType: 'image/svg+xml', data: png }],
      [{ mimeType: 'image/jpeg', data: png }],
      [{ mimeType: 'image/png', data: 'data:image/png;base64,' + png }],
      [{ mimeType: 'image/png', data: 'AAAA===' }],
      [{ mimeType: 'image/png', data: Buffer.from('not a real image').toString('base64') }],
      [{ mimeType: 'image/png', data: 'A'.repeat(32 * 1024 * 1024 + 4) }]
    ]) {
      const result = await invoke('agent:prompt', 'p1', 'hello', target, { images })
      expect(result).toMatchObject({ ok: false, error: { code: 'bad_param' } })
    }
    expect(h.piPrompt).not.toHaveBeenCalled()
  })

  it('passes a validated base64 image through and routes forks to the selected runtime', async () => {
    expect(await invoke('agent:prompt', 'p1', 'hello', target, { images: [{ mimeType: 'image/png', data: png }] })).toMatchObject({ ok: true })
    expect(h.piPrompt).toHaveBeenCalledWith('p1', 'hello', target, { images: [{ mimeType: 'image/png', data: png }] }, expect.any(Function))
    h.piFork.mockResolvedValueOnce({ session: { id: 'fork' } })
    expect(await invoke('agent:fork-session', 'p1', 'source')).toMatchObject({ ok: true, data: { session: { id: 'fork' } } })
    expect(h.piFork).toHaveBeenCalledWith('p1', 'source')
    await ready()
    h.googleFork.mockResolvedValueOnce({ session: { id: 'google-fork' } })
    expect(await invoke('agent:fork-session', 'p1', 'source')).toMatchObject({ ok: true, data: { session: { id: 'google-fork' } } })
    expect(h.googleFork).toHaveBeenCalledWith('p1', 'source')
  })
})

describe('Gemini IPC runtime selection', () => {
  it.each(['antigravity-cli', 'gemini-cli'])('khởi động lại runtime đã lưu %s vẫn bắt buộc kiểm tra và không chuyển sang API', async (savedRuntime) => {
    writeFileSync(join(h.userData, 'prefs.json'), JSON.stringify({ aiRuntime: savedRuntime, aiGeminiEnabled: '1' }))
    registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => null, () => ({ command: 'engine', args: [] }), h.dataDir)
    expect(prefs()).toMatchObject({ aiRuntime: 'antigravity-cli', aiGeminiEnabled: '0' })
    expect(await invoke('ai:get-settings')).toMatchObject({ ok: true, data: { runtime: 'antigravity-cli', model: '', connectionId: 'account-a' } })
    expect(await invoke('gemini:activate')).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    expect(await invoke('auth:select-model', 'google-antigravity', 'auto')).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    expect(h.piSelect).not.toHaveBeenCalled()
    await ready()
    expect(prefs()).toMatchObject({ aiRuntime: 'antigravity-cli', aiGeminiEnabled: '1' })
  })

  it('chỉ kích hoạt Google sau kiểm tra cả streaming và công cụ; giữ settings CLI không có endpoint giả', async () => {
    expect(await invoke('gemini:activate')).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    h.googleTest.mockResolvedValueOnce({ ok: true, message: 'text only', capabilities: { streaming: true, tools: false } })
    await invoke('gemini:test')
    expect(await invoke('gemini:activate')).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    await ready()
    expect(prefs()).toMatchObject({ aiRuntime: 'antigravity-cli', aiGeminiEnabled: '1' })
    expect(await invoke('ai:get-settings')).toMatchObject({ ok: true, data: { runtime: 'antigravity-cli', provider: 'google-antigravity', baseUrl: '', model: 'auto', connectionId: 'account-a' } })
    await invoke('auth:test')
    expect(h.piTest).not.toHaveBeenCalled()
    expect(h.googleTest).toHaveBeenCalledTimes(3)
    expect(await invoke('agent:snapshot', 'p1')).toMatchObject({ ok: true, data: { runtime: 'antigravity-cli' } })
  })

  it('ngắt Gemini giữ runtime Google chưa cấu hình, không chuyển sang Pi/API key đã lưu', async () => {
    await ready()
    await invoke('gemini:disconnect')
    expect(h.googleDisconnect).toHaveBeenCalledOnce()
    expect(prefs()).toMatchObject({ aiRuntime: 'antigravity-cli', aiGeminiEnabled: '0' })
    expect(await invoke('ai:get-settings')).toMatchObject({ ok: true, data: { runtime: 'antigravity-cli', model: '' } })
    expect(await invoke('gemini:activate')).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    expect(await invoke('auth:select-model', 'google-antigravity', 'auto')).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    await invoke('agent:prompt', 'p1', 'hello', { runtime: 'antigravity-cli', provider: 'google-antigravity', connectionId: h.cid })
    expect(h.googlePrompt).toHaveBeenCalledOnce()
    expect(h.piPrompt).not.toHaveBeenCalled()
    expect(h.piSelect).not.toHaveBeenCalled()
  })

  it('đăng nhập lại dừng Google đang hoạt động đến khi kiểm tra và kích hoạt lại', async () => {
    await ready()
    await invoke('gemini:login')
    expect(h.googleLogin).toHaveBeenCalledOnce()
    expect(prefs()).toMatchObject({ aiRuntime: 'antigravity-cli', aiGeminiEnabled: '0' })
    expect(await invoke('ai:get-settings')).toMatchObject({ ok: true, data: { runtime: 'antigravity-cli', model: '' } })
    expect(await invoke('gemini:activate')).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    expect(h.piSelect).not.toHaveBeenCalled()
    await ready()
    expect(prefs().aiGeminiEnabled).toBe('1')
  })

  it('chỉ chọn API key hoặc Ollama rõ ràng mới đổi sang runtime Pi', async () => {
    await ready()
    await invoke('auth:set-key', 'google', 'separate-api-key')
    expect(prefs().aiRuntime).toBe('antigravity-cli')
    expect(await invoke('auth:select-model', 'google', 'api-model')).toMatchObject({ ok: true })
    expect(prefs().aiRuntime).toBe('pi')
    expect(prefs().aiGeminiEnabled).toBe('0')
    await invoke('auth:test')
    expect(h.piTest).toHaveBeenCalledOnce()
    expect(h.googleForget).not.toHaveBeenCalled()
  })

  it.each(['model', 'connection'] as const)('kết quả kiểm tra không dùng được nếu %s đổi trong lúc đang kiểm tra', async (part) => {
    const check = pending<GeminiConnectionTest>()
    h.googleTest.mockImplementationOnce(() => check.promise)
    const testing = invoke('gemini:test')
    await vi.waitFor(() => expect(h.googleTest).toHaveBeenCalled())
    if (part === 'model') h.model = 'different-model'
    else h.cid = 'account-b'
    check.resolve({ ok: true, message: 'old result', capabilities: { streaming: true, tools: true } })
    await testing
    expect(await invoke('gemini:activate')).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    expect(prefs().aiRuntime).toBe('pi')
  })

  it('thay model từ luồng thiết lập làm mất kết quả kiểm tra trước đó', async () => {
    await invoke('gemini:test')
    await invoke('gemini:select-model', 'different-model')
    expect(await invoke('gemini:activate')).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
  })

  it('probe đang chờ không khôi phục quyền kích hoạt sau khi ngắt Google dù runtime trước đó là Pi', async () => {
    const checking = pending<GeminiConnectionTest>()
    h.googleTest.mockImplementationOnce(() => checking.promise)
    const testing = invoke('gemini:test')
    await vi.waitFor(() => expect(h.googleTest).toHaveBeenCalled())
    await invoke('gemini:disconnect')
    checking.resolve({ ok: true, message: 'old result', capabilities: { streaming: true, tools: true } })
    await testing
    expect(await invoke('gemini:activate')).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    expect(prefs().aiRuntime).toBe('pi')
  })

  it('kết quả probe cũ không ghi đè lần kiểm tra mới đã thành công', async () => {
    const first = pending<GeminiConnectionTest>()
    h.googleTest.mockImplementationOnce(() => first.promise)
    const old = invoke('gemini:test')
    await vi.waitFor(() => expect(h.googleTest).toHaveBeenCalled())
    await invoke('gemini:test')
    first.resolve({ ok: false, message: 'old failed check' })
    await old
    expect(await invoke('gemini:activate')).toMatchObject({ ok: true })
  })

  it('không kích hoạt tài khoản đổi trong khi đang xác nhận status lần cuối', async () => {
    await invoke('gemini:test')
    const reading = pending<GeminiCliStatus>()
    h.status.mockImplementationOnce(() => reading.promise)
    const activating = invoke('gemini:activate')
    await vi.waitFor(() => expect(h.status).toHaveBeenCalled())
    h.cid = 'account-b'
    reading.resolve(currentStatus())
    expect(await activating).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    expect(prefs().aiRuntime).toBe('pi')
  })

  it('đổi model không bật lại Gemini nếu người dùng ngắt phiên trong lúc chờ', async () => {
    await ready()
    const choosing = pending<void>()
    h.googleSelect.mockImplementationOnce(async (model: string) => { await choosing.promise; h.model = model })
    const selecting = invoke('auth:select-model', 'google-antigravity', 'different-model')
    await vi.waitFor(() => expect(h.googleSelect).toHaveBeenCalled())
    await invoke('gemini:disconnect')
    choosing.resolve()
    expect(await selecting).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })
    expect(prefs()).toMatchObject({ aiRuntime: 'antigravity-cli', aiGeminiEnabled: '0' })
  })
})

describe('Gemini/Pi model list isolation', () => {
  it('CLI lỗi không làm mất model API key', async () => {
    h.googleModels.mockRejectedValueOnce(new Error('CLI not ready'))
    expect(await invoke('auth:models')).toMatchObject({ ok: true, data: [{ provider: 'google', id: 'api-model' }] })
  })

  it('Pi lỗi không làm mất model tài khoản Google và không chọn runtime tự động', async () => {
    h.piModels.mockRejectedValueOnce(new Error('API provider unavailable'))
    expect(await invoke('auth:models')).toMatchObject({ ok: true, data: [{ runtime: 'antigravity-cli', provider: 'google-antigravity', id: 'auto' }] })
    expect(prefs().aiRuntime).toBe('pi')
  })
})

describe('Runtime agent IPC (review #66 Important 4)', () => {
  it('chỉ nhận nex|pi tại runtime, giá trị khác trả bad_param', async () => {
    expect(await invoke('ai:set-runtime', 'gemini-cli')).toMatchObject({ ok: false, error: { code: 'bad_param' } })
    expect(await invoke('ai:set-runtime', 'nex/../pi')).toMatchObject({ ok: false, error: { code: 'bad_param' } })
    expect(prefs().aiRuntime).toBe('pi')
  })

  it('từ chối khung không phải cửa sổ NexGraph (onTrusted)', async () => {
    const handler = h.handlers.get('ai:set-runtime')!
    expect(await handler({}, 'pi')).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } })
    const getter = h.handlers.get('ai:get-runtime')!
    expect(await getter({})).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } })
  })
})
