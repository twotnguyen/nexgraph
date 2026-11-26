import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  userData: '', dataDir: '',
  create: vi.fn(),
  sent: [] as { channel: string; payload: unknown }[]
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => h.handlers.set(channel, fn) },
  dialog: {}, shell: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../src/main/platform/engine/api', async (original) => {
  const actual = await original<typeof import('../src/main/platform/engine/api')>()
  return { ...actual, EngineApi: class { listProjects() { return [] } } }
})
vi.mock('../src/main/features/integrations/mcp-http', () => ({ McpHttpManager: class {} }))
vi.mock('../src/main/features/agent/accounts', () => ({ AccountService: { create: (...args: unknown[]) => h.create(...args) } }))
vi.mock('../src/main/features/agent/session', () => ({
  AgentError: class extends Error { constructor(public code: string, message: string) { super(message) } },
  AgentService: class { selectionChanged() {} prompt() {} forkSession() {} snapshot() { return { runtime: 'pi' } } }
}))
vi.mock('../src/main/features/agent/gemini/connection', () => ({ GeminiConnectionManager: class {
  status() { return { state: 'disconnected', installed: false, platformSupported: true, authenticated: false, connectionId: '', model: '', version: '' } }
  connectionIdentity() { return '' }
  selectedModel() { return '' }
} }))
vi.mock('../src/main/features/agent/gemini/service', () => ({ GeminiAgentService: class { selectionChanged() {} testConnection() {} prompt() {} forkSession() {} snapshot() { return { runtime: 'antigravity-cli' } } } }))

import { registerIpc } from '../src/main/ipc'

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
const invoke = <T = unknown,>(channel: string, ...args: unknown[]) => h.handlers.get(channel)!({}, ...args) as Promise<Result<T>>

beforeEach(() => {
  vi.resetAllMocks()
  h.sent.length = 0
  const base = mkdtempSync(join(tmpdir(), 'ng-auth-notice-'))
  h.dataDir = base
  h.userData = join(base, 'user')
  mkdirSync(h.userData)
  writeFileSync(join(h.userData, 'prefs.json'), JSON.stringify({ aiRuntime: 'pi' }))
  h.handlers.clear()
  h.create.mockResolvedValue({ listProviders: async () => [] })
  const window = { webContents: { send: (channel: string, payload: unknown) => h.sent.push({ channel, payload }) } }
  registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => window as never, () => ({ command: 'engine', args: [] }), base)
})

describe('kênh auth:notice', () => {
  it('chỉ thông báo sau Đăng xuất đi auth:notice; info của luồng đăng nhập chỉ đi auth:login-event', async () => {
    expect(await invoke('auth:list')).toMatchObject({ ok: true })
    const deps = h.create.mock.calls[0][0] as { notify: (e: unknown) => void; notice: (m: string) => void }

    deps.notify({ type: 'info', message: 'Đang mở trình duyệt để đăng nhập' })
    expect(h.sent.filter((s) => s.channel === 'auth:notice')).toEqual([])
    expect(h.sent.filter((s) => s.channel === 'auth:login-event')).toEqual([
      { channel: 'auth:login-event', payload: { type: 'info', message: 'Đang mở trình duyệt để đăng nhập' } }
    ])

    deps.notice('Đã đăng xuất nhưng chưa nạp lại được API key đã lưu.')
    expect(h.sent.filter((s) => s.channel === 'auth:notice')).toEqual([
      { channel: 'auth:notice', payload: { message: 'Đã đăng xuất nhưng chưa nạp lại được API key đã lưu.' } }
    ])
  })
})
