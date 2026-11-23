// PR #49 vòng 2 (Important 2): tài nguyên dùng chung của app (phiên agent, terminal) thuộc về
// cửa sổ đã mở nó — reload/crash/đóng một cửa sổ chỉ được dọn tài nguyên của chính cửa sổ đó.
import { describe, expect, it } from 'vitest'
import { WindowOwners } from '../src/main/window-owners'

describe('WindowOwners', () => {
  it('cửa sổ đầu tiên mở phiên là chủ; cửa sổ khác không giành mất phiên đang sống', () => {
    const owners = new WindowOwners<object>()
    const a = {}
    const b = {}
    owners.claim('p1', a)
    owners.claim('p1', b)
    expect(owners.ownerOf('p1')).toBe(a)
    expect(owners.size).toBe(1)
  })

  it('lượt mới (assign) chuyển chủ để sự kiện của lượt đó về đúng cửa sổ đã gửi', () => {
    const owners = new WindowOwners<object>()
    const a = {}
    const b = {}
    owners.assign('p1', a)
    owners.assign('p1', b)
    expect(owners.ownerOf('p1')).toBe(b)
  })

  it('release chỉ trả khoá của đúng cửa sổ, không đụng cửa sổ khác', () => {
    const owners = new WindowOwners<object>()
    const a = {}
    const b = {}
    owners.claim('p1', a)
    owners.claim('p2', b)
    owners.claim('p3', a)
    expect(owners.release(a).sort()).toEqual(['p1', 'p3'])
    expect(owners.ownerOf('p1')).toBeUndefined()
    expect(owners.ownerOf('p2')).toBe(b)
    expect(owners.ownerOf('p3')).toBeUndefined()
    expect(owners.size).toBe(1)
  })

  it('forget bỏ chủ của đúng một khoá, khoá khác giữ nguyên', () => {
    const owners = new WindowOwners<object>()
    const a = {}
    const b = {}
    owners.claim('p1', a)
    owners.claim('p2', b)
    owners.forget('p1')
    expect(owners.ownerOf('p1')).toBeUndefined()
    expect(owners.ownerOf('p2')).toBe(b)
    expect(owners.size).toBe(1)
  })

  it('release một cửa sổ không sở hữu gì không đổi trạng thái', () => {
    const owners = new WindowOwners<object>()
    const a = {}
    owners.claim('p1', a)
    expect(owners.release({})).toEqual([])
    expect(owners.ownerOf('p1')).toBe(a)
  })
})
