import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { EngineHandle } from './engine/launcher'
import { subscribeEvents } from './engine/events'
import { closeAllAgents, registerIpc, stopAllMcpHttp, stopAllWatchers } from './ipc'
import { closesAgents, confirmUnload } from './unload-guard'
import { join } from 'node:path'
import { resolveEngineCommand } from './engine/resolve-command'
import { getHealth } from './engine/client'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runRendererSmoke } from './smoke-desktop'
import { EngineSupervisor } from './engine/supervisor'
import { runSmoke } from './smoke'

// Kiểm bản cài dùng kho tài khoản riêng, không đọc/ghi cấu hình AI thật của người dùng.
if (process.env.NEXGRAPH_USER_DATA_DIR) {
  mkdirSync(process.env.NEXGRAPH_USER_DATA_DIR, { recursive: true })
  app.setPath('userData', process.env.NEXGRAPH_USER_DATA_DIR)
}

let mainWindow: BrowserWindow | null = null

const dataDir = process.env.NEXGRAPH_DATA_DIR ?? join(app.getPath('userData'), 'engine-data')
// apps/desktop -> gốc repo (chỉ dùng lúc dev)
const repoRoot = join(app.getAppPath(), '..', '..')

// Chuyển sự kiện SSE của engine lên renderer; tự mở lại luồng khi engine khởi động lại hoặc luồng đứt.
let stopEvents: (() => void) | null = null
let retry: NodeJS.Timeout | null = null
function followEvents(handle: EngineHandle | null): void {
  stopEvents?.()
  stopEvents = null
  if (retry) clearTimeout(retry)
  if (!handle) return
  stopEvents = subscribeEvents(
    handle,
    (e) => mainWindow?.webContents.send('engine:event', e),
    () => {
      retry = setTimeout(() => followEvents(supervisor.getHandle()), 1000)
    }
  )
}

const engineCommand = () => resolveEngineCommand({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, repoRoot })
const supervisor = new EngineSupervisor(
  engineCommand,
  dataDir,
  (status) => {
    mainWindow?.webContents.send('engine:status-changed', status)
    followEvents(status.state === 'ready' ? supervisor.getHandle() : null)
  }
)

async function createWindow(show = true): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'NexGraph',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const win = mainWindow
  if (show) win.once('ready-to-show', () => win.show())
  // Renderer chặn unload khi còn tệp chưa lưu (beforeunload); preventDefault ở đây là cho phép đóng.
  win.webContents.on('will-prevent-unload', (e) => {
    if (confirmUnload((o) => dialog.showMessageBoxSync(win, o))) e.preventDefault()
  })
  win.webContents.on('did-start-navigation', (e) => { if (closesAgents(e)) closeAllAgents() })
  win.webContents.on('render-process-gone', () => closeAllAgents())
  win.on('closed', () => {
    closeAllAgents()
    mainWindow = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) await mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

registerIpc(() => supervisor.getHandle(), () => mainWindow, engineCommand, dataDir)
ipcMain.handle('engine:status', () => supervisor.getStatus())
ipcMain.handle('engine:restart', () => supervisor.restart())

// NEXGRAPH_SMOKE=1: kiểm engine; script smoke:packaged còn kiểm fs/agent qua preload + IPC thật.
async function smoke(): Promise<void> {
  const watchdog = setTimeout(() => {
    console.log('SMOKE FAIL timeout 90s')
    app.exit(1)
  }, 90_000)
  try {
    await supervisor.startEngine()
    const handle = supervisor.getHandle()
    if (!handle) throw new Error('engine not ready')
    const root = mkdtempSync(join(tmpdir(), 'nexgraph-smoke-project-'))
    try {
      await getHealth(handle)
      const engine = await runSmoke(handle)
      const url = process.env.NEXGRAPH_SMOKE_LLM_URL
      let desktop = ''
      if (url) {
        await createWindow(false)
        const script = `(${runRendererSmoke.toString()})(window.nexgraph, ${JSON.stringify(root)}, ${JSON.stringify(url)})`
        desktop = await mainWindow!.webContents.executeJavaScript(script) as string
      }
      console.log(`${engine}${desktop ? ` ${desktop}` : ''}`)
    } finally {
      closeAllAgents()
      await supervisor.stop()
      rmSync(root, { recursive: true, force: true })
    }
    clearTimeout(watchdog)
    app.exit(0)
  } catch (err) {
    // Lỗi IPC đôi khi là object {code, message} (không phải Error): in rõ để không ra `[object Object]`.
    const detail = err instanceof Error ? err.message
      : err && typeof err === 'object' ? JSON.stringify(err)
      : String(err)
    console.log(`SMOKE FAIL ${detail}`)
    app.exit(1)
  }
}

app.whenReady().then(() => {
  if (process.env.NEXGRAPH_SMOKE === '1') {
    void smoke()
    return
  }
  void createWindow()
  void supervisor.startEngine()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => app.quit())

// Đợi engine dừng hẳn (kể cả cây tiến trình) rồi mới thoát, để không để lại tiến trình mồ côi.
let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  // close() hỏi beforeunload trước; chọn “Ở lại” thì mọi dịch vụ phải tiếp tục chạy.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
    return
  }
  quitting = true
  stopAllWatchers()
  closeAllAgents()
  void Promise.all([supervisor.stop(), stopAllMcpHttp()]).finally(() => app.quit())
})
