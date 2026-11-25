// NG-UI-3: xác thực người gửi + payload của cầu nối chọn nút, ràng buộc guest/owner/dự án.
import { describe, expect, it, vi } from 'vitest'
import type { GraphNode } from '../src/shared/graph-types'
import {
  deliverLateSelection, deliverSelection, handlePageNodeMessage, lineFromLocation, validatePageNode
} from '../src/main/graph-pages/bridge'
import { pageUrl, type GuestBinding } from '../src/main/graph-pages/protocol'

vi.mock('electron', () => ({ protocol: { registerSchemesAsPrivileged: vi.fn() } }))

const binding = (over: Partial<GuestBinding> = {}): GuestBinding => ({ guestId: 7, ownerId: 3, projectId: 'pid-1', root: '/proj/one', ...over })
const sender = (over: { id?: number; type?: string; url?: string } = {}) => ({
  id: over.id ?? 7, getType: () => over.type ?? 'webview', getURL: () => over.url ?? pageUrl('pid-1', 'graph.html')
})
const mainFrame = { parent: null }
const subFrame = { parent: {} }
const node = (over: Partial<GraphNode> = {}): GraphNode => ({
  id: 'a.ts::run#function', kind: 'function' as GraphNode['kind'], label: 'run', qualified_name: 'run', language: 'typescript',
  file: 'src/a.ts', line_start: 12, line_end: 20, is_test: false, origin: 'ast', signature: null, community: null, ...over
})
const args = (over: Record<string, unknown> = {}) => ({
  sender: sender(), senderFrame: mainFrame, binding: binding(), payload: { id: 'n1', label: 'Nút' }, getNode: async () => node(), ...over
})

describe('payload từ trang', () => {
  it('nhận đúng hình dạng, cắt chuỗi quá dài', () => {
    expect(validatePageNode({ id: 'n1', label: 'Nút', source_file: 'a.ts', source_location: 'a.ts:3', via: 'showInfo' }))
      .toEqual({ id: 'n1', label: 'Nút', source_file: 'a.ts', source_location: 'a.ts:3', via: 'showInfo' })
    expect(validatePageNode({ id: 'n1', label: 'x'.repeat(2001) })?.label).toBeNull()
    expect(validatePageNode({ id: '__bridge__', bridge: true, via: 'boot' })).toBeNull()
    expect(validatePageNode({ id: '__boot__', via: 'boot' })).toBeNull()
    expect(validatePageNode({ label: 'no id' })).toBeNull()
    expect(validatePageNode('n1')).toBeNull()
    expect(validatePageNode({ id: 42 })).toBeNull()
  })
})

describe('cầu nối chọn nút', () => {
  it('tra source_location từ engine và chỉ nhận main frame của guest đã đăng ký', async () => {
    const getNode = vi.fn(async () => node())
    const good = await handlePageNodeMessage(args({ getNode }) as never)
    expect(good).toMatchObject({ ownerId: 3, projectId: 'pid-1' })
    expect(good?.selection).toMatchObject({ id: 'n1', label: 'run', sourceFile: 'src/a.ts', sourceLine: 12, sourceLocation: 'src/a.ts:12' })
    // sender không phải webview
    expect(await handlePageNodeMessage(args({ sender: sender({ type: 'window' }) }) as never)).toBeNull()
    // guest không có binding (không gắn qua will-attach-webview)
    expect(await handlePageNodeMessage(args({ binding: null }) as never)).toBeNull()
    // id guest khác binding
    expect(await handlePageNodeMessage(args({ sender: sender({ id: 8 }) }) as never)).toBeNull()
    // frame con (iframe) của trang
    expect(await handlePageNodeMessage(args({ senderFrame: subFrame }) as never)).toBeNull()
    expect(await handlePageNodeMessage(args({ senderFrame: null }) as never)).toBeNull()
    // URL của dự án khác
    expect(await handlePageNodeMessage(args({ sender: sender({ url: pageUrl('pid-2', 'graph.html') }) }) as never)).toBeNull()
    // payload sai
    expect(await handlePageNodeMessage(args({ payload: null }) as never)).toBeNull()
  })

  it('engine lỗi (id Graphify) → tra graph.json trong gốc dự án của binding', async () => {
    const getNode = vi.fn(async () => { throw new Error('not found') })
    const getPageNode = vi.fn(async () => ({ file: 'src/service/order.ts', line: 5 }))
    const result = await handlePageNodeMessage(args({ getNode, getPageNode, payload: { id: 'src_service_order_createorder', label: 'createOrder()' } }) as never)
    expect(getPageNode).toHaveBeenCalledWith('/proj/one', 'src_service_order_createorder')
    expect(result?.selection).toMatchObject({ label: 'createOrder()', sourceFile: 'src/service/order.ts', sourceLine: 5, sourceLocation: 'src/service/order.ts:5' })
  })

  it('engine lỗi (nút cộng đồng bị gộp) vẫn trả thông tin từ trang', async () => {
    const getNode = vi.fn(async () => { throw new Error('not found') })
    const result = await handlePageNodeMessage(args({ getNode, payload: { id: '12', label: 'Graphify Host API', source_file: 'a.ts', source_location: 'a.ts:44' } }) as never)
    expect(result?.selection).toMatchObject({ id: '12', label: 'Graphify Host API', sourceFile: 'a.ts', sourceLine: 44 })
    expect(lineFromLocation('a.ts:44-51')).toBe(44)
    expect(lineFromLocation(null)).toBeNull()
  })
})

