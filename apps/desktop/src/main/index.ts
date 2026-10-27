import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { resolveEngineCommand } from './engine/resolve-command'
import { EngineSupervisor } from './engine/supervisor'

let mainWindow: BrowserWindow | null = null

const dataDir = process.env.NEXGRAPH_DATA_DIR ?? join(app.getPath('userData'), 'engine-data')
// apps/desktop -> gốc repo (chỉ dùng lúc dev)
const repoRoot = join(app.getAppPath(), '..', '..')

const supervisor = new EngineSupervisor(
  () => resolveEngineCommand({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, repoRoot }),
  dataDir,
  (status) => mainWindow?.webContents.send('engine:status-changed', status)
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
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  if (process.env['ELECTRON_RENDERER_URL']) void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('engine:status', () => supervisor.getStatus())
ipcMain.handle('engine:restart', () => supervisor.restart())

app.whenReady().then(() => {
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
  void supervisor.stop().finally(() => app.quit())
})
