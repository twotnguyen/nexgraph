import ELKApi, { type ElkNode } from 'elkjs/lib/elk-api'

export interface LayoutNode { id: string; width: number; height: number }
export interface LayoutEdge { id: string; source: string; target: string }
export type LayoutRunner = (graph: ElkNode) => Promise<ElkNode>

/** `layered`: xếp lớp trái → phải. `layered-down`: trên → dưới (sơ đồ khối, hoặc khung cao hơn rộng). */
export type LayoutKind = 'layered' | 'layered-down'
export interface Point { x: number; y: number }
export interface Layout {
  /** Góc trên trái của từng nút. */
  pos: Record<string, Point>
  /** Đường đi của từng cạnh do ELK tính: các đoạn ngang/dọc, không cắt qua nút. */
  routes: Record<string, Point[]>
}

// Nút cùng lớp thẳng hàng; cạnh đi vuông góc, giữ khoảng cách đều với nút và với nhau.
const LAYERED = {
  'elk.algorithm': 'layered', 'elk.edgeRouting': 'ORTHOGONAL', 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.spacing.nodeNode': '28', 'elk.spacing.edgeNode': '18', 'elk.spacing.edgeEdge': '12',
  'elk.layered.spacing.edgeNodeBetweenLayers': '18', 'elk.layered.spacing.edgeEdgeBetweenLayers': '12'
}
const OPTIONS: Record<LayoutKind, Record<string, string>> = {
  layered: { ...LAYERED, 'elk.direction': 'RIGHT', 'elk.layered.spacing.nodeNodeBetweenLayers': '80' },
  'layered-down': { ...LAYERED, 'elk.direction': 'DOWN', 'elk.layered.spacing.nodeNodeBetweenLayers': '64' }
}

/** Dựng đồ thị đầu vào cho ELK; bỏ cạnh trỏ tới nút không có trong danh sách. */
export function toElkGraph(nodes: LayoutNode[], edges: LayoutEdge[], kind: LayoutKind = 'layered'): ElkNode {
  const ids = new Set(nodes.map((n) => n.id))
  return {
    id: 'root',
    layoutOptions: OPTIONS[kind],
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

/** Bố cục kèm đường đi của cạnh, cho sơ đồ ô chữ nhật (Kiến trúc, Luồng, đường đi). */
export async function layoutDiagram(nodes: LayoutNode[], edges: LayoutEdge[], kind: LayoutKind = 'layered', runner: LayoutRunner = workerRunner): Promise<Layout> {
  if (nodes.length === 0) return { pos: {}, routes: {} }
  const out = await runner(toElkGraph(nodes, edges, kind))
  const routes: Record<string, Point[]> = {}
  for (const e of out.edges ?? []) {
    const sec = e.sections?.[0]
    if (sec) routes[e.id] = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]
  }
  return { pos: Object.fromEntries((out.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }])), routes }
}

export async function layoutGraph(nodes: LayoutNode[], edges: LayoutEdge[], runner: LayoutRunner = workerRunner): Promise<Record<string, Point>> {
  return (await layoutDiagram(nodes, edges, 'layered', runner)).pos
}
