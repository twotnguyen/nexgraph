import { app, dialog, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportFormat, ExportScope, PushRequest } from '@nexgraph/contracts/graph-types'
import { AgentError } from '../agent/session'
import { writeJson } from '../../platform/settings'
import { FsError, isWithin } from '../../platform/project-fs'
import type { IpcContext } from '../../platform/ipc-context'
import { prefsFile, readJson } from '../../platform/prefs'

/** Thư mục xuất đã chọn theo projectId: chỉ main được ghi, renderer không gửi lại path tuỳ ý. */
const exportDirKey = (pid: string): string => `exportDir:${pid}`
const savedExportDir = (pid: string): string | null => {
  const prefs = readJson(prefsFile())
  return prefs[exportDirKey(pid)] ?? null
}

/** Xuất đồ thị (9 định dạng), đẩy lên đích ngoài, chụp PNG và mở thư mục kết quả. */
export function registerExportIpc(ctx: IpcContext): void {
  const { on, api, rootOf, getWindow } = ctx
  on('export:pick-dir', async (pid: string) => {
    await rootOf(pid) // chỉ dự án đã đăng ký mới có thể chọn thư mục xuất
    const win = getWindow()
    const opts = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      title: 'Chọn thư mục lưu kết quả xuất',
      defaultPath: savedExportDir(pid) ?? app.getPath('downloads')
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    const file = prefsFile()
    writeJson(file, { ...readJson(file), [exportDirKey(pid)]: r.filePaths[0] })
    return r.filePaths[0]
  })
  on('export:run', async (pid: string, format: ExportFormat, scope: ExportScope, lang?: 'vi' | 'en') => {
    await rootOf(pid)
    const dir = savedExportDir(pid)
    if (!dir) throw new AgentError('bad_param', 'Chưa chọn thư mục lưu kết quả xuất')
    // Chỉ nhận đúng hai giá trị; tham số lạ của renderer không được chuyển xuống engine.
    return lang === 'vi' || lang === 'en' ? api().exportGraph(pid, format, scope, dir, lang) : api().exportGraph(pid, format, scope, dir)
  })
  on('export:push', (pid: string, req: PushRequest) => api().pushGraph(pid, req))
  on('export:png', async (pid: string, rect?: { x: number; y: number; width: number; height: number }) => {
    const win = getWindow()
    if (!win) return null
    const image = await (rect && rect.width > 0 && rect.height > 0 ? win.webContents.capturePage(rect) : win.webContents.capturePage())
    const r = await dialog.showSaveDialog(win, {
      title: 'Lưu ảnh đồ thị',
      defaultPath: join(savedExportDir(pid) ?? app.getPath('downloads'), 'nexgraph.png'),
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (r.canceled || !r.filePath) return null
    await writeFile(r.filePath, image.toPNG())
    return r.filePath
  })
  on('export:reveal', async (pid: string, path: string) => {
    const root = await rootOf(pid)
    const dir = savedExportDir(pid)
    if (!isWithin(root, path) && !(dir && isWithin(dir, path)))
      throw new FsError('outside_project', `Đường dẫn nằm ngoài dự án và thư mục xuất: ${path}`)
    await shell.showItemInFolder(path)
  })
}
