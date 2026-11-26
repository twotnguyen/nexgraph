// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseNavigation, type NavigationEntry } from './navigationHistory'

const key = (projectId: string) => `nexgraph.navigation:${projectId}`
// Nạp lại module có chủ đích: kiểm tra bộ nhớ đệm đọc lại localStorage như lúc khởi động lại.
const fresh = async () => { vi.resetModules(); return await import('./navigationHistory') }
const at = (file: string, line: number, column = 1): NavigationEntry => ({ file, line, column })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('lịch sử điều hướng', () => {
  it('ghi vị trí đã mở theo dự án và đi lại trước/sau sau khi nạp lại module', async () => {
    const store = await fresh()
    expect(store.navigationBack('p1')).toBeNull()
    store.recordNavigation('p1', at('lib/a.dart', 3, 5))
    store.recordNavigation('p1', at('lib/b.dart', 9))
    store.recordNavigation('p2', at('lib/c.dart', 2))
    store.recordNavigation('p2', at('lib/d.dart', 4))
    expect(JSON.parse(localStorage.getItem(key('p1')) ?? 'null')).toEqual({
      entries: [at('lib/a.dart', 3, 5), at('lib/b.dart', 9)], index: 1
    })

    const reopened = await fresh()
    expect(reopened.navigationBack('p1')).toEqual(at('lib/a.dart', 3, 5))
    expect(reopened.navigationBack('p1')).toBeNull()
    expect(reopened.navigationForward('p1')).toEqual(at('lib/b.dart', 9))
    expect(reopened.navigationForward('p1')).toBeNull()
    expect(reopened.navigationBack('p2')).toEqual(at('lib/c.dart', 2))
  })

  it('không ghi hai vị trí liên tiếp trùng nhau, kể cả cùng dòng nhưng khác cột', async () => {
    const store = await fresh()
    store.recordNavigation('p1', at('a.ts', 1))
    store.recordNavigation('p1', at('a.ts', 1))
    store.recordNavigation('p1', at('a.ts', 1, 4))
    store.recordNavigation('p1', at('a.ts', 1, 4))
    expect(JSON.parse(localStorage.getItem(key('p1')) ?? 'null').entries).toEqual([at('a.ts', 1), at('a.ts', 1, 4)])
  })

  it('mở vị trí mới sau khi đi lùi thì bỏ lịch sử đi tới', async () => {
    const store = await fresh()
    store.recordNavigation('p1', at('a.ts', 1))
    store.recordNavigation('p1', at('b.ts', 2))
    store.recordNavigation('p1', at('c.ts', 3))
    expect(store.navigationBack('p1')).toEqual(at('b.ts', 2))
    expect(store.navigationBack('p1')).toEqual(at('a.ts', 1))
    store.recordNavigation('p1', at('d.ts', 4))
    expect(store.navigationForward('p1')).toBeNull()
    expect(store.navigationBack('p1')).toEqual(at('a.ts', 1))
  })

  it('giữ tối đa 100 mục, bỏ mục cũ nhất', async () => {
    const store = await fresh()
    for (let line = 1; line <= 105; line++) store.recordNavigation('p1', at('a.ts', line))
    const saved = JSON.parse(localStorage.getItem(key('p1')) ?? 'null')
    expect(saved.entries).toHaveLength(100)
    expect(saved.entries[0]).toEqual(at('a.ts', 6))
    expect(saved.index).toBe(99)
    expect(store.navigationBack('p1')).toEqual(at('a.ts', 104))
  })

  it('bỏ dữ liệu hỏng khi đọc và vẫn đi lại được khi localStorage lỗi', async () => {
    expect(parseNavigation('{hỏng')).toEqual({ entries: [], index: -1 })
    expect(parseNavigation(JSON.stringify({ entries: [null, { file: '', line: 1 }, at('a.ts', 0), at('b.ts', 2)], index: 99 }))).toEqual({
      entries: [at('b.ts', 2)], index: 0
    })

    const store = await fresh()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bị khoá') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('đầy') })
    store.recordNavigation('p1', at('a.ts', 1))
    store.recordNavigation('p1', at('b.ts', 2))
    expect(store.navigationBack('p1')).toEqual(at('a.ts', 1))
  })
})
