import type { Citation, GraphEdge, GraphNode, PathResult } from '@nexgraph/contracts/graph-types'
import { vi } from '../../i18n/strings'

export type FlowHighlight = {
  /** Mọi nút được trích dẫn định vị được trong graph — luôn tô, kể cả khi không có cạnh. */
  nodes: GraphNode[]
  /** Cạnh của các đường đi ngắn nhất tìm được (có thể rỗng). */
  edges: GraphEdge[]
  /** Ghi chú cho người dùng khi thiếu liên kết; null khi mọi cặp đều nối được. */
  note: string | null
}

export type FlowDeps = {
  locate(projectId: string, file: string, line: number): Promise<{ node: GraphNode }>
  paths(projectId: string, nodeIds: string[]): Promise<PathResult>
}

const MAX_IDS = 10

/**
 * "Tô luồng trên graph" (A2-F5). Trước đây chỉ hỏi đường đi của các cặp liền nhau và khi một cặp
 * không có cạnh trực tiếp thì bỏ luôn cả cạnh lẫn nút, người dùng chỉ thấy toast "không tìm thấy
 * liên kết trực tiếp". Nay: luôn trả các nút được trích dẫn, thử nối mỗi nút với mọi nút đã có
 * (đường đi ngắn nhất), và chỉ báo thiếu khi thật sự không có đường.
 */
export async function highlightFlow(projectId: string, citations: readonly Citation[], deps: FlowDeps): Promise<FlowHighlight> {
  const located = new Map<string, GraphNode>()
  const ids: string[] = []
  for (const c of citations.filter((x) => x.valid)) {
    try {
      const { node } = await deps.locate(projectId, c.file, c.start)
      if (!located.has(node.id)) { located.set(node.id, node); ids.push(node.id) }
    } catch { /* trích dẫn không định vị được trong graph thì bỏ qua */ }
    if (ids.length >= MAX_IDS) break
  }
  if (ids.length < 2) return { nodes: [], edges: [], note: vi.chat.highlightNone }

  const nodes = new Map<string, GraphNode>(located)
  const edges = new Map<number, GraphEdge>()
  const included: string[] = [ids[0]]
  let missing = 0
  for (const id of ids.slice(1)) {
    // Nút liền trước trước, rồi mọi nút đã có: một cặp không nối được không làm mất đường khác.
    let linked = false
    for (const anchor of [included[included.length - 1], ...included.slice(0, -1)]) {
      const result = await deps.paths(projectId, [anchor, id])
      for (const n of result.nodes) nodes.set(n.id, n)
      for (const e of result.edges) edges.set(e.id, e)
      if (result.unconnected.length === 0) { linked = true; break }
    }
    if (!linked) missing++
    included.push(id)
  }
  const list = [...nodes.values()]
  return {
    nodes: list,
    edges: [...edges.values()],
    note: missing === 0 ? null : vi.path.partial(list.length, missing)
  }
}
