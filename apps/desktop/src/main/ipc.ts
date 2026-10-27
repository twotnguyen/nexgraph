import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { NeighborQuery } from '../shared/graph-types'
import { EngineApi } from './engine/api'
import type { EngineHandle } from './engine/launcher'
import { toIpcResult } from './ipc-result'

/** Đăng ký các kênh IPC của dự án và đồ thị. `handle()` trả engine hiện tại hoặc null khi chưa sẵn sàng. */
export function registerIpc(getHandle: () => EngineHandle | null, getWindow: () => BrowserWindow | null): void {
  const api = (): EngineApi => {
    const h = getHandle()
    if (!h) throw new Error('Engine chưa sẵn sàng')
    return new EngineApi(h)
  }
  const on = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R>): void =>
    ipcMain.handle(channel, (_e, ...args) => toIpcResult(() => fn(...(args as A))))

  on('project:pick-folder', async () => {
    const win = getWindow()
    const opts = { properties: ['openDirectory' as const], title: 'Chọn thư mục mã nguồn' }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  on('project:open', (path: string) => api().openProject(path))
  on('project:list', () => api().listProjects())
  on('index:start', async (pid: string) => ({ jobId: (await api().startIndex(pid)).job_id }))
  on('index:cancel', async (jobId: string) => void (await api().cancelJob(jobId)))
  on('graph:stats', (pid: string) => api().stats(pid))
  on('graph:neighbors', (pid: string, q: NeighborQuery) => api().neighbors(pid, q))
  on('graph:node', (pid: string, id: string) => api().getNode(pid, id))
  on('graph:code', (pid: string, file: string, start?: number, end?: number) => api().code(pid, file, start, end))
}
