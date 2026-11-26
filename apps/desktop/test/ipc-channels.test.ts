// ADR 0026 pha 2: kênh IPC chia theo tính năng (`features/<x>/ipc.ts`). Khoá rằng việc chia không làm
// mất/trùng kênh, và việc dọn khi gỡ dự án vẫn chạy ở mọi tính năng giữ trạng thái theo dự án.
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  duplicates: [] as string[],
  projects: [] as { project_id: string; path: string }[],
  removed: [] as string[],
  mcpStops: [] as string[],
  watcherStops: [] as string[],
  userData: ''
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userData : '/tmp'), isPackaged: false, getVersion: () => '0.0.0' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      if (h.handlers.has(channel)) h.duplicates.push(channel)
      h.handlers.set(channel, fn)
    }
  },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false }) },
  shell: { showItemInFolder: vi.fn(), openExternal: vi.fn(async () => {}) },
  webContents: { fromId: () => null },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))

vi.mock('../src/main/engine/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/engine/api')>()
  class FakeEngineApi {
    listProjects() { return h.projects }
    removeProject(pid: string) { h.removed.push(pid); h.projects = h.projects.filter((p) => p.project_id !== pid); return Promise.resolve() }
  }
  return { ...actual, EngineApi: FakeEngineApi }
})

vi.mock('../src/main/mcp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/mcp-http')>()
  class FakeMcpHttpManager {
    start() { return Promise.resolve({ url: 'http://127.0.0.1:1/mcp', key: 'k' }) }
    stop(pid: string) { h.mcpStops.push(pid); return Promise.resolve() }
    stopAll() { return Promise.resolve() }
    status() { return null }
  }
  return { ...actual, McpHttpManager: FakeMcpHttpManager }
})

vi.mock('../src/main/watch/project-watcher', () => ({
  ProjectWatcher: class {
    constructor(private readonly o: { root: string }) {}
    start() {}
    stop() { h.watcherStops.push(this.o.root) }
  }
}))

import { registerIpc } from '../src/main/ipc'

/** Kênh renderer gọi qua preload (`call('kênh', …)` / `ipcRenderer.invoke('kênh', …)`). */
const preloadChannels = (): Set<string> => {
  const source = readFileSync(join(__dirname, '../src/preload/index.ts'), 'utf8')
  return new Set([...source.matchAll(/(?:call|invoke)(?:<[^>]*>)?\(['"]([a-z0-9-]+:[a-z0-9:-]+)['"]/g)].map((m) => m[1]))
}
/** Đăng ký ở `index.ts` (vòng đời engine), không qua `registerIpc`. */
const REGISTERED_IN_INDEX = ['engine:restart', 'engine:status']

describe('kênh IPC theo tính năng', () => {
  const root = mkdtempSync(join(tmpdir(), 'ng-ipc-channels-'))
  beforeAll(() => {
    h.userData = mkdtempSync(join(tmpdir(), 'ng-ipc-channels-ud-'))
    registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => null, () => ({ command: 'x', args: [] }) as never,
      h.userData, undefined, () => {}, () => {})
  })

  it('mọi kênh preload gọi đều có handler, không còn handler thừa', () => {
    const expected = [...preloadChannels()].filter((c) => !REGISTERED_IN_INDEX.includes(c)).sort()
    expect(expected.length).toBeGreaterThan(200)
    expect([...h.handlers.keys()].sort()).toEqual(expected)
  })

  it('không kênh nào bị hai tính năng đăng ký', () => {
    expect(h.duplicates).toEqual([])
  })

  it('gỡ dự án chạy việc dọn của các tính năng (watcher, MCP HTTP) sau khi engine gỡ xong', async () => {
    h.projects = [{ project_id: 'p1', path: root }]
    await h.handlers.get('watch:start')!({}, 'p1')
    const result = await h.handlers.get('project:remove')!({}, 'p1') as { ok: boolean }
    expect(result.ok).toBe(true)
    expect(h.removed).toEqual(['p1'])
    expect(h.watcherStops).toEqual([root])
    expect(h.mcpStops).toEqual(['p1'])
  })
})
