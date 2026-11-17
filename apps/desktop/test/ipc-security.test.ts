// Test bảo mật IPC: mọi handler nhận path phải suy gốc từ projectId đã đăng ký trong main.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  projects: [] as { project_id: string; path: string }[],
  exports: [] as unknown[][],
  mcpStarts: [] as [string, string][],
  watcherRoots: [] as string[],
  showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [] as string[] })),
  showItemInFolder: vi.fn(async (_path: string) => {})
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? join(tmpdir(), 'ng-ipc-userdata-test') : '/tmp') },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => { h.handlers.set(channel, fn) } },
  dialog: { showOpenDialog: h.showOpenDialog },
  shell: { showItemInFolder: h.showItemInFolder },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))

vi.mock('../src/main/engine/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/engine/api')>()
  class FakeEngineApi {
    listProjects() { return h.projects }
    exportGraph(...args: unknown[]) { h.exports.push(args); return { files: [join(args.at(-1) as string, 'a.html')], truncated: false } }
  }
  return { ...actual, EngineApi: FakeEngineApi }
})

vi.mock('../src/main/mcp-http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/mcp-http')>()
  class FakeMcpHttpManager {
    start(pid: string, projectPath: string) { h.mcpStarts.push([pid, projectPath]); return Promise.resolve({ url: 'http://127.0.0.1:1/mcp', key: 'k' }) }
    stop() { return Promise.resolve() }
    stopAll() { return Promise.resolve() }
    status() { return null }
  }
  return { ...actual, McpHttpManager: FakeMcpHttpManager }
})

vi.mock('../src/main/watch/project-watcher', () => ({
  ProjectWatcher: class {
    constructor(o: { root: string }) { h.watcherRoots.push(o.root) }
    start() {}
    stop() {}
  }
}))

import { registerIpc } from '../src/main/ipc'

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
const invoke = (channel: string, ...args: unknown[]): Promise<Result> => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`Thiếu handler ${channel}`)
  return fn({}, ...args) as Promise<Result>
}
const dataOf = <T,>(r: Result): T => (r as { ok: true; data: T }).data

let root: string
let root2: string
let exportDir: string

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'ng-ipc-sec-'))
  root = join(base, 'proj')
  root2 = join(base, 'proj2')
  exportDir = join(base, 'export')
  for (const dir of [root, root2, exportDir, join(root, '.git', 'hooks')]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(root, 'a.ts'), 'x')
  h.projects = [{ project_id: 'p1', path: root }, { project_id: 'p2', path: root2 }]
  registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => null, () => ({ command: 'engine', args: [], cwd: base }), base)
})

describe('IPC: path thô từ renderer bị từ chối', () => {
  it('watch:start với projectId lạ → unknown_project; projectId đúng dùng root đã đăng ký, bỏ path lạ', async () => {
    expect(await invoke('watch:start', 'nope', '/etc')).toMatchObject({ ok: false, error: { code: 'unknown_project' } })
    expect(await invoke('watch:start', 'p1', '/etc')).toMatchObject({ ok: true })
    expect(h.watcherRoots).toEqual([root])
    expect(await invoke('watch:stop', 'p1')).toMatchObject({ ok: true })
  })

  it('mcp:config/hook:* /mcp:plan /mcp:apply /mcp:start-http từ chối projectId lạ', async () => {
    for (const channel of ['mcp:config', 'hook:status', 'hook:preview', 'hook:install', 'hook:uninstall', 'mcp:start-http']) {
      expect(await invoke(channel, 'nope', '/etc')).toMatchObject({ ok: false, error: { code: 'unknown_project' } })
    }
    for (const channel of ['mcp:plan', 'mcp:apply']) {
      expect(await invoke(channel, 'claude', 'nope', '/etc')).toMatchObject({ ok: false, error: { code: 'unknown_project' } })
    }
  })

  it('mcp:config và mcp:plan bỏ path lạ, dùng root thật của projectId', async () => {
    const cfg = await invoke('mcp:config', 'p1', '/etc/evil')
    expect(cfg.ok).toBe(true)
    // So trên giá trị đã parse: trên Windows JSON.stringify nhân đôi dấu '\', so chuỗi thô sẽ sai.
    const stdio = JSON.parse(dataOf<{ stdio: string }>(cfg).stdio) as { mcpServers: { nexgraph: { args: string[] } } }
    expect(stdio.mcpServers.nexgraph.args).toContain(root)
    expect(dataOf<{ stdio: string }>(cfg).stdio).not.toContain('/etc/evil')
    const plan = await invoke('mcp:plan', 'codex', 'p1', '/etc/evil')
    expect(plan.ok).toBe(true)
    expect(dataOf<{ path: string }>(plan).path.endsWith(join('.codex', 'config.toml'))).toBe(true)
    await invoke('hook:install', 'p1', '/etc/evil')
    expect(dataOf<string>(await invoke('hook:status', 'p1'))).toBe('on')
    expect(await invoke('mcp:start-http', 'p1', '/etc/evil')).toMatchObject({ ok: true })
    expect(h.mcpStarts.at(-1)).toEqual(['p1', root])
  })
})

describe('IPC: xuất chỉ dùng thư mục đã chọn trong main', () => {
  it('export:run bỏ outDir lạ; reveal chỉ cho path trong gốc dự án hoặc thư mục xuất', async () => {
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [exportDir] })
    expect(await invoke('export:pick-dir', 'p1', '/etc/evil')).toMatchObject({ ok: true, data: exportDir })
    expect(await invoke('export:run', 'p1', 'html', { kind: 'all' }, '/etc/evil')).toMatchObject({ ok: true })
    expect(h.exports.at(-1)).toEqual(['p1', 'html', { kind: 'all' }, exportDir])
    expect(await invoke('export:run', 'p2', 'html', { kind: 'all' })).toMatchObject({ ok: false, error: { code: 'bad_param' } })
    expect(await invoke('export:reveal', 'p1', join(exportDir, 'a.html'))).toMatchObject({ ok: true })
    expect(await invoke('export:reveal', 'p1', join(root, 'a.ts'))).toMatchObject({ ok: true })
    expect(await invoke('export:reveal', 'p1', '/etc/passwd')).toMatchObject({ ok: false, error: { code: 'outside_project' } })
    expect(await invoke('export:reveal', 'nope', '/etc/passwd')).toMatchObject({ ok: false, error: { code: 'unknown_project' } })
    expect(h.showItemInFolder).toHaveBeenCalledTimes(2)
  })
})
