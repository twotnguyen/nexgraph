import { describe, expect, it, vi } from 'vitest'
import { UNLOAD_DIALOG, closesAgents, confirmUnload } from '../src/main/unload-guard'

describe('confirmUnload', () => {
  it('chỉ cho đóng khi chọn "Đóng và bỏ thay đổi"; mặc định và Esc là "Ở lại"', () => {
    expect(UNLOAD_DIALOG).toMatchObject({
      title: 'Còn tệp chưa lưu',
      message: 'Một số tệp chưa được lưu. Đóng cửa sổ sẽ mất các thay đổi.',
      buttons: ['Ở lại', 'Đóng và bỏ thay đổi'], defaultId: 0, cancelId: 0
    })
    const show = vi.fn(() => 1)
    expect(confirmUnload(show)).toBe(true)
    expect(show).toHaveBeenCalledWith(UNLOAD_DIALOG)
    expect(confirmUnload(() => 0)).toBe(false)
  })
})

describe('closesAgents', () => {
  it('chỉ điều hướng khung chính sang tài liệu khác (tải lại, đổi trang) mới đóng phiên agent', () => {
    expect(closesAgents({ isMainFrame: true, isSameDocument: false })).toBe(true)
    expect(closesAgents({ isMainFrame: true, isSameDocument: true })).toBe(false)
    expect(closesAgents({ isMainFrame: false, isSameDocument: false })).toBe(false)
  })
})
