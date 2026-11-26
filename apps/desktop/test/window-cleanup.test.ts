// PR #49 vòng 2 (Important 2): reload / renderer chết / đóng MỘT cửa sổ chỉ dọn tài nguyên
// của cửa sổ đó; chỉ khi cửa sổ cuối đóng (hoặc thoát app) mới dọn toàn bộ.
import { expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Contents = {
    events: Map<string, (...args: never[]) => void>
    on: (name: string, cb: (...args: never[]) => void) => void
    send: (...args: unknown[]) => void
    getURL: () => string
    setWindowOpenHandler: (handler: unknown) => void
    session: { setPermissionRequestHandler: () => void; setPermissionCheckHandler: () => void }
  }
  type Win = {
    webContents: Contents
    events: Map<string, () => void>
    destroyed: boolean
    isDestroyed: () => boolean
    close: () => void
    once: (name: string, cb: () => void) => void
    loadURL: () => Promise<void>
    loadFile: () => Promise<void>
  }
  const windows: Win[] = []
  const makeContents = (): Contents => {
    const contents: Contents = {
      events: new Map(),
      on: (name, cb) => { contents.events.set(name, cb) },
      send: () => {},
      getURL: () => 'file:///NexGraph/index.html',
      setWindowOpenHandler: () => {},
      session: { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} }
    }
    return contents
  }
  const makeWindow = (): Win => {
    const win: Win = {
      webContents: makeContents(),
      events: new Map(),
      destroyed: false,
      isDestroyed: () => win.destroyed,
      close: () => { win.destroyed = true; win.events.get('closed')?.() },
      once: () => {},
      loadURL: async () => {},
      loadFile: async () => {}
    }
    return win
  }
  return {
    windows,
    makeWindow,
    makeContents,
    appEvents: new Map<string, (event: { preventDefault(): void }) => void>(),
    closeAll: vi.fn(),
    closeOwned: vi.fn(),
    openWindow: null as (() => void) | null
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/nexgraph-window-cleanup', getAppPath: () => '/tmp/nexgraph-window-cleanup',
    isPackaged: false, getName: () => 'NexGraph',
    commandLine: { hasSwitch: () => false },
    whenReady: () => Promise.resolve(), quit: vi.fn(),
    on: (name: string, cb: (event: { preventDefault(): void }) => void) => h.appEvents.set(name, cb)
  },
  BrowserWindow: class {
    webContents = h.makeContents()
    events = new Map<string, () => void>()
    destroyed = false
    static getAllWindows() { return h.windows.filter((win) => !win.destroyed) }
    constructor() { h.windows.push(this as never) }
    isDestroyed() { return this.destroyed }
    close() { this.destroyed = true; this.events.get('closed')?.() }
    once() {}
    loadURL = async () => {}
    loadFile = async () => {}
    on(name: string, cb: () => void) { this.events.set(name, cb) }
  },
  dialog: { showMessageBoxSync: vi.fn() },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  // Entrypoint đăng ký scheme nxpage trước whenReady và tạo session của trang nhúng.
  protocol: { registerSchemesAsPrivileged: vi.fn() }, session: { fromPartition: () => null },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn(() => ({ items: [] })) }
}))

vi.mock('../src/main/ipc', () => ({
  registerIpc: (...args: unknown[]) => { h.openWindow = args[5] as () => void },
  closeAllAgents: h.closeAll,
  closeWindowResources: h.closeOwned,
  stopAllWatchers: vi.fn(),
  stopAllMcpHttp: vi.fn(async () => {}),
  stopEditorProcesses: vi.fn()
}))

vi.mock('../src/main/platform/engine/supervisor', () => ({
  EngineSupervisor: class {
    startEngine = vi.fn(async () => {})
    stop = vi.fn(async () => {})
    getStatus = vi.fn()
  }
}))

it('reload/crash/đóng một cửa sổ chỉ dọn tài nguyên của cửa sổ đó, cửa sổ cuối mới dọn toàn bộ', async () => {
  await import('../src/main/index')
  await vi.waitFor(() => expect(h.windows).toHaveLength(1))
  h.openWindow!()
  await vi.waitFor(() => expect(h.windows).toHaveLength(2))
  const [a, b] = h.windows

  // Điều hướng same-document (đổi hash của SPA) không phải reload: giữ nguyên phiên.
  a.webContents.events.get('did-start-navigation')!({ isMainFrame: true, isSameDocument: true } as never)
  expect(h.closeOwned).not.toHaveBeenCalled()
  expect(h.closeAll).not.toHaveBeenCalled()

  // Reload cửa sổ B: chỉ dọn của B, agent của A còn sống.
  b.webContents.events.get('did-start-navigation')!({ isMainFrame: true, isSameDocument: false } as never)
  expect(h.closeOwned).toHaveBeenNthCalledWith(1, b.webContents)
  expect(h.closeAll).not.toHaveBeenCalled()

  // Renderer của B chết: vẫn chỉ dọn của B.
  b.webContents.events.get('render-process-gone')!()
  expect(h.closeOwned).toHaveBeenNthCalledWith(2, b.webContents)
  expect(h.closeAll).not.toHaveBeenCalled()

  // Đóng B khi A còn mở: chỉ dọn của B.
  b.events.get('closed')!()
  expect(h.closeOwned).toHaveBeenNthCalledWith(3, b.webContents)
  expect(h.closeAll).not.toHaveBeenCalled()

  // Đóng cửa sổ cuối: dọn toàn bộ.
  a.events.get('closed')!()
  expect(h.closeOwned).toHaveBeenNthCalledWith(4, a.webContents)
  expect(h.closeAll).toHaveBeenCalledOnce()
})
