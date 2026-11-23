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

const HOVER_WIDGET_ID = 'editor.contrib.resizableContentHoverWidget'

/**
 * Giữ hover bám đúng token khi khung của nó đổi kích thước.
 *
 * Monaco 0.57 đo kích thước widget tràn ở lần render đầu rồi cache lại (`Widget._prepareRenderWidget`).
 * Nội dung hover do LSP trả về được render bất đồng bộ, nên lúc đo khung `.monaco-resizable-hover`
 * vẫn đang bị Monaco phồng lên bằng kích thước editor (`_removeConstraintsRenderNormally`); chiều
 * cao cache vì thế là chiều cao editor và `top` được đặt thành `anchor - editorHeight`. Khi nội dung
 * vào, khung co lại nhưng Monaco chỉ đặt lại `top` lúc widget đổi vị trí, nên hover nằm ngoài khung
 * nhìn đúng một chiều cao editor. Không thể sửa bằng gốc khung: đặt khung ở đáy editor thì hover
 * đúng nhưng suggest/parameter hints/rename lệch xuống đúng bằng chiều cao editor.
 *
 * Bất biến cần giữ: `anchor = top + height`. Khi chiều cao đổi mà `top` không được ghi lại, đặt
 * `top = anchor - height`. Nếu chính Monaco vừa ghi `top` mới thì cập nhật mốc neo theo cặp đó.
 * Trả về hàm gỡ theo dõi.
 */
export function keepOverflowHoverAnchored(host: HTMLElement): () => void {
  if (typeof MutationObserver === 'undefined' || typeof ResizeObserver === 'undefined') return () => {}
  let observed: HTMLElement | null = null
  let stopObserving: (() => void) | null = null

  const watch = (): void => {
    const el = host.querySelector<HTMLElement>(`[widgetid="${HOVER_WIDGET_ID}"]`)
    if (!el || el === observed) return
    stopObserving?.()
    observed = el
    let lastTop = parseFloat(el.style.top) || 0
    let lastHeight = Math.round(el.getBoundingClientRect().height)
    // Cặp (top, height) lúc gắn đã do Monaco đặt cho nhau nên hiệu của chúng là mốc neo thật.
    let anchor = lastTop + lastHeight
    const observer = new ResizeObserver(() => {
      const height = Math.round(el.getBoundingClientRect().height)
      if (height === lastHeight) {
        lastTop = parseFloat(el.style.top) || 0
        return
      }
      const top = parseFloat(el.style.top) || 0
      if (top !== lastTop) {
        anchor = top + height
      } else if (height > 0 && getComputedStyle(el).display !== 'none') {
        el.style.top = `${anchor - height}px`
      }
      lastTop = parseFloat(el.style.top) || 0
      lastHeight = height
    })
    observer.observe(el)
    stopObserving = () => observer.disconnect()
  }

  const mutations = new MutationObserver(watch)
  mutations.observe(host, { childList: true, subtree: true })
  watch()
  return () => {
    mutations.disconnect()
    stopObserving?.()
    stopObserving = null
    observed = null
  }
}
