import type * as monaco from 'monaco-editor/editor/editor.api.js'

type OverflowOptions = Pick<monaco.editor.IEditorConstructionOptions, 'overflowWidgetsDomNode'>

/**
 * Khung chứa widget tràn (hover, suggest, parameter hints, rename) của Monaco.
 *
 * monaco-editor 0.57 đổi `.overflow-guard` sang `position: relative` (trước là `absolute`) và không
 * kèm CSS định vị `.overflowingContentWidgets`. Khung đó nằm trong luồng ngay sau guard nên rơi
 * xuống đáy editor, còn widget tràn được tính toạ độ theo gốc editor → lệch đúng bằng chiều cao
 * editor (hover vẽ ra ngoài khung nhìn). Sửa bằng CSS lên chính khung đó sẽ đổi containing block
 * của mọi widget tràn và đẩy suggest/parameter hints/rename lệch theo, nên không dùng.
 *
 * Cách chuẩn của Monaco: cấp `overflowWidgetsDomNode` riêng, gắn ở gốc editor (0,0 của khung chứa)
 * để toạ độ editor-relative của widget khớp đúng chỗ. Node mang class `monaco-editor` để widget
 * nhận đúng CSS và biến theme.
 */
export function overflowWidgetsHost(): HTMLElement {
  const node = document.createElement('div')
  node.className = 'monaco-editor ne-overflow-widgets'
  node.style.position = 'absolute'
  node.style.top = '0'
  node.style.left = '0'
  node.style.width = '0'
  node.style.height = '0'
  node.style.overflow = 'visible'
  return node
}

export function overflowWidgetsOptions(): OverflowOptions {
  return { overflowWidgetsDomNode: overflowWidgetsHost() }
}

/**
 * Gắn khung vào đúng container của editor (sau khi `monaco.editor.create` đã dựng DOM). Container
 * phải là gốc định vị để khung nằm ở 0,0 của editor; `position: static` thì nâng lên `relative`
 * (không đổi kích thước, chỉ tạo containing block).
 */
export function mountOverflowWidgets(container: HTMLElement, host: HTMLElement): void {
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative'
  container.appendChild(host)
}
