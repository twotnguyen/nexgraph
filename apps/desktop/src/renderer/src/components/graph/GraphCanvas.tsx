import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { GraphEdge, GraphNode, Neighborhood } from '@shared/graph-types'
import { layoutGraph } from '../../services/elkLayoutService'
import { vi } from '../../strings'
import { AutoFit } from '../common/AutoFit'
import { HIGHLIGHT_COLORS, kindStyle, type HighlightKind } from './kindStyle'

const W = 180
const H = 44
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

const toFlowEdges = (edges: GraphEdge[], strong: boolean): Edge[] =>
  edges.map((e) => ({
    id: String(e.id), source: e.source, target: e.target, label: e.type,
    ...(strong ? { animated: true, style: { stroke: 'var(--magenta)', strokeWidth: 2.5 } } : {})
  }))

interface View { pos: Record<string, { x: number; y: number }>; edges: Edge[]; raw: Map<string, GraphNode>; truncated: boolean; total?: number | null }

export function GraphCanvas({ projectId, startNodeId, focusNodeId, onSelect, highlights, onNodeContextMenu, overlay, onClearOverlay }: Props) {
  const [center, setCenter] = useState(focusNodeId ?? startNodeId)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setCenter(focusNodeId ?? startNodeId), [startNodeId, projectId])
  useEffect(() => {
    if (focusNodeId) setCenter(focusNodeId)
  }, [focusNodeId])

  useEffect(() => {
    let alive = true
    setError(null)
    ;(async () => {
      const hood = overlay ?? (await window.nexgraph.graph.neighbors(projectId, { node: center, depth: 1, limit: LIMIT }))
      const pos = await layoutGraph(
        hood.nodes.map((n) => ({ id: n.id, width: W, height: H })),
        hood.edges.map((e) => ({ id: String(e.id), source: e.source, target: e.target }))
      )
      if (!alive) return
      setView({
        raw: new Map(hood.nodes.map((n) => [n.id, n])),
        truncated: 'truncated' in hood && hood.truncated === true,
        total: 'total' in hood && typeof hood.total === 'number' ? hood.total : null,
        pos,
        edges: toFlowEdges(hood.edges, overlay != null)
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
  const nodes = useMemo<Node[]>(
    () =>
      view
        ? [...view.raw.values()].map((n) => {
            const h = highlights?.[n.id]
            const color = h ? HIGHLIGHT_COLORS[h] : kindStyle(n.kind).color
            return {
              id: n.id,
              position: view.pos[n.id] ?? { x: 0, y: 0 },
              initialWidth: W,
              initialHeight: H,
              data: {
                label: (
                  <div>
                    <b>{n.label}</b>
                    <small className="kind">{n.kind}</small>
                    {h && h !== 'current' && h !== 'visited' && (
                      <small className="tag" style={{ color }}>{vi.changes.tag[h]}</small>
                    )}
                  </div>
                )
              },
              style: {
                width: W, borderColor: color, '--node-c': color,
                borderWidth: n.id === center || h === 'changed' || h === 'gap' || h === 'current' ? 3 : (h === 'visited' || h ? 2.5 : 1.5),
                borderStyle: 'solid', borderRadius: 8, fontSize: 12
              }
            }
          })
        : [],
    [view, highlights, center]
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
    <div className="graph-canvas">
      {toolbar}
      {error && <p role="alert" className="error">{error}</p>}
      {view?.truncated && (
        <p role="status" className="muted">
          {view.total != null ? vi.graph.truncatedOf(view.raw.size, view.total) : vi.graph.truncated}
        </p>
      )}
      {view && (
        <ReactFlow key={overlay ? 'overlay' : center} nodes={nodes} edges={view.edges} onNodeClick={onNodeClick} onNodeContextMenu={onContextMenu}
          nodesDraggable={false} minZoom={0.2} proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls showInteractive={false} />
          <AutoFit />
        </ReactFlow>
      )}
    </div>
  )
}
