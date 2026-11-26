import { app, dialog } from 'electron'
import { join } from 'node:path'
import { ExtensionRegistry } from './registry'
import type { IpcContext } from '../../platform/ipc-context'

/** Extension: thư mục người dùng chọn được kiểm tra rồi chép vào <userData>/extensions; renderer chỉ nhận manifest đã kiểm. */
export function registerExtensionsIpc(ctx: IpcContext): void {
  const { on, getWindow } = ctx
  const extensions = new ExtensionRegistry(join(app.getPath('userData'), 'extensions'))
  on('extensions:list', async () => extensions.list())
  on('extensions:install', async () => {
    const win = getWindow()
    const opts = { properties: ['openDirectory' as const], title: 'Chọn thư mục extension (có extension.json)' }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || !r.filePaths[0] ? null : extensions.install(r.filePaths[0])
  })
  on('extensions:remove', async (id: string) => extensions.remove(String(id)))
}
