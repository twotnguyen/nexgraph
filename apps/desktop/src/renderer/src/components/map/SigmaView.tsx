import { useEffect, useRef } from 'react'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import type Sigma from 'sigma'
import type { MapEdge, MapNode } from '@shared/graph-types'
import { communityColor, edgeSize, nodeSize } from './mapStyle'

export const FA2_ITERATIONS = 100
const MUTED = '#e3e8ef'

interface Props {
  nodes: MapNode[]
  edges: MapEdge[]
  /** Nút bị làm mờ (vd. nút không chứa tệp của vòng phụ thuộc đang chọn). */
  dimmed?: Set<string>
  onNodeClick: (id: string) => void
  onEdgeClick: (source: string, target: string) => void
  onStageClick: () => void
  /** Gọi khi không khởi tạo được WebGL. */
  onUnsupported: () => void
}

/** Toàn bộ mã sigma/graphology của thẻ Bản đồ nằm ở đây (jsdom không có WebGL nên các test khác mock component này). */
export function SigmaView({ nodes, edges, dimmed, onNodeClick, onEdgeClick, onStageClick, onUnsupported }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const cb = useRef({ onNodeClick, onEdgeClick, onStageClick, onUnsupported })
  cb.current = { onNodeClick, onEdgeClick, onStageClick, onUnsupported }
  const dimmedRef = useRef(dimmed)
  dimmedRef.current = dimmed
  const sigmaRef = useRef<Sigma | null>(null)

  useEffect(() => {
    if (!box.current) return
    const graph = new Graph({ type: 'directed', multi: false })
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1)
      const ring = 1 + (n.community ?? 0) % 10
      graph.addNode(n.id, { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring, size: nodeSize(n.files),
        label: n.label, color: communityColor(n.community) })
    })
    const edgeKey = new Map<string, [string, string]>()
    for (const e of edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target) || graph.hasDirectedEdge(e.source, e.target)) continue
      const k = graph.addDirectedEdge(e.source, e.target, { size: edgeSize(e.weight), color: '#b8c2cf' })
      edgeKey.set(k, [e.source, e.target])
    }
    if (graph.order > 1) forceAtlas2.assign(graph, { iterations: FA2_ITERATIONS, settings: forceAtlas2.inferSettings(graph) })

    let cancelled = false
    // sigma nạp lúc chạy: nó đọc WebGL2RenderingContext ngay khi import nên không thể import tĩnh (jsdom, build không có WebGL).
    void import('sigma').then(({ default: SigmaCtor }) => {
      if (cancelled || !box.current) return
      let sigma: Sigma
      try {
        let hovered: string | null = null
        sigma = new SigmaCtor(graph, box.current, { renderEdgeLabels: false, labelRenderedSizeThreshold: 10, enableEdgeEvents: true,
          nodeReducer: (node, data) => {
            const near = hovered && (node === hovered || graph.hasEdge(hovered, node) || graph.hasEdge(node, hovered))
            const off = (dimmedRef.current?.has(node) ?? false) || (hovered != null && !near)
            return off ? { ...data, color: MUTED, label: null } : data
          },
          edgeReducer: (edge, data) => {
            const [s, t] = edgeKey.get(edge) ?? ['', '']
            const off = (dimmedRef.current?.has(s) ?? false) || (dimmedRef.current?.has(t) ?? false) ||
              (hovered != null && s !== hovered && t !== hovered)
            return off ? { ...data, hidden: true } : data
          } })
        sigma.on('enterNode', ({ node }) => { hovered = node; sigma.refresh() })
        sigma.on('leaveNode', () => { hovered = null; sigma.refresh() })
        sigma.on('clickNode', ({ node }) => cb.current.onNodeClick(node))
        sigma.on('clickEdge', ({ edge }) => {
          const ends = edgeKey.get(edge)
          if (ends) cb.current.onEdgeClick(ends[0], ends[1])
        })
        sigma.on('clickStage', () => cb.current.onStageClick())
      } catch {
        cb.current.onUnsupported()
        return
      }
      sigmaRef.current = sigma
    }).catch(() => cb.current.onUnsupported())
    return () => {
      cancelled = true
      sigmaRef.current?.kill()
      sigmaRef.current = null
    }
  }, [nodes, edges])

  useEffect(() => {
    sigmaRef.current?.refresh()
  }, [dimmed])

  return <div ref={box} className="map-canvas" data-testid="sigma" />
}
