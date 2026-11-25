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
