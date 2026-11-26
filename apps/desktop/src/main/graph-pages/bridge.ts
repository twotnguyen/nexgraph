// NG-UI-3: cầu nối chọn nút của trang → panel nhỏ trong app.
// Preload của trang gửi {id, label, source_file}; main xác thực người gửi + payload rồi tra
// `source_location` từ engine (route node hiện có) trước khi chuyển cho renderer.
import type { GraphNode } from '@shared/graph-types'
import { GRAPH_PAGE_NODE_CHANNEL, GRAPH_PAGE_NODE_SELECTED } from '@shared/graph-pages'
import { projectFromPageUrl, type GuestBinding } from './protocol'

export const PAGE_NODE_CHANNEL = GRAPH_PAGE_NODE_CHANNEL
export const PAGE_NODE_SELECTED = GRAPH_PAGE_NODE_SELECTED

export interface PageNodePayload {
  id: string
  label: string | null
  source_file: string | null
  source_location: string | null
  via: string | null
  community: number | null
  memberCount: number | null
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
  community: number | null
  memberCount: number | null
}

const clean = (value: unknown, max: number): string | null => typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
const count = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null

/** Payload từ trang là dữ liệu không tin cậy: chỉ nhận đúng hình dạng, cắt độ dài. */
export function validatePageNode(payload: unknown): PageNodePayload | null {
  if (!payload || typeof payload !== 'object') return null
  const raw = payload as Record<string, unknown>
  const id = clean(raw.id, 512)
  // Preload gửi tin nhắn khởi động/theme với id `__bridge__`, `__boot__` — không phải nút người dùng chọn.
  if (!id || id.startsWith('__')) return null
  return {
    id, label: clean(raw.label, 2000), source_file: clean(raw.source_file, 1024), source_location: clean(raw.source_location, 1024),
    via: clean(raw.via, 64), community: count(raw.community, 1_000_000), memberCount: count(raw.member_count, 1_000_000)
  }
}

export interface SenderLike {
  id: number
  getType(): string
  getURL(): string
}

/** Frame gửi IPC: chỉ main frame của guest (frame con/iframe bị bỏ). */
export interface SenderFrameLike { parent: unknown }

/** `file:12`/`file:12-14` → dòng đầu; trang Graphify không xuất trường này nên đây là nguồn dự phòng. */
export function lineFromLocation(location: string | null): number | null {
  const match = location?.match(/:(\d+)/)
  return match ? Number(match[1]) : null
}

/**
 * Xử lý một thông điệp chọn nút. Trả null khi người gửi không phải main frame của guest đã
 * đăng ký, URL khác dự án đã gắn, hoặc payload sai — không ném lỗi để trang hỏng không làm chết main.
 */
export async function handlePageNodeMessage(args: {
  sender: SenderLike | null | undefined
  senderFrame?: SenderFrameLike | null
  /** Binding ghi lúc will-attach-webview: guest ↔ owner ↔ dự án/gốc dự án. */
  binding: GuestBinding | null
  payload: unknown
  getNode(projectId: string, id: string): Promise<GraphNode>
  /** Nguồn dự phòng cho id của Graphify (khác id graph.db): tra trong `.nexgraph/graph.json`. */
  getPageNode?(root: string, id: string): Promise<{ file: string | null; line: number | null } | null>
}): Promise<{ ownerId: number; projectId: string; selection: GraphPageSelection } | null> {
  const { sender, senderFrame, binding } = args
  if (!sender || !senderFrame || senderFrame.parent !== null || sender.getType() !== 'webview') return null
  if (!binding || binding.guestId !== sender.id) return null
  const projectId = projectFromPageUrl(sender.getURL())
  if (!projectId || projectId !== binding.projectId) return null
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
      pageNode = await args.getPageNode(binding.root, payload.id)
    } catch {
      // Không có graph.json: dùng thông tin trang gửi.
    }
  }
  const sourceFile = node?.file ?? pageNode?.file ?? payload.source_file
  const sourceLine = node?.line_start ?? pageNode?.line ?? lineFromLocation(payload.source_location)
  return {
    ownerId: binding.ownerId,
    projectId,
    selection: {
      projectId,
      id: payload.id,
      label: node?.label ?? payload.label ?? payload.id,
      sourceFile: sourceFile ?? null,
      sourceLine: sourceLine ?? null,
      sourceLocation: sourceFile ? `${sourceFile}${sourceLine ? `:${sourceLine}` : ''}` : payload.source_location,
      via: payload.via,
      community: payload.community,
      memberCount: payload.memberCount
    }
  }
}

export interface OwnerContents {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

/**
 * Chỉ gửi cho đúng owner của guest; owner đã đóng/không còn thì BỎ tin,
 * không chuyển sang cửa sổ khác (tránh lộ dữ liệu dự án sang cửa sổ khác).
 */
export function deliverSelection(owner: OwnerContents | null | undefined, selection: GraphPageSelection): boolean {
  if (!owner || owner.isDestroyed()) return false
  owner.send(PAGE_NODE_SELECTED, selection)
  return true
}

/**
 * Gửi kết quả tra nút đến MUỘN. Giữa lúc nhận tin và lúc tra xong, guest có thể đã bị huỷ
 * (reload/đổi trang) hoặc binding đã đổi (guest mới, owner khác, dự án/gốc khác) — khi đó
 * kết quả thuộc về trang cũ nên phải bỏ, kể cả khi cửa sổ chủ vẫn mở.
 */
export function deliverLateSelection(args: {
  guest: { isDestroyed(): boolean } | null | undefined
  /** Binding chụp lúc nhận tin. */
  snapshot: GuestBinding
  /** Binding hiện hành của đúng guest id đó. */
  current: GuestBinding | null
  owner: OwnerContents | null | undefined
  selection: GraphPageSelection
}): boolean {
  const { guest, snapshot, current } = args
  const same = !!guest && !guest.isDestroyed() && !!current &&
    current.guestId === snapshot.guestId && current.ownerId === snapshot.ownerId &&
    current.projectId === snapshot.projectId && current.root === snapshot.root
  if (!same) return false
  return deliverSelection(args.owner, args.selection)
}
