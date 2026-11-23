import { Background, Controls, ReactFlow, type Edge, type Node } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ArchBlock, ArchEvidence, ArchLink, ArchView } from '@shared/graph-types'
import { layoutDiagram } from '../../services/elkLayoutService'
import { tr, vi } from '../../strings'
import { useLocale } from '../../state/locale'
import { useTheme } from '../../state/useTheme'
import { AutoFit } from '../common/AutoFit'
import { CanvasState } from '../common/CanvasState'
import { BOX_H, BOX_W, dotEdge, dotEdgeTypes, dotNodeTypes } from '../common/dotGraph'
import { blockColor } from './blockStyle'
import { EvidencePopover } from './EvidencePopover'

const EVIDENCE_LIMIT = 50

interface Crumb { id: string | null; label?: string }
interface Props { projectId: string; revision?: number; onOpenNode: (nodeId: string) => void; onOpenCode?: (file: string, line: number) => void; initialParent?: string; onParentChange?: (parent?: string) => void
  /** Bấm mốc "Dự án" ở gốc đường dẫn khối: về danh sách dự án. Không có thì mốc gốc khoá như cũ. */
  onOpenProjects?: () => void }
interface Pt { x: number; y: number }
interface Laid { view: ArchView; pos: Record<string, Pt>; routes: Record<string, Pt[]> }
interface EvidenceState { link: ArchLink; items: ArchEvidence[]; loading: boolean; error: string | null }

