import { useEffect, useMemo, useState } from 'react'
import type { GlobalGraph, GlobalSearchHit } from '@shared/graph-types'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import { Icon } from '../components/common/icons'
import { vi } from '../strings'

const LIMIT = 300 // overlay xếp lớp bằng ELK: giữ đồ thị gộp vừa phải

interface Props {
  projectIds: string[]
  onBack: () => void
}

/** "Xem chung" (W8): đồ thị gộp chỉ đọc của nhiều dự án trong graph chung, tìm kiếm chung và xuất graph.json gộp. */
export function GlobalViewScreen({ projectIds, onBack }: Props) {
  const [graph, setGraph] = useState<GlobalGraph | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<GlobalSearchHit[] | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const key = projectIds.join(',')

  useEffect(() => {
    let alive = true
    setGraph(null)
    setError(null)
    window.nexgraph.globalGraph.graph(projectIds, LIMIT).then(
      (g) => { if (alive) setGraph(g) },
      (err: { message?: string }) => { if (alive) setError(err?.message ?? String(err)) })
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  async function search() {
    if (!q.trim()) return
    setError(null)
    try {
      const found = await window.nexgraph.globalGraph.search(q.trim(), 50)
      setHits(found.filter((h) => projectIds.includes(h.project_id)))
    } catch (err) {
      setError((err as { message?: string })?.message ?? String(err))
    }
  }

  async function exportMerged() {
    setExporting(true)
    setError(null)
    try {
      const r = await window.nexgraph.globalGraph.export(projectIds)
      if (r) setNotice(vi.globalGraph.exported(r.files[0]))
    } catch (err) {
      setError((err as { message?: string })?.message ?? String(err))
    } finally {
      setExporting(false)
    }
  }

  // Cùng một đối tượng giữa các lần vẽ: GraphCanvas xếp lại bố cục mỗi khi overlay đổi.
  const overlay = useMemo(() => graph && { nodes: graph.nodes, edges: graph.edges }, [graph])
  const names = graph?.projects.map((p) => p.name).join(', ')
  const cross = graph?.edges.filter((e) => e.cross_repo).length ?? 0
  return (
    <main className="screen overview">
      <button type="button" className="link page-back" onClick={onBack}>{vi.globalGraph.back}</button>
      <div className="page-title">
        <span className="page-icon"><Icon name="graph" size={23} /></span>
        <div>
          <h1>{vi.globalGraph.view}</h1>
          <p className="muted">{names ? `${names} · ${vi.globalGraph.readOnly}` : vi.globalGraph.readOnly}</p>
        </div>
      </div>
      {error && <p role="alert" className="inline-message error">{error}</p>}
      {notice && <p role="status" className="inline-message">{notice}</p>}
      <section className="workbench-panel">
        <header className="panel-title">
          <h2>{graph ? vi.globalGraph.crossEdges(cross) : vi.globalGraph.loading}</h2>
          <button type="button" disabled={exporting || !graph} onClick={() => void exportMerged()}>
            <Icon name="export" size={16} /> {vi.globalGraph.export}
          </button>
        </header>
        {graph?.truncated && <p className="panel-instruction muted">{vi.globalGraph.truncated}</p>}
        {graph && graph.skipped.length > 0 && <p className="panel-instruction muted">{vi.globalGraph.skipped(graph.skipped.length)}</p>}
        <form className="panel-instruction row" role="search" onSubmit={(e) => { e.preventDefault(); void search() }}>
          <input type="search" aria-label={vi.globalGraph.search} placeholder={vi.globalGraph.searchPlaceholder}
            value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        {hits && hits.length === 0 && <p className="panel-instruction muted">{vi.globalGraph.noHits}</p>}
        {hits && hits.length > 0 && (
          <ul className="recent">
            {hits.map((h) => (
              <li key={`${h.project_id}::${h.node.id}`}>
                <button type="button" className="recent-open" onClick={() => setFocus(`${h.project_id}::${h.node.id}`)}>
                  <span className="recent-identity"><b>{h.node.label}</b>
                    <span className="muted mono">{h.project_name} · {h.node.file ?? h.node.kind}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {overlay && (
          <div className="global-canvas" style={{ height: 560 }}>
            <GraphCanvas projectId={key} startNodeId="" overlay={overlay}
              highlights={focus ? { [focus]: 'current' } : undefined} />
          </div>
        )}
      </section>
    </main>
  )
}