describe('chỉ gửi tới đúng owner, mất host thì bỏ', () => {
  const selection = { projectId: 'pid-1', id: 'n1', label: 'run', sourceFile: null, sourceLine: null, sourceLocation: null, via: null }

  it('host còn sống → gửi đúng kênh; không có host/host đã đóng → không gửi, không fallback', () => {
    const owner = { isDestroyed: () => false, send: vi.fn() }
    expect(deliverSelection(owner, selection)).toBe(true)
    expect(owner.send).toHaveBeenCalledWith('graph-pages:node-selected', selection)
    expect(deliverSelection(null, selection)).toBe(false)
    expect(deliverSelection(undefined, selection)).toBe(false)
    const closed = { isDestroyed: () => true, send: vi.fn() }
    expect(deliverSelection(closed, selection)).toBe(false)
    expect(closed.send).not.toHaveBeenCalled()
  })
})

describe('phản hồi tra nút đến muộn sau khi guest/binding đổi', () => {
  const selection = { projectId: 'pid-1', id: 'n1', label: 'run', sourceFile: null, sourceLine: null, sourceLocation: null, via: null }
  const snapshot = binding()
  const liveOwner = () => ({ isDestroyed: () => false, send: vi.fn() })
  const liveGuest = () => ({ isDestroyed: () => false })

  it('guest đã bị huỷ → bỏ tin', () => {
    const owner = liveOwner()
    expect(deliverLateSelection({ guest: { isDestroyed: () => true }, snapshot, current: snapshot, owner, selection })).toBe(false)
    expect(owner.send).not.toHaveBeenCalled()
  })

  it('binding hiện hành khác snapshot (guest mới sau reload / owner khác / dự án khác) → bỏ tin', () => {
    for (const current of [
      binding({ guestId: 8, ownerId: 3 }),
      binding({ guestId: 7, ownerId: 4 }),
      binding({ guestId: 7, ownerId: 3, projectId: 'pid-2' }),
      binding({ guestId: 7, ownerId: 3, root: '/proj/two' })
    ]) {
      const owner = liveOwner()
      expect(deliverLateSelection({ guest: liveGuest(), snapshot, current, owner, selection }), JSON.stringify(current)).toBe(false)
      expect(owner.send).not.toHaveBeenCalled()
    }
    expect(deliverLateSelection({ guest: liveGuest(), snapshot, current: null, owner: liveOwner(), selection })).toBe(false)
  })

  it('guest còn sống + binding không đổi → gửi đúng kênh (đối chứng)', () => {
    const owner = liveOwner()
    expect(deliverLateSelection({ guest: liveGuest(), snapshot, current: snapshot, owner, selection })).toBe(true)
    expect(owner.send).toHaveBeenCalledWith('graph-pages:node-selected', selection)
  })

  it('owner đã đóng dù guest còn sống → bỏ tin', () => {
    const owner = { isDestroyed: () => true, send: vi.fn() }
    expect(deliverLateSelection({ guest: liveGuest(), snapshot, current: snapshot, owner, selection })).toBe(false)
    expect(owner.send).not.toHaveBeenCalled()
  })
})
