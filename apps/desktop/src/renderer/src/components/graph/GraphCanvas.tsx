import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { GraphEdge, GraphNode, Neighborhood } from '@shared/graph-types'
import { layoutDiagram } from '../../services/elkLayoutService'
import { vi } from '../../strings'
import { AutoFit } from '../common/AutoFit'
import { BOX_H, BOX_W, dotEdge, dotEdgeTypes, dotNodeTypes, dotSize, radialLayout, type DotData } from '../common/dotGraph'
import { HIGHLIGHT_COLORS, kindStyle, type HighlightKind } from './kindStyle'

const LIMIT = 2000 // không bao giờ vẽ quá ~2.000 nút (spec §5.9)

interface Props {
  projectId: string
  startNodeId: string
  /** Khi đổi sang một id khác null thì chuyển tâm sang nút đó (dùng khi mở kết quả tìm kiếm). */
  focusNodeId?: string | null
  onSelect?: (node: GraphNode) => void
  /** Nút cần tô theo vùng ảnh hưởng (id -> loại); vắng mặt thì giao diện như cũ. */
  highlights?: Record<string, HighlightKind>
  /** Chuột phải trên nút (toạ độ màn hình). */
  onNodeContextMenu?: (node: GraphNode, x: number, y: number) => void
  /** Vùng con cần vẽ thay cho láng giềng (đường đi, kết quả Hỏi graph); cạnh được tô nổi. */
  overlay?: { nodes: GraphNode[]; edges: GraphEdge[] } | null
  onClearOverlay?: () => void
}

const toFlowEdges = (edges: GraphEdge[], strong: boolean, routes: Record<string, { x: number; y: number }[]> = {}): Edge[] =>
  edges.map((e) => dotEdge({ id: String(e.id), source: e.source, target: e.target, label: e.type, strong, points: routes[String(e.id)] }))

/** Cỡ từng nút theo số cạnh của nó trong vùng đang vẽ. */
function sizes(nodes: GraphNode[], edges: GraphEdge[]): Record<string, number> {
  const degree: Record<string, number> = {}
  for (const e of edges) {
    degree[e.source] = (degree[e.source] ?? 0) + 1
    degree[e.target] = (degree[e.target] ?? 0) + 1
  }
  const max = Math.max(1, ...Object.values(degree))
  return Object.fromEntries(nodes.map((n) => [n.id, dotSize((degree[n.id] ?? 0) / max)]))
}

interface View { boxes: boolean; pos: Record<string, { x: number; y: number }>; size: Record<string, number>; edges: Edge[]; raw: Map<string, GraphNode>; truncated: boolean; total?: number | null }

