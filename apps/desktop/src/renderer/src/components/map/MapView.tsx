import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ArchEvidence, ImportCycles, MapNode, ProjectMap } from '@shared/graph-types'
import { vi } from '../../strings'
import { EvidencePopover } from '../architecture/EvidencePopover'
import { CanvasState } from '../common/CanvasState'
import { CyclesPopover } from './CyclesPopover'
import { SigmaView } from './SigmaView'

const DETAIL = 400
const EVIDENCE_LIMIT = 50

interface Props {
  projectId: string
  revision?: number
  onOpenNode: (nodeId: string) => void
  onOpenCode: (file: string, line: number) => void
  onOpenArch?: (blockId: string) => void
}

interface Crumb { id: string | null; label: string }
interface EvidenceState { title: string; items: ArchEvidence[]; loading: boolean; error: string | null }

const errMessage = (err: unknown): string =>
  err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err)

/** `dir:src` -> `src#directory`, `file:a.py` -> `a.py#file` (id nút của thẻ Graph). */
export const graphNodeId = (mapId: string): string => {
  const [kind, ...rest] = mapId.split(':')
  return `${rest.join(':')}#${kind === 'dir' ? 'directory' : 'file'}`
}

const inNode = (node: MapNode, file: string): boolean => {
  const path = node.id.slice(node.id.indexOf(':') + 1)
  return node.kind === 'file' ? file === path : file.startsWith(`${path}/`)
}