export function ArchitectureCanvas({ projectId, revision = 0, onOpenNode, onOpenCode, initialParent, onParentChange, onOpenProjects }: Props) {
  const theme = useTheme()
  // Nhãn tiếng Việt/Anh đọc lúc render: không chốt nhãn đã dịch trong state hay deps của effect tải dữ liệu.
  const locale = useLocale()
  const initialDirectory = initialParent?.startsWith('file:')
    ? (initialParent.slice(5).includes('/') ? `dir:${initialParent.slice(5, initialParent.lastIndexOf('/'))}` : undefined)
    : initialParent
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null }, ...(initialDirectory ? [{ id: initialDirectory, label: initialDirectory }] : [])])
  const [laid, setLaid] = useState<Laid | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [evidence, setEvidence] = useState<EvidenceState | null>(null)
  const current = crumbs[crumbs.length - 1].id

  useEffect(() => { onParentChange?.(current ?? undefined) }, [current, onParentChange])

  useEffect(() => {
    let alive = true
    setLaid(null)
    setError(null)
    setEvidence(null)
    ;(async () => {
      const view = await window.nexgraph.graph.architecture(projectId, current ?? undefined)
      // Sơ đồ khối: ô xếp theo lớp từ trên xuống, thẳng hàng; cạnh đi vuông góc theo tuyến ELK tính nên không cắt qua ô.
      const { pos, routes } = await layoutDiagram(
        view.blocks.map((b) => ({ id: b.id, width: BOX_W, height: BOX_H })),
        view.links.map((l) => ({ id: `${l.from}->${l.to}`, source: l.from, target: l.to })),
        'layered-down'
      )
      if (!alive) return
      setLaid({ view, pos, routes })
    })().catch((err: Error) => alive && setError(err?.message ?? String(err)))
    return () => {
      alive = false
    }
  }, [projectId, current, initialParent, revision, retry])

  // `laid` chỉ giữ dữ liệu; nhãn (kể cả phụ đề "N tệp") dựng ở đây để đổi ngôn ngữ là đổi ngay, không gọi lại engine.
  const graph = useMemo(() => {
    if (!laid) return null
    return {
      nodes: laid.view.blocks.map((b) => ({
        id: b.id,
        type: 'box',
        selected: b.id === initialParent,
        position: laid.pos[b.id] ?? { x: 0, y: 0 },
        initialWidth: BOX_W,
        initialHeight: BOX_H,
        data: { label: b.label, sub: vi.arch.files(b.size), color: blockColor(b.kind), size: BOX_W, dashed: b.kind === 'group' }
      })),
      edges: laid.view.links.map((l) => dotEdge({
        id: `${l.from}->${l.to}`, source: l.from, target: l.to, label: String(l.count), width: 1 + Math.min(1.5, Math.log2(l.count + 1) / 3),
        points: laid.routes[`${l.from}->${l.to}`]
      }))
    }
  }, [laid, initialParent, locale])

  const openEvidence = useCallback(
    (link: ArchLink) => {
      setEvidence({ link, items: [], loading: true, error: null })
      window.nexgraph.graph
        .archEvidence(projectId, link.from, link.to, EVIDENCE_LIMIT)
        .then((items) => setEvidence((cur) => (cur?.link === link ? { link, items, loading: false, error: null } : cur)))
        .catch((err: Error) => setEvidence((cur) => (cur?.link === link ? { link, items: [], loading: false, error: err.message } : cur)))
    },
    [projectId]
  )

  const onNodeClick = (_: unknown, n: Node): void => {
    const b = laid?.view.blocks.find((x) => x.id === n.id)
    if (!b) return
    if (b.kind === 'file') onOpenNode(`${b.id.slice('file:'.length)}#file`)
    else if (b.drillable) setCrumbs((c) => [...c, { id: b.id, label: b.label }])
  }
  const onEdgeClick = (_: unknown, e: Edge): void => {
    const link = laid?.view.links.find((l) => `${l.from}->${l.to}` === e.id)
    if (link) openEvidence(link)
  }
  const labelOf = (id: string): string => laid?.view.blocks.find((b: ArchBlock) => b.id === id)?.label ?? id

  return (
    <div className="arch-canvas" aria-busy={!laid && !error}>
      <nav className="breadcrumb" aria-label={vi.arch.breadcrumb}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          // Mốc gốc "Dự án" là mức trên cùng: đang ở gốc mà có handler thì mở danh sách dự án,
          // không có thì khoá (đừng để nút trông bấm được mà không làm gì).
          const openProjects = last && c.id === null ? onOpenProjects : undefined
          return (
            <span key={`${c.id}-${i}`}>
              {i > 0 && <span className="muted"> › </span>}
              <button type="button" disabled={last && !openProjects}
                onClick={() => { if (openProjects) openProjects(); else if (!last) setCrumbs((cs) => cs.slice(0, i + 1)) }}>{c.label ?? vi.arch.root}</button>
            </span>
          )
        })}
      </nav>
      <div className="legend muted"><span>{vi.arch.legendArrow}</span><span>{vi.arch.legendCount}</span></div>
      {error && <CanvasState kind="error" message={error} onRetry={() => setRetry((n) => n + 1)} />}
      {!laid && !error && <CanvasState kind="loading" message={tr('Đang tải kiến trúc…')} />}
      {laid?.view.blocks.length === 0 && !error && <CanvasState kind="empty" message={vi.arch.empty} />}
      {laid && laid.view.links.length > 0 && (
        <ul className="relations" aria-label={vi.arch.relations}>
          {laid.view.links.map((l) => (
            <li key={`${l.from}->${l.to}`}>
              <button type="button" onClick={() => openEvidence(l)}>
                {`${labelOf(l.from)} → ${labelOf(l.to)}`} <b>{l.count}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
      {laid && laid.view.blocks.length > 0 && graph && (
        <ReactFlow className="dot-graph show-edge-labels" colorMode={theme} key={current ?? 'root'} nodes={graph.nodes} edges={graph.edges} nodeTypes={dotNodeTypes} edgeTypes={dotEdgeTypes} minZoom={0.2} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick}
                   nodesDraggable={false}>
          <Background />
          <Controls showInteractive={false} />
          <AutoFit />
        </ReactFlow>
      )}
      {evidence && (
        <EvidencePopover
          title={`${labelOf(evidence.link.from)} → ${labelOf(evidence.link.to)}`}
          items={evidence.items}
          loading={evidence.loading}
          error={evidence.error}
          onOpenNode={onOpenNode}
          onOpenCode={onOpenCode}
          onClose={() => setEvidence(null)}
        />
      )}
    </div>
  )
}
