import type { MessageBoxSyncOptions } from 'electron'

export const UNLOAD_DIALOG: MessageBoxSyncOptions = {
  type: 'warning',
  title: 'Còn tệp chưa lưu',
  message: 'Một số tệp chưa được lưu. Đóng cửa sổ sẽ mất các thay đổi.',
  buttons: ['Ở lại', 'Đóng và bỏ thay đổi'],
  defaultId: 0,
  cancelId: 0
}

/** Renderer chặn unload khi còn tệp chưa lưu; true = người dùng chọn đóng và bỏ thay đổi. */
export const confirmUnload = (show: (o: MessageBoxSyncOptions) => number): boolean => show(UNLOAD_DIALOG) === 1

/** Tải lại/đổi trang ở khung chính làm mất giao diện duyệt: phải đóng phiên agent để không còn yêu cầu không ai trả lời. */
export const closesAgents = (d: { isMainFrame: boolean; isSameDocument: boolean }): boolean => d.isMainFrame && !d.isSameDocument