export function MapView({ projectId, revision = 0, onOpenNode, onOpenCode, onOpenArch }: Props) {
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, label: vi.map.root }])
  const [data, setData] = useState<ProjectMap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<MapNode | null>(null)
  const [types, setTypes] = useState({ IMPORTS: true, CALLS: true })
  const [minWeight, setMinWeight] = useState(1)
  const [cycles, setCycles] = useState<ImportCycles | null>(null)
  const [showCycles, setShowCycles] = useState(false)
  const [activeCycle, setActiveCycle] = useState<number | null>(null)
  const [evidence, setEvidence] = useState<EvidenceState | null>(null)
  const evidenceRequest = useRef(0)
  const [unsupported, setUnsupported] = useState(false)
  const parent = crumbs[crumbs.length - 1].id

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    setSelected(null)
    evidenceRequest.current += 1
    setEvidence(null)
    window.nexgraph.graph.map(projectId, { parent: parent ?? undefined, detail: DETAIL })
      .then((m) => alive && setData(m))
      .catch((e) => alive && setError(errMessage(e)))
    return () => {
      alive = false
      evidenceRequest.current += 1
    }
  }, [projectId, parent, revision, retry])

  useEffect(() => {
    let alive = true
    window.nexgraph.graph.cycles(projectId, 20).then((c) => alive && setCycles(c)).catch(() => {})
    return () => { alive = false }
  }, [projectId, revision])

  const weightedEdges = useMemo(() => (data?.edges ?? []).flatMap((e) => {
    const weight = Object.entries(e.types)
      .filter(([t]) => types[t as 'IMPORTS' | 'CALLS']).reduce((a, [, n]) => a + n, 0)
    return weight > 0 ? [{ ...e, weight }] : []
  }), [data, types])
  const maxWeight = useMemo(() => Math.max(1, ...weightedEdges.map((e) => e.weight)), [weightedEdges])
  const minimum = Math.min(minWeight, maxWeight)
  const edges = useMemo(() => weightedEdges.filter((e) => e.weight >= minimum), [weightedEdges, minimum])

  const dimmed = useMemo(() => {
    if (activeCycle == null || !cycles || !data) return undefined
    const files = cycles.cycles[activeCycle]?.files
    if (!files) return undefined
    return new Set(data.nodes.filter((n) => !files.some((f) => inNode(n, f))).map((n) => n.id))
  }, [activeCycle, cycles, data])

  const onEdgeClick = useCallback((source: string, target: string) => {
    const label = (id: string) => data?.nodes.find((n) => n.id === id)?.label ?? id
    const weight = data?.edges.find((e) => e.source === source && e.target === target)?.weight ?? 0
    const request = ++evidenceRequest.current
    setEvidence({ title: vi.map.edgeTitle(label(source), label(target), weight), items: [], loading: true, error: null })
    window.nexgraph.graph.archEvidence(projectId, source, target, EVIDENCE_LIMIT)
      .then((items) => request === evidenceRequest.current && setEvidence((cur) => cur && { ...cur, items, loading: false }))
      .catch((e) => request === evidenceRequest.current && setEvidence((cur) => cur && { ...cur, loading: false, error: errMessage(e) }))
  }, [data, projectId])

  const onNodeClick = useCallback((id: string) => setSelected(data?.nodes.find((n) => n.id === id) ?? null), [data])
  const drill = (n: MapNode) => setCrumbs((c) => [...c, { id: n.id, label: n.label }])

  return (
    <div className="map-view" aria-busy={!data && !error}>
      <div className="map-toolbar">
        <nav className="breadcrumb" aria-label={vi.map.breadcrumb}>
          {crumbs.map((c, i) => (
            <span key={`${c.id}-${i}`}>
              {i > 0 && ' › '}
              <button type="button" disabled={i === crumbs.length - 1} onClick={() => setCrumbs(crumbs.slice(0, i + 1))}>{c.label}</button>
            </span>
          ))}
        </nav>
        <fieldset className="map-types">
          <legend>{vi.map.edgeTypes}</legend>
          {(['IMPORTS', 'CALLS'] as const).map((t) => (
            <label key={t}><input type="checkbox" checked={types[t]} onChange={(e) => setTypes({ ...types, [t]: e.target.checked })} /> {t}</label>
          ))}
        </fieldset>
        <label className="map-weight">{vi.map.minWeight}
          <input type="range" min={1} max={maxWeight} value={minimum} onChange={(e) => setMinWeight(Number(e.target.value))} />
        </label>
        {cycles && cycles.total > 0 && (
          <button type="button" className="badge" onClick={() => setShowCycles(!showCycles)}>{vi.map.cycles(cycles.total)}</button>
        )}
      </div>
      {error && <CanvasState kind="error" message={error} onRetry={() => setRetry((n) => n + 1)} />}
      {!data && !error && <CanvasState kind="loading" message="Đang tải bản đồ…" />}
      {data && (
      <>
      {showCycles && cycles && <CyclesPopover data={cycles} active={activeCycle} onPick={setActiveCycle} />}
      {data.nodes.length === 0 ? <p className="muted map-empty">{vi.map.empty}</p>
        : unsupported ? (
          <div className="canvas-state" data-state="error">
            <div className="canvas-state-content">
              <p role="alert">{vi.map.noWebgl}</p>
              {onOpenArch && <button type="button" onClick={() => onOpenArch(parent ?? '')}>{vi.map.openArch}</button>}
            </div>
          </div>
        )
        : <SigmaView nodes={data.nodes} edges={data.edges} visibleEdges={edges} dimmed={dimmed} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick}
            onStageClick={() => setSelected(null)} onUnsupported={() => setUnsupported(true)} />}
      <p role="status" className="map-status muted">
        {vi.map.status(data.totals.nodes, data.totals.files)}{data.truncated ? ` · ${vi.map.truncated}` : ''}
      </p>
      {selected && (
        <aside className="inspector" aria-label={selected.label}>
          <h3>{selected.label}</h3>
          <p>{vi.map.nodeMeta(selected.files, selected.symbols)}</p>
          {selected.community != null && <p>{vi.map.community(selected.community)}</p>}
          {selected.drillable && <button type="button" className="primary" onClick={() => drill(selected)}>{vi.map.drill}</button>}
          <button type="button" onClick={() => onOpenNode(graphNodeId(selected.id))}>{vi.map.openGraph}</button>
          {onOpenArch && <button type="button" onClick={() => onOpenArch(selected.id)}>{vi.map.openArch}</button>}
        </aside>
      )}
      {evidence && (
        <EvidencePopover title={evidence.title} items={evidence.items} loading={evidence.loading} error={evidence.error}
          onOpenNode={onOpenNode} onOpenCode={onOpenCode} onClose={() => { evidenceRequest.current += 1; setEvidence(null) }} />
      )}
      </>
      )}
    </div>
  )
}
