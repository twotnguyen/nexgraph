import { useEffect, useMemo, useRef } from 'react'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import type Sigma from 'sigma'
import type { MapEdge, MapNode } from '@shared/graph-types'
import { useTheme } from '../../state/useTheme'
import { communityColor, edgeSize, nodeSize, PALETTE } from './mapStyle'

export const FA2_ITERATIONS = 100
const TOKEN_PALETTE = ['--blue', '--teal', '--violet', '--magenta', '--amber', '--green', '--orange', '--blue', '--orange', '--color-muted']
const edgeId = (source: string, target: string) => `${source}\0${target}`

function colorsFor(el: HTMLElement) {
  const styles = getComputedStyle(el)
  const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback
  return {
    palette: TOKEN_PALETTE.map((name, i) => token(name, PALETTE[i])),
    muted: token('--track', '#e3e8ef'),
    text: token('--color-text', '#202838'),
    surface: token('--color-surface', '#ffffff'),
    edge: token('--color-muted', '#8693a4')
  }
}

interface Props {
  nodes: MapNode[]
  edges: MapEdge[]
  visibleEdges?: MapEdge[]
  /** Nút bị làm mờ (vd. nút không chứa tệp của vòng phụ thuộc đang chọn). */
  dimmed?: Set<string>
  onNodeClick: (id: string) => void
  onEdgeClick: (source: string, target: string) => void
  onStageClick: () => void
  /** Gọi khi không khởi tạo được WebGL. */
  onUnsupported: () => void
}

/** Toàn bộ mã sigma/graphology của thẻ Bản đồ nằm ở đây (jsdom không có WebGL nên các test khác mock component này). */
export function SigmaView({ nodes, edges, visibleEdges = edges, dimmed, onNodeClick, onEdgeClick, onStageClick, onUnsupported }: Props) {
  const theme = useTheme()
  const box = useRef<HTMLDivElement>(null)
  const cb = useRef({ onNodeClick, onEdgeClick, onStageClick, onUnsupported })
  cb.current = { onNodeClick, onEdgeClick, onStageClick, onUnsupported }
  const dimmedRef = useRef(dimmed)
  dimmedRef.current = dimmed
  const sigmaRef = useRef<Sigma | null>(null)
  const colorsRef = useRef<ReturnType<typeof colorsFor> | null>(null)
  const visible = useRef(new Map<string, number>())
  const edgeWeights = useMemo(() => new Map(visibleEdges.map((e) => [edgeId(e.source, e.target), e.weight])), [visibleEdges])
  visible.current = edgeWeights

  useEffect(() => {
    if (!box.current) return
    const graph = new Graph({ type: 'directed', multi: false })
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1)
      const ring = 1 + (n.community ?? 0) % 10
      graph.addNode(n.id, { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring, size: nodeSize(n.files),
        label: n.label, community: n.community, color: communityColor(n.community) })
    })
    const edgeKey = new Map<string, [string, string]>()
    for (const e of edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target) || graph.hasDirectedEdge(e.source, e.target)) continue
      const k = graph.addDirectedEdge(e.source, e.target, { size: edgeSize(e.weight) })
      edgeKey.set(k, [e.source, e.target])
    }
    if (graph.order > 1) forceAtlas2.assign(graph, { iterations: FA2_ITERATIONS, settings: forceAtlas2.inferSettings(graph) })

    let cancelled = false
    // sigma nạp lúc chạy: nó đọc WebGL2RenderingContext ngay khi import nên không thể import tĩnh (jsdom, build không có WebGL).
    void Promise.all([import('sigma'), import('sigma/rendering')]).then(([{ default: SigmaCtor }, { drawDiscNodeLabel }]) => {
      if (cancelled || !box.current) return
      const colors = colorsFor(box.current)
      colorsRef.current = colors
      let sigma: Sigma
      try {
        let hovered: string | null = null
        sigma = new SigmaCtor(graph, box.current, { renderEdgeLabels: false, labelRenderedSizeThreshold: 10, enableEdgeEvents: true,
          labelColor: { color: colors.text },
          // Nhãn khi rê chuột: sigma mặc định vẽ nền trắng, không hợp theme tối → vẽ nền bằng màu bề mặt.
          defaultDrawNodeHover: (ctx, data, settings) => {
            if (!data.label) return
            ctx.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`
            const h = Math.max(settings.labelSize + 8, data.size * 2 + 4)
            ctx.fillStyle = colorsRef.current?.surface ?? colors.surface
            ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
            ctx.shadowBlur = 8
            ctx.beginPath()
            ctx.roundRect(data.x - data.size - 2, data.y - h / 2, ctx.measureText(data.label).width + data.size * 2 + 12, h, 6)
            ctx.fill()
            ctx.shadowBlur = 0
            drawDiscNodeLabel(ctx, data, settings)
          },
          nodeReducer: (node, data) => {
            const near = hovered && (node === hovered || graph.hasEdge(hovered, node) || graph.hasEdge(node, hovered))
            const off = (dimmedRef.current?.has(node) ?? false) || (hovered != null && !near)
            const palette = colorsRef.current ?? colors
            const color = communityColor(graph.getNodeAttribute(node, 'community'), palette.palette, palette.edge)
            return off ? { ...data, color: palette.muted, label: null } : { ...data, color }
          },
          edgeReducer: (edge, data) => {
            const [s, t] = edgeKey.get(edge) ?? ['', '']
            const weight = visible.current.get(edgeId(s, t))
            const off = weight === undefined || (dimmedRef.current?.has(s) ?? false) || (dimmedRef.current?.has(t) ?? false) ||
              (hovered != null && s !== hovered && t !== hovered)
            return off ? { ...data, hidden: true } : { ...data, size: edgeSize(weight), color: colorsRef.current?.edge ?? colors.edge }
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
    }).catch(() => { if (!cancelled) cb.current.onUnsupported() })
    return () => {
      cancelled = true
      sigmaRef.current?.kill()
      sigmaRef.current = null
    }
  }, [nodes, edges])

  useEffect(() => {
    sigmaRef.current?.refresh()
  }, [dimmed, edgeWeights])

  useEffect(() => {
    if (!box.current) return
    const colors = colorsFor(box.current)
    colorsRef.current = colors
    sigmaRef.current?.setSetting('labelColor', { color: colors.text })
    sigmaRef.current?.scheduleRefresh()
  }, [theme])

  return <div ref={box} className="map-canvas" data-testid="sigma" />
}
