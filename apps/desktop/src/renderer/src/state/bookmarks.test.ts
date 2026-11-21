// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextBookmark, parseBookmarks, type Bookmark } from './bookmarks'

const key = (projectId: string) => `nexgraph.bookmarks:${projectId}`
/** Nạp lại module để kiểm tra dữ liệu đọc từ localStorage như sau khi khởi động lại. */
const fresh = async () => { vi.resetModules(); return await import('./bookmarks') }

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('kho đánh dấu dòng', () => {
  it('lưu theo dự án, đọc lại sau khi nạp lại module', async () => {
    const store = await fresh()
    store.toggleBookmark('p1', 'lib/a.dart', 4)
    store.toggleBookmark('p2', 'lib/b.dart', 9)
    expect(JSON.parse(localStorage.getItem(key('p1')) ?? 'null')).toEqual([{ file: 'lib/a.dart', line: 4 }])

    const reopened = await fresh()
    expect(reopened.listBookmarks('p1')).toEqual([{ file: 'lib/a.dart', line: 4 }])
    expect(reopened.listBookmarks('p2')).toEqual([{ file: 'lib/b.dart', line: 9 }])
    expect(reopened.listBookmarks('p3')).toEqual([])
  })

  it('mỗi dòng chỉ một mốc; đánh dấu lần hai thì bỏ mốc', async () => {
    const store = await fresh()
    store.toggleBookmark('p1', 'lib/a.dart', 4)
    store.toggleBookmark('p1', 'lib/a.dart', 4)
    expect(store.listBookmarks('p1')).toEqual([])
    store.toggleBookmark('p1', 'lib/a.dart', 4)
    store.setBookmarkLabel('p1', 'lib/a.dart', 4, 'chỗ này')
    store.setBookmarkLabel('p1', 'lib/a.dart', 4, 'đổi tên')
    expect(store.listBookmarks('p1')).toEqual([{ file: 'lib/a.dart', line: 4, label: 'đổi tên' }])
  })

  it('bỏ mục hỏng và trùng khi đọc dữ liệu cũ', () => {
    expect(parseBookmarks('{hỏng')).toEqual([])
    expect(parseBookmarks('{}')).toEqual([])
    expect(parseBookmarks(JSON.stringify([
      null, 3, { file: '', line: 1 }, { file: 'a.dart', line: 0 }, { file: 'b.dart', line: 1.5 },
      { file: 'a.dart', line: 2, label: 'giữ' }, { file: 'a.dart', line: 2, label: 'bỏ' }
    ]))).toEqual([{ file: 'a.dart', line: 2, label: 'giữ' }])
  })

  it('báo người đăng ký rồi ngừng báo sau khi huỷ', async () => {
    const store = await fresh()
    const cb = vi.fn()
    const off = store.subscribeBookmarks(cb)
    store.toggleBookmark('p1', 'a.dart', 1)
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    store.setBookmarkLabel('p1', 'a.dart', 1, 'x')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('localStorage lỗi thì vẫn bật/tắt được trong phiên', async () => {
    const store = await fresh()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bị khoá') })
    expect(store.listBookmarks('p1')).toEqual([])
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('đầy') })
    store.toggleBookmark('p1', 'a.dart', 5)
    expect(store.listBookmarks('p1')).toEqual([{ file: 'a.dart', line: 5 }])
  })
})

describe('mốc kế tiếp', () => {
  const list: Bookmark[] = [
    { file: 'b.dart', line: 2 }, { file: 'a.dart', line: 9 }, { file: 'a.dart', line: 3 }
  ]

  it('đi tới/go trước theo file và dòng', () => {
    expect(nextBookmark(list, 'a.dart', 3, 1)).toEqual({ file: 'a.dart', line: 9 })
    expect(nextBookmark(list, 'a.dart', 9, -1)).toEqual({ file: 'a.dart', line: 3 })
    expect(nextBookmark(list, 'a.dart', 5, 1)).toEqual({ file: 'a.dart', line: 9 })
    expect(nextBookmark(list, 'a.dart', 5, -1)).toEqual({ file: 'a.dart', line: 3 })
  })

  it('quay vòng ở hai đầu', () => {
    expect(nextBookmark(list, 'b.dart', 2, 1)).toEqual({ file: 'a.dart', line: 3 })
    expect(nextBookmark(list, 'a.dart', 3, -1)).toEqual({ file: 'b.dart', line: 2 })
    expect(nextBookmark([], 'a.dart', 1, 1)).toBeNull()
  })
})
