import { ipcMain, webContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PAGE_NODE_CHANNEL, deliverLateSelection, handlePageNodeMessage } from './bridge'
import { discoverGraphPages, readGraphJsonIndex } from './pages'
import { PAGES_PARTITION, guestBinding } from './protocol'
import { pageRoots } from './roots'
import type { IpcContext } from '../../platform/ipc-context'

/** Trang đồ thị HTML trong `<root>/.nexgraph/` (thẻ Sơ đồ, ADR 0024). */
export function registerGraphPagesIpc(ctx: IpcContext, preloadDir: string): void {
  const { onTrusted, api, rootOf } = ctx
  ctx.onProjectRemove((pid) => { pageRoots.delete(pid) })
  // NG-UI-1: trang HTML trong <root>/.nexgraph/. Đăng ký gốc dự án TẠI ĐÂY (chỉ dự án đã mở mới
  // phục vụ được qua nxpage://) và chỉ trả tên tệp, không trả đường dẫn tuyệt đối cho renderer.
  onTrusted('graph-pages:status', async (pid: string) => {
    const root = await rootOf(pid)
    const files = await discoverGraphPages(root)
    pageRoots.set(pid, root)
    return { ...files, partition: PAGES_PARTITION, preload: pathToFileURL(join(preloadDir, 'graphPage.js')).toString() }
  })
  // NG-UI-3: cầu nối chọn nút từ khung nhúng → panel của app. Chỉ nhận từ main frame của guest
  // đã đăng ký (guestBinding) và chỉ gửi về đúng owner; owner mất thì bỏ tin, không fallback.
  // `on?.` vì test main giả lập ipcMain chỉ có `handle`; tiến trình thật luôn có `on`.
  ipcMain.on?.(PAGE_NODE_CHANNEL, (event, payload: unknown) => {
    const sender = event.sender
    const binding = guestBinding(sender.id)
    void handlePageNodeMessage({
      sender, senderFrame: event.senderFrame, binding, payload,
      getNode: (projectId, id) => api().getNode(projectId, id),
      // graph.html dùng id của Graphify (khác id graph.db) và không xuất source_location.
      getPageNode: async (root, id) => (await readGraphJsonIndex(root)).get(id) ?? null
    })
      .then((result) => {
        if (!result || !binding) return
        // Tra nút là async: reload/đổi trang/đổi dự án có thể đã huỷ guest hoặc đổi binding.
        // Gửi kết quả của trang cũ vào renderer là sai, kể cả khi cửa sổ chủ vẫn mở.
        deliverLateSelection({
          guest: sender,
          snapshot: binding,
          current: guestBinding(sender.id),
          owner: webContents.fromId(binding.ownerId),
          selection: result.selection
        })
      })
      .catch(() => { /* trang hỏng không được làm chết main */ })
  })
}
