// NG-UI-3: cầu nối chọn nút của trang → panel nhỏ trong app.
// Preload của trang gửi {id, label, source_file}; main xác thực người gửi + payload rồi tra
// `source_location` từ engine (route node hiện có) trước khi chuyển cho renderer.
import type { GraphNode } from '@shared/graph-types'
import { GRAPH_PAGE_NODE_CHANNEL, GRAPH_PAGE_NODE_SELECTED } from '@shared/graph-pages'
import { projectFromPageUrl } from './protocol'

export const PAGE_NODE_CHANNEL = GRAPH_PAGE_NODE_CHANNEL
export const PAGE_NODE_SELECTED = GRAPH_PAGE_NODE_SELECTED

export interface PageNodePayload {
  id: string
  label: string | null
  source_file: string | null
  source_location: string | null
  via: string | null
}

/** Nút người dùng vừa chọn, đã làm giàu bằng dữ liệu engine. */
export interface GraphPageSelection {
  projectId: string
  id: string
  label: string
  sourceFile: string | null
  sourceLine: number | null
  sourceLocation: string | null
  via: string | null
}

const clean = (value: unknown, max: number): string | null => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null

/** Payload từ trang là dữ liệu không tin cậy: chỉ nhận đúng hình dạng, cắt độ dài. */
export function validatePageNode(payload: unknown): PageNodePayload | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>
  const id = clean(raw.id, 512)
  // Preload gửi tin nhắn khởi động/theme với id `__bridge__`, `__boot__` — không phải nút người dùng chọn.
  if (!id || id.startsWith('__')) return null
  return { id, label: clean(raw.label, 2000), source_file: clean(raw.source_file, 1024), source_location: clean(raw.source_location, 1024), via: clean(raw.via, 64) }
}

export interface SenderLike {
  getType(): string
  getURL(): string
  hostWebContents?: { send(channel: string, payload: unknown): void } | null
}

/** `file:12`/`file:12-14` → dòng đầu; trang Graphify không xuất trường này nên đây là nguồn dự phòng. */
export function lineFromLocation(location: string | null): number | null {
  const match = location?.match(/:(\d+)/)
  return match ? Number(match[1]) : null
}

/**
 * Xử lý một thông điệp chọn nút. Trả null khi người gửi không phải khung trang của app
 * hoặc payload sai — không ném lỗi để một trang hỏng không làm chết main.
 */
export async function handlePageNodeMessage(args: {
  sender: SenderLike | null | undefined
  payload: unknown
  getNode(projectId: string, id: string): Promise<GraphNode>
  /** Nguồn dự phòng cho id của Graphify (khác id graph.db): tra trong `.nexgraph/graph.json`. */
  getPageNode?(projectId: string, id: string): Promise<{ file: string | null; line: number | null } | null>
}): Promise<{ projectId: string; selection: GraphPageSelection } | null> {
  const { sender } = args
  if (!sender || sender.getType() !== 'webview') return null
  const projectId = projectFromPageUrl(sender.getURL())
  if (!projectId) return null
  const payload = validatePageNode(args.payload)
  if (!payload) return null
  let node: GraphNode | null = null
  try {
    node = await args.getNode(projectId, payload.id)
  } catch {
    // Nút cộng đồng của đồ thị bị gộp hoặc engine chưa sẵn sàng: thử chỉ mục graph.json.
  }
  let pageNode: { file: string | null; line: number | null } | null = null
  if (!node && args.getPageNode) {
    try {
      pageNode = await args.getPageNode(projectId, payload.id)
    } catch {
      // Không có graph.json: dùng thông tin trang gửi.
    }
  }
  const sourceFile = node?.file ?? pageNode?.file ?? payload.source_file
  const sourceLine = node?.line_start ?? pageNode?.line ?? lineFromLocation(payload.source_location)
  return {
    projectId,
    selection: {
      projectId,
      id: payload.id,
      label: node?.label ?? payload.label ?? payload.id,
      sourceFile: sourceFile ?? null,
      sourceLine: sourceLine ?? null,
      sourceLocation: sourceFile ? `${sourceFile}${sourceLine ? `:${sourceLine}` : ''}` : payload.source_location,
      via: payload.via
    }
  }
}
