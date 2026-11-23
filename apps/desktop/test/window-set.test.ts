// PR #49 (N1): mở nhiều cửa sổ — cửa sổ mới không được chiếm chỗ cửa sổ chính, và chỉ khi
// cửa sổ cuối đóng mới dọn agent/engine (trước đây đóng một cửa sổ là dọn của tất cả).
import { describe, expect, it } from 'vitest'
import { WindowSet } from '../src/main/windows'

class FakeWindow {
  destroyed = false
  isDestroyed(): boolean { return this.destroyed }
}

describe('WindowSet', () => {
  it('cửa sổ chính là cửa sổ còn sống đầu tiên, cửa sổ mới không ghi đè', () => {
    const set = new WindowSet<FakeWindow>()
    const first = new FakeWindow()
    const second = new FakeWindow()
    set.add(first)
    set.add(second)
    expect(set.main()).toBe(first)
    expect(set.all()).toEqual([first, second])
    expect(set.size).toBe(2)
  })

  it('đóng cửa sổ chính thì chuyển sang cửa sổ còn sống, không báo rỗng', () => {
    const set = new WindowSet<FakeWindow>()
    const first = new FakeWindow()
    const second = new FakeWindow()
    set.add(first)
    set.add(second)
    first.destroyed = true
    expect(set.remove(first)).toEqual({ empty: false })
    expect(set.main()).toBe(second)
    expect(set.all()).toEqual([second])
  })

  it('đóng cửa sổ phụ không đổi cửa sổ chính', () => {
    const set = new WindowSet<FakeWindow>()
    const first = new FakeWindow()
    const second = new FakeWindow()
    set.add(first)
    set.add(second)
    second.destroyed = true
    expect(set.remove(second)).toEqual({ empty: false })
    expect(set.main()).toBe(first)
  })

  it('chỉ cửa sổ cuối đóng mới báo empty (mốc dọn agent)', () => {
    const set = new WindowSet<FakeWindow>()
    const first = new FakeWindow()
    const second = new FakeWindow()
    set.add(first)
    set.add(second)
    first.destroyed = true
    second.destroyed = true
    expect(set.remove(first)).toEqual({ empty: false })
    expect(set.remove(second)).toEqual({ empty: true })
    expect(set.main()).toBeNull()
    expect(set.all()).toEqual([])
  })
})
