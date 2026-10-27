import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'
import type { ArchBlock, ArchEvidence, ArchLink, ArchView } from '@shared/graph-types'
import { layoutGraph } from '../../services/elkLayoutService'
import { vi } from '../../strings'
import { AutoFit } from '../common/AutoFit'
import { blockColor } from './blockStyle'
import { EvidencePopover } from './EvidencePopover'

const W = 190
const H = 56
const EVIDENCE_LIMIT = 50

interface Crumb { id: string | null; label: string }
interface Props { projectId: string; onOpenNode: (nodeId: string) => void }
interface Laid { nodes: Node[]; edges: Edge[]; view: ArchView }
interface EvidenceState { link: ArchLink; items: ArchEvidence[]; loading: boolean; error: string | null }

export function ArchitectureCanvas({ projectId, onOpenNode }: Props) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, label: vi.arch.root }])
  const [laid, setLaid] = useState<Laid | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<EvidenceState | null>(null)
  const current = crumbs[crumbs.length - 1].id

  useEffect(() => {
    let alive = true
    setError(null)
    setEvidence(null)
    ;(async () => {
      const view = await window.nexgraph.graph.architecture(projectId, current ?? undefined)
      const pos = await layoutGraph(
        view.blocks.map((b) => ({ id: b.id, width: W, height: H })),
        view.links.map((l) => ({ id: `${l.from}->${l.to}`, source: l.from, target: l.to }))
      )
      if (!alive) return
      setLaid({
        view,
        nodes: view.blocks.map((b) => ({
          id: b.id,
          position: pos[b.id] ?? { x: 0, y: 0 },
          initialWidth: W,
          initialHeight: H,
          data: { label: (<div><b>{b.label}</b><small className="kind">{vi.arch.files(b.size)}</small></div>) },
          style: { width: W, borderColor: blockColor(b.kind), borderWidth: 2, borderStyle: b.kind === 'group' ? 'dashed' : 'solid', borderRadius: 10, fontSize: 12 }
        })),
        edges: view.links.map((l) => ({
          id: `${l.from}->${l.to}`, source: l.from, target: l.to, label: String(l.count),
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { strokeWidth: 1 + Math.min(4, Math.log2(l.count + 1)) }
        }))
      })
    })().catch((err: Error) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [projectId, current])

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
    <div className="arch-canvas">
      <nav className="breadcrumb" aria-label={vi.arch.breadcrumb}>
        {crumbs.map((c, i) => (
          <span key={`${c.id}-${i}`}>
            {i > 0 && <span className="muted"> › </span>}
            <button type="button" disabled={i === crumbs.length - 1} onClick={() => setCrumbs((cs) => cs.slice(0, i + 1))}>{c.label}</button>
          </span>
        ))}
      </nav>
      <div className="legend muted"><span>{vi.arch.legendArrow}</span><span>{vi.arch.legendCount}</span></div>
      {error && <p role="alert" className="error">{error}</p>}
      {laid && laid.view.blocks.length === 0 && !error && <p className="muted placeholder">{vi.arch.empty}</p>}
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
      {laid && laid.view.blocks.length > 0 && (
        <ReactFlow key={current ?? 'root'} nodes={laid.nodes} edges={laid.edges} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick}
                   nodesDraggable={false} proOptions={{ hideAttribution: true }}>
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
          onClose={() => setEvidence(null)}
        />
      )}
    </div>
  )
}
