import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  userData: '',
  root: '',
  model: null as string | null,
  started: [] as Record<string, unknown>[]
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => h.handlers.set(channel, fn) },
  dialog: {}, shell: {}, safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../src/main/platform/engine/api', async (original) => {
  const actual = await original<typeof import('../src/main/platform/engine/api')>()
  return {
    ...actual,
    EngineApi: class {
      listProjects() { return [{ project_id: 'p1', path: h.root, name: 'x', storage: 'in_project' }] }
      aiSettings() { return { enabled: h.model !== null, transport: h.model ? 'app' : null, model: h.model } }
      startSemantic(_pid: string, body: Record<string, unknown>) { h.started.push(body); return { job_id: 'job-1' } }
    }
  }
})
vi.mock('../src/main/features/integrations/mcp-http', () => ({ McpHttpManager: class {} }))
vi.mock('../src/main/features/agent/accounts', () => ({
  AccountService: {
    create: async () => ({
      getSelectedModel: () => ({ provider: 'openai', id: 'm1' }),
      getConsentTarget: async () => ({ provider: 'openai', baseUrl: 'https://api.example.com/v1' }),
      hasKey: () => true,
      listModels: async () => []
    })
  }
}))
vi.mock('../src/main/features/agent/session', () => ({
  AgentError: class extends Error { constructor(public code: string, message: string) { super(message) } },
  AgentService: class {}
}))
vi.mock('../src/main/features/agent/gemini/connection', () => ({ GeminiConnectionManager: class {} }))
vi.mock('../src/main/features/agent/gemini/service', () => ({ GeminiAgentService: class {} }))

import { registerIpc } from '../src/main/ipc'

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
const invoke = <T = unknown,>(channel: string, ...args: unknown[]) => h.handlers.get(channel)!({}, ...args) as Promise<Result<T>>

beforeEach(() => {
  vi.resetAllMocks()
  const base = mkdtempSync(join(tmpdir(), 'ng-semantic-ipc-'))
  h.userData = join(base, 'user')
  h.root = join(base, 'source')
  mkdirSync(h.userData)
  mkdirSync(h.root)
  writeFileSync(join(h.userData, 'prefs.json'), JSON.stringify({}))
  h.model = null
  h.started = []
  h.handlers.clear()
  registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => null, () => ({ command: 'engine', args: [] }), base)
})

describe('semantic:start', () => {
  it('AI-08: dedup chạy được khi chưa bật AI/chọn model', async () => {
    expect(await invoke('semantic:start', 'p1', 'dedup', undefined, false)).toMatchObject({ ok: true, data: { jobId: 'job-1' } })
    expect(h.started).toHaveLength(1)
    expect(h.started[0]).toMatchObject({ targets: 'dedup' })
  })

  it('AI-08: target cần gửi dữ liệu vẫn bị chặn khi chưa bật AI', async () => {
    expect(await invoke('semantic:start', 'p1', 'docs')).toMatchObject({ ok: false, error: { code: 'ai_disabled' } })
    expect(h.started).toHaveLength(0)
  })
})
