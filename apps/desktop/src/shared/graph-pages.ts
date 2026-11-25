/** Kiểu dữ liệu của chế độ xem các trang HTML trong `<root>/.nexgraph/` (ADR 0024). */

export interface GraphPagesStatus {
  /** Thư mục `.nexgraph` của dự án (để hiện trong thông báo khi thiếu trang). */
  dir: string
  graph: boolean
  tree: boolean
  /** Tên tệp `<project>-callflow.html` thật, null nếu chưa xuất. */
  callflow: string | null
  /** Partition + preload mà khung nhúng phải dùng (main kiểm lại khi gắn webview). */
  partition: string
  preload: string
}

/** Nút được chọn trong trang, đã làm giàu `source_location` từ engine. */
export interface GraphPageSelection {
  projectId: string
  id: string
  label: string
  sourceFile: string | null
  sourceLine: number | null
  sourceLocation: string | null
  via: string | null
}

/** Scheme + URL của khung nhúng; main đăng ký `nxpage` là scheme chuẩn (protocol.ts). */
export const GRAPH_PAGE_SCHEME = 'nxpage'
export const graphPageUrl = (projectId: string, file: string): string =>
  `${GRAPH_PAGE_SCHEME}://${projectId}/${encodeURIComponent(file)}`

/**
 * NG-ACT-1: "Mở mã" chỉ dùng được với tệp thật trong dự án. Nguồn ảo (`nguon://cargo`),
 * đường dẫn tuyệt đối và đường dẫn thoát ra ngoài (`..`) đều không mở được trong editor.
 */
export function canOpenPageSource(file: string | null | undefined): boolean {
  if (!file || file.includes('://')) return false
  if (file.startsWith('/') || file.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(file)) return false
  return !file.split(/[\\/]/).includes('..')
}

/** Kênh IPC giữa preload của trang, main và renderer của app (một chỗ để không lệch tên). */
export const GRAPH_PAGE_NODE_CHANNEL = 'graph-pages:node'
export const GRAPH_PAGE_NODE_SELECTED = 'graph-pages:node-selected'
export const GRAPH_PAGE_THEME_CHANNEL = 'nxpage:theme'