export function GraphCanvas({ projectId, startNodeId, focusNodeId, onSelect, highlights, onNodeContextMenu, overlay, onClearOverlay }: Props) {
  const [center, setCenter] = useState(focusNodeId ?? startNodeId)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  /** Khung cao hơn rộng (thẻ Luồng ba cột): xếp chuỗi bước từ trên xuống để ô đủ to mà đọc. */
  const tall = (): boolean => !!box.current && box.current.clientHeight > box.current.clientWidth
  const [hover, setHover] = useState<string | null>(null) // nút đang rê chuột: làm nổi nó và láng giềng

  useEffect(() => setCenter(focusNodeId ?? startNodeId), [startNodeId, projectId])
  useEffect(() => {
    if (focusNodeId) setCenter(focusNodeId)
  }, [focusNodeId])

  useEffect(() => {
    let alive = true
    setError(null)
    ;(async () => {
      const hood = overlay ?? (await window.nexgraph.graph.neighbors(projectId, { node: center, depth: 1, limit: LIMIT }))
      const size = sizes(hood.nodes, hood.edges)
      const boxes = overlay != null
      let pos: Record<string, { x: number; y: number }>
      let routes: Record<string, { x: number; y: number }[]> = {}
      if (boxes) {
        // Chuỗi bước/đường đi: ô chữ nhật xếp lớp, cạnh đi vuông góc.
        ;({ pos, routes } = await layoutDiagram(
          hood.nodes.map((n) => ({ id: n.id, width: BOX_W, height: BOX_H })),
          hood.edges.map((e) => ({ id: String(e.id), source: e.source, target: e.target })),
          tall() ? 'layered-down' : 'layered'
        ))
      } else {
        // Mạng láng giềng: nút tâm ở giữa, láng giềng cách đều trên vòng tròn; cùng loại đứng cạnh nhau.
        const order = [...hood.nodes].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)).map((n) => n.id)
        const at = radialLayout(order, hood.nodes.some((n) => n.id === center) ? center : order[0])
        pos = Object.fromEntries(order.map((id) => [id, { x: at[id].x - size[id] / 2, y: at[id].y - size[id] / 2 }]))
      }
      if (!alive) return
      setView({
        raw: new Map(hood.nodes.map((n) => [n.id, n])),
        truncated: 'truncated' in hood && hood.truncated === true,
        total: 'total' in hood && typeof hood.total === 'number' ? hood.total : null,
        boxes,
        pos,
        size,
        edges: toFlowEdges(hood.edges, overlay != null, routes)
      })
    })().catch((err: Error) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [projectId, center, overlay])

  const onNodeClick = useCallback(
    (_: unknown, n: Node) => {
      const raw = view?.raw.get(n.id)
      if (raw) onSelect?.(raw)
      setCenter(n.id)
    },
    [view, onSelect]
  )
  const onContextMenu = useCallback(
    (e: MouseEvent, n: Node) => {
      const raw = view?.raw.get(n.id)
      if (!raw || !onNodeContextMenu) return
      e.preventDefault()
      onNodeContextMenu(raw, e.clientX, e.clientY)
    },
    [view, onNodeContextMenu]
  )
  // Khi rê chuột vào một nút: nút đó, láng giềng và các cạnh nối giữ nguyên, phần còn lại mờ đi.
  const near = useMemo(() => {
    if (!hover || !view) return null
    const ids = new Set([hover])
    for (const e of view.edges) {
      if (e.source === hover) ids.add(e.target)
      if (e.target === hover) ids.add(e.source)
    }
    return ids
  }, [hover, view])
  const nodes = useMemo<Node<DotData>[]>(
    () =>
      view
        ? [...view.raw.values()].map((n) => {
            const h = highlights?.[n.id]
            const size = view.boxes ? BOX_W : view.size[n.id]
            return {
              id: n.id,
              type: view.boxes ? 'box' : 'dot',
              className: near && !near.has(n.id) ? 'dim' : undefined,
              position: view.pos[n.id] ?? { x: 0, y: 0 },
              initialWidth: size,
              initialHeight: view.boxes ? BOX_H : size,
              data: {
                label: n.label, sub: n.kind, size,
                color: h ? HIGHLIGHT_COLORS[h] : kindStyle(n.kind).color,
                tag: h && h !== 'current' && h !== 'visited' ? vi.changes.tag[h] : undefined,
                strong: n.id === center || h === 'changed' || h === 'gap' || h === 'current'
              }
            }
          })
        : [],
    [view, highlights, center, near]
  )
  const edges = useMemo<Edge[]>(
    () => (view && hover ? view.edges.map((e) => (e.source === hover || e.target === hover ? { ...e, className: 'lit' } : { ...e, className: 'dim' })) : view?.edges ?? []),
    [view, hover]
  )
  const toolbar = useMemo(
    () => (
      <div className="graph-toolbar">
        <button type="button" onClick={() => { onClearOverlay?.(); setCenter(startNodeId) }}>{vi.graph.backToRoot}</button>
        {overlay && onClearOverlay && <button type="button" onClick={onClearOverlay}>{vi.path.clear}</button>}
      </div>
    ),
    [startNodeId, overlay, onClearOverlay]
  )

  return (
    <div className="graph-canvas" ref={box}>
      {toolbar}
      {error && <p role="alert" className="error">{error}</p>}
      {view?.truncated && (
        <p role="status" className="muted">
          {view.total != null ? vi.graph.truncatedOf(view.raw.size, view.total) : vi.graph.truncated}
        </p>
      )}
      {view && (
        <ReactFlow className="dot-graph" key={overlay ? 'overlay' : center} nodes={nodes} edges={edges} nodeTypes={dotNodeTypes} edgeTypes={dotEdgeTypes}
          onNodeMouseEnter={(_, n) => setHover(n.id)} onNodeMouseLeave={() => setHover(null)} onNodeClick={onNodeClick} onNodeContextMenu={onContextMenu}
          nodesDraggable={false} minZoom={0.2} proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls showInteractive={false} />
          <AutoFit />
        </ReactFlow>
      )}
    </div>
  )
}
