import { app, dialog } from 'electron'
import { isAbsolute, relative, sep } from 'node:path'
import { isMenuLocale, pickFileTitle } from '../app-menu-labels'
import { getMenuLocale, setMenuLocale } from '../app-menu-locale'
import { readCurrentLicenses } from '../licenses'
import type { IpcContext } from '../platform/ipc-context'
import { UserError } from '../user-error'

/** Kênh của khung ứng dụng: chọn thư mục/tệp, cửa sổ mới, menu native, giấy phép, phiên bản. */
export function registerAppIpc(ctx: IpcContext): void {
  const { on, onTrusted, getWindow, openWindow, rebuildMenu, rootOf } = ctx
  on('project:pick-folder', async () => {
    const win = getWindow()
    const opts = { properties: ['openDirectory' as const], title: 'Chọn thư mục mã nguồn' }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  if (openWindow) onTrusted('window:open-new', async () => { openWindow() })
  // Menu native và hộp thoại của menu File đổi nhãn theo ngôn ngữ UI; renderer gửi khi đổi.
  onTrusted('app-menu:set-locale', async (value?: unknown) => {
    if (!isMenuLocale(value)) throw new UserError('bad_locale', 'Ngôn ngữ không hợp lệ.')
    setMenuLocale(value)
    rebuildMenu?.(value)
  })
  // Màn Giấy phép mã nguồn mở + mục Giới thiệu: chỉ đọc tệp đi kèm, không nhận đường dẫn từ renderer.
  onTrusted('licenses:read', () => readCurrentLicenses())
  onTrusted('app:version', async () => app.getVersion())
  onTrusted('file:pick-open', async (projectId?: string) => {
    const win = getWindow()
    const opts = { properties: ['openFile' as const], title: pickFileTitle[getMenuLocale()] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    const path = r.filePaths[0]
    let relativePath: string | undefined
    if (projectId) {
      try {
        const rel = relative(await rootOf(projectId), path)
        if (rel && !rel.startsWith('..') && !isAbsolute(rel)) relativePath = rel.split(sep).join('/')
      } catch { /* dự án không hợp lệ: trả về đường dẫn tuyệt đối */ }
    }
    return { path, relative: relativePath }
  })
}
