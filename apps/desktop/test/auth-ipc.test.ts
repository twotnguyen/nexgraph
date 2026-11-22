import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  userData: '', dataDir: '',
  create: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => h.handlers.set(channel, fn) },
  dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../src/main/engine/api', async (original) => {
  const actual = await original<typeof import('../src/main/engine/api')>()
  return { ...actual, EngineApi: class { listProjects() { return [] } } }
})
vi.mock('../src/main/mcp-http', () => ({ McpHttpManager: class {} }))
vi.mock('../src/main/agent/accounts', () => ({ AccountService: { create: (...args: unknown[]) => h.create(...args) } }))
vi.mock('../src/main/agent/session', () => ({
  AgentError: class extends Error { constructor(public code: string, message: string) { super(message) } },
  AgentService: class { selectionChanged() {} prompt() {} forkSession() {} snapshot() { return { runtime: 'pi' } } }
}))
vi.mock('../src/main/gemini/connection', () => ({ GeminiConnectionManager: class {
  status() { return { state: 'disconnected', installed: false, platformSupported: true, authenticated: false, connectionId: '', model: '', version: '' } }
  connectionIdentity() { return '' }
  selectedModel() { return '' }
} }))
vi.mock('../src/main/gemini/service', () => ({ GeminiAgentService: class { selectionChanged() {} testConnection() {} prompt() {} forkSession() {} snapshot() { return { runtime: 'antigravity-cli' } } } }))

import { registerIpc } from '../src/main/ipc'

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
const invoke = <T = unknown,>(channel: string, ...args: unknown[]) => h.handlers.get(channel)!({}, ...args) as Promise<Result<T>>

beforeEach(() => {
  vi.resetAllMocks()
  const base = mkdtempSync(join(tmpdir(), 'ng-auth-ipc-'))
  h.dataDir = base
  h.userData = join(base, 'user')
  mkdirSync(h.userData)
  writeFileSync(join(h.userData, 'prefs.json'), JSON.stringify({ aiRuntime: 'pi' }))
  h.handlers.clear()
  registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => null, () => ({ command: 'engine', args: [] }), base)
})

describe('auth IPC khởi tạo AccountService', () => {
  it('một lần tạo AccountService lỗi không làm chết mọi lần gọi auth sau đó', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // toIpcResult log lỗi nội bộ, test không cần
    h.create.mockRejectedValueOnce(new Error('kho khoá tạm thời không mở được'))
      .mockResolvedValue({ listProviders: async () => [{ id: 'openai', label: 'OpenAI' }] })
    expect(await invoke('auth:list')).toMatchObject({ ok: false })
    expect(await invoke('auth:list')).toMatchObject({ ok: true, data: [{ id: 'openai', label: 'OpenAI' }] })
    expect(h.create).toHaveBeenCalledTimes(2)
  })
})
