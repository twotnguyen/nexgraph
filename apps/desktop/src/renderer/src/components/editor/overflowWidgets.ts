/**
 * Khung chứa widget tràn (hover, suggest, parameter hints, rename) của Monaco.
 *
 * monaco-editor 0.57 không còn CSS định vị `.overflowingContentWidgets`. Khi không cấp
 * `overflowWidgetsDomNode`, khung đó là phần tử tĩnh nằm sau `.overflow-guard` nên rơi xuống đáy
 * editor; widget tràn dùng toạ độ editor-relative, mà containing block của chúng lại là phần tử có
 * `position` gần nhất phía trên — mỗi màn hình một khác. Cấp khung riêng 0×0 ở gốc container để gốc
 * toạ độ của widget luôn trùng gốc editor, không phụ thuộc bố cục bên ngoài.
 *
 * Node mang class `monaco-editor` để widget nhận đúng CSS và biến theme của Monaco.
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

/**
 * Gắn khung vào đúng container của editor (sau khi `monaco.editor.create` đã dựng DOM). Container
 * phải là gốc định vị để khung nằm ở 0,0 của editor; `position: static` thì nâng lên `relative`
 * (không đổi kích thước, chỉ tạo containing block). Trả về hàm gỡ khung và khôi phục `position`.
 */
export function mountOverflowWidgets(container: HTMLElement, host: HTMLElement): () => void {
  const wasStatic = getComputedStyle(container).position === 'static'
  if (wasStatic) container.style.position = 'relative'
  container.appendChild(host)
  return () => {
    host.remove()
    if (wasStatic && container.style.position === 'relative') container.style.removeProperty('position')
  }
}
