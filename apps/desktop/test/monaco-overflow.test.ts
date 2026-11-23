// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mountOverflowWidgets, overflowWidgetsHost } from '../src/renderer/src/components/editor/overflowWidgets'

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
