import ELKApi, { type ElkNode } from 'elkjs/lib/elk-api'

export interface LayoutNode { id: string; width: number; height: number }
export interface LayoutEdge { id: string; source: string; target: string }
export type LayoutRunner = (graph: ElkNode) => Promise<ElkNode>

/** Dựng đồ thị đầu vào cho ELK; bỏ cạnh trỏ tới nút không có trong danh sách. */
export function toElkGraph(nodes: LayoutNode[], edges: LayoutEdge[]): ElkNode {
  const ids = new Set(nodes.map((n) => n.id))
  return {
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.spacing.nodeNode': '24', 'elk.layered.spacing.nodeNodeBetweenLayers': '80' },
    children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }))
  }
}

let elk: InstanceType<typeof ELKApi> | null = null

/**
 * Chạy ELK trong Web Worker để không làm đơ giao diện khi có tới ~2.000 nút. Theo cách dùng của elkjs:
 * `elk-api` ở luồng chính, `elk-worker.min.js` làm script Worker (không dùng được `elk.bundled.js` trong Worker).
 * Worker dạng module (electron.vite.config.ts đặt worker.format = 'es'); Vite bó sẵn tệp này khi build.
 */
const workerRunner: LayoutRunner = (graph) => {
  elk ??= new ELKApi({ workerFactory: () => new Worker(new URL('./elk.worker.ts', import.meta.url), { type: 'module' }) })
  return elk.layout(graph)
}

export async function layoutGraph(nodes: LayoutNode[], edges: LayoutEdge[], runner: LayoutRunner = workerRunner): Promise<Record<string, { x: number; y: number }>> {
  if (nodes.length === 0) return {}
  const out = await runner(toElkGraph(nodes, edges))
  return Object.fromEntries((out.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]))
}
