import { expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  events: new Map<string, (event: { preventDefault(): void }) => void>(),
  closed: null as (() => void) | null,
  closeWindow: vi.fn(), stopEngine: vi.fn(async () => {}), stopWatchers: vi.fn(),
  closeAgents: vi.fn(), stopMcp: vi.fn(async () => {}), quit: vi.fn(), externalOpen: vi.fn(async () => {}),
  openHandler: null as ((details: { url: string }) => { action: string }) | null,
  webEvents: new Map<string, (...args: unknown[]) => void>()
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/nexgraph-quit-test', getAppPath: () => '/tmp/nexgraph-quit-test',
    commandLine: { hasSwitch: () => false },
    whenReady: () => Promise.resolve(), quit: h.quit,
    on: (name: string, cb: (event: { preventDefault(): void }) => void) => h.events.set(name, cb) },
  BrowserWindow: class {
    static getAllWindows() { return [] }
    webContents = {
      on: vi.fn((name: string, cb: (...args: unknown[]) => void) => h.webEvents.set(name, cb)),
      send: vi.fn(), getURL: () => 'file:///C:/NexGraph/index.html',
      setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: string }) => { h.openHandler = handler }),
      session: { setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }
    }
    once = vi.fn()
    isDestroyed() { return false }
    close = h.closeWindow
    loadFile = vi.fn(async () => {})
    loadURL = vi.fn(async () => {})
    on(name: string, cb: () => void) { if (name === 'closed') h.closed = cb }
  },
  dialog: { showMessageBoxSync: vi.fn() }, ipcMain: { handle: vi.fn() }, shell: { openExternal: h.externalOpen }
}))
vi.mock('../src/main/ipc', () => ({
  registerIpc: vi.fn(), closeAllAgents: h.closeAgents, stopAllWatchers: h.stopWatchers, stopAllMcpHttp: h.stopMcp, stopEditorProcesses: vi.fn()
}))
vi.mock('../src/main/engine/supervisor', () => ({ EngineSupervisor: class {
  startEngine = vi.fn(async () => {})
  stop = h.stopEngine
  getStatus = vi.fn()
} }))

it('chọn Ở lại khi Quit không dừng engine/watcher; chỉ cleanup sau khi cửa sổ thực sự đóng', async () => {
  // Nạp entrypoint sau khi dựng Electron giả để kiểm đúng callback vòng đời ứng dụng.
  await import('../src/main/index')
  await vi.waitFor(() => expect(h.events.has('before-quit')).toBe(true))
  const request = h.events.get('before-quit')!
  const event = { preventDefault: vi.fn() }
  request(event)
  expect(event.preventDefault).toHaveBeenCalled()
  expect(h.closeWindow).toHaveBeenCalledOnce()
  expect(h.stopEngine).not.toHaveBeenCalled()
  expect(h.stopWatchers).not.toHaveBeenCalled()
  expect(h.closeAgents).not.toHaveBeenCalled()
  expect(h.quit).not.toHaveBeenCalled()
  h.closed!()
  h.closeAgents.mockClear()
  request({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(h.quit).toHaveBeenCalledOnce())
  expect(h.stopEngine).toHaveBeenCalledOnce()
  expect(h.stopWatchers).toHaveBeenCalledOnce()
  expect(h.closeAgents).toHaveBeenCalledOnce()
})

it('opens web links externally while keeping executable links and external pages out of the renderer', async () => {
  await import('../src/main/index')
  await vi.waitFor(() => expect(h.openHandler).toBeTypeOf('function'))
  h.externalOpen.mockClear()
  expect(h.openHandler!({ url: 'https://example.com/docs' })).toEqual({ action: 'deny' })
  expect(h.externalOpen).toHaveBeenCalledWith('https://example.com/docs')
  h.openHandler!({ url: 'javascript:alert(1)' })
  expect(h.externalOpen).toHaveBeenCalledTimes(1)
  const navigate = h.webEvents.get('will-navigate')!
  const external = { preventDefault: vi.fn() }
  navigate(external, 'https://example.com/login')
  expect(external.preventDefault).toHaveBeenCalledOnce()
  const own = { preventDefault: vi.fn() }
  navigate(own, 'file:///C:/NexGraph/index.html#settings')
  expect(own.preventDefault).not.toHaveBeenCalled()
})
