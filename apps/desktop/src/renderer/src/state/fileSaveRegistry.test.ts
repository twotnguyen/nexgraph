// PR #49 (N1): Hoàn tác tệp = đọc lại nội dung hiện tại trên đĩa (FileSaver.revert), không phụ
// thuộc git. Test khoá đường đi qua registry của thẻ đang mở, để lệnh menu File không gọi
// git.restore (xoá cả thay đổi đã commit) như bản đầu của PR.
import { describe, expect, it, vi } from 'vitest'
import { registerFileSaver, revertFile } from './fileSaveRegistry'

describe('revertFile', () => {
  it('gọi revert của thẻ đang mở và trả kết quả', async () => {
    const revert = vi.fn(async () => true)
    const off = registerFileSaver('p1', 'a.ts', { save: async () => true, saveAs: async () => {}, revert })
    expect(await revertFile('p1', 'a.ts')).toBe('reverted')
    expect(revert).toHaveBeenCalledOnce()
    off()
  })

  it('thẻ không còn mở → unsupported; revert lỗi → failed', async () => {
    expect(await revertFile('p1', 'gone.ts')).toBe('unsupported')
    const off = registerFileSaver('p1', 'b.ts', { save: async () => true, saveAs: async () => {}, revert: async () => false })
    expect(await revertFile('p1', 'b.ts')).toBe('failed')
    off()
  })

  it('thẻ không đăng ký revert (saver cũ) → unsupported, không ném lỗi', async () => {
    const off = registerFileSaver('p1', 'c.ts', { save: async () => true, saveAs: async () => {} })
    expect(await revertFile('p1', 'c.ts')).toBe('unsupported')
    off()
  })
})
