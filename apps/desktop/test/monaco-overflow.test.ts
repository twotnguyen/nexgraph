// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keepOverflowHoverAnchored, mountOverflowWidgets, overflowWidgetsHost } from '../src/renderer/src/components/editor/overflowWidgets'

// BUG-B: monaco 0.57 đổi `.overflow-guard` sang `position: relative` và không kèm CSS định vị
// `.overflowingContentWidgets`; khung mặc định rơi xuống đáy editor nên widget tràn (hover…) bị
// cộng chiều cao editor. Cách sửa: cấp `overflowWidgetsDomNode` riêng, gắn ở 0,0 của container
// editor để toạ độ editor-relative của Monaco khớp đúng — không đổi containing block của widget.
describe('khung chứa widget tràn của Monaco', () => {
  it('tạo khung 0×0 ở gốc container, không cắt widget con và mang class monaco-editor', () => {
    const node = overflowWidgetsHost()
    expect(node.className).toContain('monaco-editor')
    expect(node.style.position).toBe('absolute')
    expect(node.style.top).toBe('0px')
    expect(node.style.left).toBe('0px')
    expect(node.style.width).toBe('0px')
    expect(node.style.height).toBe('0px')
    expect(node.style.overflow).toBe('visible')
  })

  it('mỗi editor một khung riêng để gỡ editor không mất widget của editor khác', () => {
    expect(overflowWidgetsHost()).not.toBe(overflowWidgetsHost())
  })

  it('gắn khung vào container và nâng container tĩnh lên relative để khung nằm đúng gốc editor', () => {
    const container = document.createElement('div')
    const host = overflowWidgetsHost()
    mountOverflowWidgets(container, host)
    expect(host.parentElement).toBe(container)
    expect(container.style.position).toBe('relative')

    const fixed = document.createElement('div')
    fixed.style.position = 'absolute'
    mountOverflowWidgets(fixed, overflowWidgetsHost())
    expect(fixed.style.position).toBe('absolute')
  })
})

// Hover của Monaco đo chiều cao widget ở lần render đầu; nội dung LSP/markdown về sau nên lúc đo
// khung `.monaco-resizable-hover` còn bị phồng bằng kích thước editor. Monaco cache chiều cao đó
// và chỉ đặt lại `top` khi widget đổi vị trí — nên khi khung co lại, hover lệch đúng một chiều cao
// editor. Giữ bất biến `anchor = top + height`: chiều cao đổi mà `top` không được ghi lại thì đặt
// `top = anchor - height`.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  readonly targets: Element[] = []
  constructor(private readonly cb: ResizeObserverCallback) { FakeResizeObserver.instances.push(this) }
  observe(target: Element): void { this.targets.push(target) }
  unobserve(): void {}
  disconnect(): void { this.targets.length = 0 }
  trigger(): void {
    const entries = this.targets.map((target) => ({ target } as unknown as ResizeObserverEntry))
    this.cb(entries, this as unknown as ResizeObserver)
  }
}

const rect = (height: number) => ({ height, width: 320, top: 0, left: 0, right: 320, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const hoverNode = (host: HTMLElement) => {
  const el = document.createElement('div')
  el.setAttribute('widgetid', 'editor.contrib.resizableContentHoverWidget')
  host.appendChild(el)
  return el
}

describe('giữ hover bám đúng mốc khi khung đổi kích thước', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('đặt lại top khi khung co từ chiều cao editor về chiều cao nội dung thật', async () => {
    const host = overflowWidgetsHost()
    const el = hoverNode(host)
    let height = 582
    el.getBoundingClientRect = () => rect(height)
    // Monaco đặt top theo chiều cao phồng 582 ⇒ mốc neo thật là top + height = -542 + 582 = 40.
    el.style.top = '-542px'
    const stop = keepOverflowHoverAnchored(host)
    await flush()

    expect(FakeResizeObserver.instances).toHaveLength(1)
    height = 50
    FakeResizeObserver.instances[0].trigger()
    expect(el.style.top).toBe('-10px')

    stop()
  })

  it('không sửa top khi chính Monaco vừa đặt lại vị trí cho kích thước mới', async () => {
    const host = overflowWidgetsHost()
    const el = hoverNode(host)
    let height = 60
    el.getBoundingClientRect = () => rect(height)
    el.style.top = '-70px'
    const stop = keepOverflowHoverAnchored(host)
    await flush()

    // Monaco ghi top mới cho cùng kích thước ⇒ mốc neo mới = -70 + 60 = -10.
    el.style.top = '-70px'
    FakeResizeObserver.instances[0].trigger()
    expect(el.style.top).toBe('-70px')

    // Nội dung cao lên 80, top không được ghi lại ⇒ giữ mốc neo: -10 - 80 = -90.
    height = 80
    FakeResizeObserver.instances[0].trigger()
    expect(el.style.top).toBe('-90px')

    stop()
  })

  it('bỏ qua lúc hover ẩn để không ghi top rác', async () => {
    const host = overflowWidgetsHost()
    const el = hoverNode(host)
    let height = 582
    el.getBoundingClientRect = () => rect(height)
    el.style.top = '-542px'
    const stop = keepOverflowHoverAnchored(host)
    await flush()

    el.style.display = 'none'
    height = 0
    FakeResizeObserver.instances[0].trigger()
    expect(el.style.top).toBe('-542px')

    stop()
  })

  it('ngừng theo dõi sau khi dispose và chỉ theo dõi widget hover', async () => {
    const host = overflowWidgetsHost()
    const other = document.createElement('div')
    other.setAttribute('widgetid', 'editor.contrib.suggestWidget')
    host.appendChild(other)
    await flush()
    expect(FakeResizeObserver.instances).toHaveLength(0)

    const el = hoverNode(host)
    const stop = keepOverflowHoverAnchored(host)
    await flush()
    expect(FakeResizeObserver.instances).toHaveLength(1)

    stop()
    expect(FakeResizeObserver.instances[0].targets).toHaveLength(0)
  })
})
