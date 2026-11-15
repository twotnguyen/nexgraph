import { expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  events: new Map<string, (event: { preventDefault(): void }) => void>(),
  closed: null as (() => void) | null,
  closeWindow: vi.fn(), stopEngine: vi.fn(async () => {}), stopWatchers: vi.fn(),
  closeAgents: vi.fn(), stopMcp: vi.fn(async () => {}), quit: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/nexgraph-quit-test', getAppPath: () => '/tmp/nexgraph-quit-test',
    whenReady: () => Promise.resolve(), quit: h.quit,
    on: (name: string, cb: (event: { preventDefault(): void }) => void) => h.events.set(name, cb) },
  BrowserWindow: class {
    static getAllWindows() { return [] }
    webContents = { on: vi.fn(), send: vi.fn() }
    once = vi.fn()
    isDestroyed() { return false }
    close = h.closeWindow
    loadFile = vi.fn(async () => {})
    loadURL = vi.fn(async () => {})
    on(name: string, cb: () => void) { if (name === 'closed') h.closed = cb }
  },
  dialog: { showMessageBoxSync: vi.fn() }, ipcMain: { handle: vi.fn() }
}))
vi.mock('../src/main/ipc', () => ({
  registerIpc: vi.fn(), closeAllAgents: h.closeAgents, stopAllWatchers: h.stopWatchers, stopAllMcpHttp: h.stopMcp
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
