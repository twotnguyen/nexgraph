import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GraphNode } from '@shared/graph-types'
import { layoutGraph } from '../../services/elkLayoutService'
import { vi } from '../../strings'
import { kindStyle } from './kindStyle'

const W = 180
const H = 44
const LIMIT = 2000 // không bao giờ vẽ quá ~2.000 nút (spec §5.9)

interface Props {
  projectId: string
  startNodeId: string
  onSelect?: (node: GraphNode) => void
}

interface View { nodes: Node[]; edges: Edge[]; raw: Map<string, GraphNode>; truncated: boolean }

export function GraphCanvas({ projectId, startNodeId, onSelect }: Props) {
  const [center, setCenter] = useState(startNodeId)
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setCenter(startNodeId), [startNodeId, projectId])

  useEffect(() => {
    let alive = true
    setError(null)
    ;(async () => {
      const hood = await window.nexgraph.graph.neighbors(projectId, { node: center, depth: 1, limit: LIMIT })
      const pos = await layoutGraph(
        hood.nodes.map((n) => ({ id: n.id, width: W, height: H })),
        hood.edges.map((e) => ({ id: String(e.id), source: e.source, target: e.target }))
      )
      if (!alive) return
      setView({
        raw: new Map(hood.nodes.map((n) => [n.id, n])),
        truncated: hood.truncated,
        nodes: hood.nodes.map((n) => ({
          id: n.id,
          position: pos[n.id] ?? { x: 0, y: 0 },
          initialWidth: W,
          initialHeight: H,
          data: { label: (<div><b>{n.label}</b><small className="kind">{n.kind}</small></div>) },
          style: { width: W, borderColor: kindStyle(n.kind).color, borderWidth: n.id === center ? 3 : 1.5, borderStyle: 'solid', borderRadius: 8, fontSize: 12 }
        })),
        edges: hood.edges.map((e) => ({ id: String(e.id), source: e.source, target: e.target, label: e.type }))
      })
    })().catch((err: Error) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [projectId, center])

  const onNodeClick = useCallback(
    (_: unknown, n: Node) => {
      const raw = view?.raw.get(n.id)
      if (raw) onSelect?.(raw)
      setCenter(n.id)
    },
    [view, onSelect]
  )
  const toolbar = useMemo(
    () => (<div className="graph-toolbar"><button type="button" onClick={() => setCenter(startNodeId)}>{vi.graph.backToRoot}</button></div>),
    [startNodeId]
  )

  return (
    <div className="graph-canvas">
      {toolbar}
      {error && <p role="alert" className="error">{error}</p>}
      {view?.truncated && <p role="status" className="muted">{vi.graph.truncated}</p>}
      {view && (
        <ReactFlow key={center} nodes={view.nodes} edges={view.edges} onNodeClick={onNodeClick} fitView nodesDraggable={false} proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      )}
    </div>
  )
}
