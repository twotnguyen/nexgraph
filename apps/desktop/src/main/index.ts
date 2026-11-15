import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { EngineHandle } from './engine/launcher'
import { subscribeEvents } from './engine/events'
import { closeAllAgents, registerIpc, stopAllMcpHttp, stopAllWatchers } from './ipc'
import { closesAgents, confirmUnload } from './unload-guard'
import { join } from 'node:path'
import { resolveEngineCommand } from './engine/resolve-command'
import { getHealth } from './engine/client'
import { startEngine } from './engine/launcher'
import { EngineSupervisor } from './engine/supervisor'
import { runSmoke } from './smoke'

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

function createWindow(): void {
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
  win.once('ready-to-show', () => win.show())
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

  if (process.env['ELECTRON_RENDERER_URL']) void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

registerIpc(() => supervisor.getHandle(), () => mainWindow, engineCommand, dataDir)
ipcMain.handle('engine:status', () => supervisor.getStatus())
ipcMain.handle('engine:restart', () => supervisor.restart())

// NEXGRAPH_SMOKE=1: không mở cửa sổ; khởi động engine, chạy selftest, in kết quả rồi thoát (kiểm tra bản đóng gói).
async function smoke(): Promise<void> {
  const watchdog = setTimeout(() => {
    console.log('SMOKE FAIL timeout 90s')
    app.exit(1)
  }, 90_000)
  try {
    const command = resolveEngineCommand({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, repoRoot })
    const handle = await startEngine(command, { dataDir })
    try {
      await getHealth(handle)
      console.log(await runSmoke(handle))
    } finally {
      await handle.stop()
    }
    clearTimeout(watchdog)
    app.exit(0)
  } catch (err) {
    console.log(`SMOKE FAIL ${err instanceof Error ? err.message : String(err)}`)
    app.exit(1)
  }
}

app.whenReady().then(() => {
  if (process.env.NEXGRAPH_SMOKE === '1') {
    void smoke()
    return
  }
  createWindow()
  void supervisor.startEngine()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())

// Đợi engine dừng hẳn (kể cả cây tiến trình) rồi mới thoát, để không để lại tiến trình mồ côi.
let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  stopAllWatchers()
  closeAllAgents()
  void Promise.all([supervisor.stop(), stopAllMcpHttp()]).finally(() => app.quit())
})
