import { useEffect, useState, type ReactNode } from 'react'
import type { GraphStats, ProjectSummary } from '@shared/graph-types'
import { ExportDialog } from '../components/export/ExportDialog'
import { IndexOptionsDialog } from '../components/overview/IndexOptionsDialog'
import { McpCard } from '../components/overview/McpCard'
import { vi } from '../strings'

export type WorkspaceTab = 'arch' | 'graph' | 'tree' | 'report'

interface Props {
  project: ProjectSummary
  onOpenWorkspace: (tab?: WorkspaceTab) => void
  onReindex: (opts: { exclude: string[] }) => void
  onBack: () => void
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
const num = (n: number) => n.toLocaleString('vi-VN')

function Card({ title, desc, status, onClick, disabled }: { title: string; desc: string; status?: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="card" onClick={onClick} disabled={disabled}>
      <b>{title}</b>
      <span className="muted">{desc}</span>
      {status && <small className="card-status">{status}</small>}
    </button>
  )
}

export function ProjectOverviewScreen({ project, onOpenWorkspace, onReindex, onBack }: Props) {
  const pid = project.project_id
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [stale, setStale] = useState(false)
  const [clusters, setClusters] = useState<string | null>(null)
  const [options, setOptions] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let alive = true
    window.nexgraph.graph.stats(pid).then((s) => alive && setStats(s)).catch(() => {})
    window.nexgraph.graph.changes(pid, { refresh: false })
      .then((c) => alive && setStale(c.changed_files.length > 0))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [pid])

  const recluster = async () => {
    setClusters(vi.overview.reclustering)
    try {
      const r = await window.nexgraph.graph.recluster(pid)
      setClusters(vi.overview.clusters(r.communities))
    } catch (e) {
      setClusters((e as { message?: string }).message ?? String(e))
    }
  }

  const when = project.last_indexed_at ? new Date(project.last_indexed_at * 1000).toLocaleString('vi-VN') : null
  return (
    <main className="screen overview">
      <button type="button" className="link" onClick={onBack}>{vi.overview.back}</button>
      <h1>{project.name}</h1>
      <p className="muted mono">{project.path}</p>

      <section className="graph-status" aria-label={vi.overview.statusLabel}>
        {stats ? (
          <span>{vi.overview.stats(num(stats.files), num(sum(stats.nodes_by_kind)), num(sum(stats.edges_by_type)))}</span>
        ) : <span className="muted">{vi.overview.loading}</span>}
        {when && <span className="muted">{vi.overview.lastIndexed(when)}</span>}
        {stale && <span className="badge">{vi.overview.stale}</span>}
      </section>

      <h2>{vi.overview.build}</h2>
      <div className="cards">
        <Card title={vi.overview.reindex} desc={vi.overview.reindexDesc} onClick={() => onReindex({ exclude: [] })} />
        <Card title={vi.overview.options} desc={vi.overview.optionsDesc} onClick={() => setOptions(true)} />
        <Card title={vi.overview.recluster} desc={vi.overview.reclusterDesc} status={clusters} onClick={() => void recluster()} />
      </div>

      <h2>{vi.overview.view}</h2>
      <div className="cards">
        <Card title={vi.workspace.archTab} desc={vi.overview.archDesc} onClick={() => onOpenWorkspace('arch')} />
        <Card title={vi.workspace.graphTab} desc={vi.overview.graphDesc} onClick={() => onOpenWorkspace('graph')} />
        <Card title={vi.workspace.treeTab} desc={vi.overview.treeDesc} onClick={() => onOpenWorkspace('tree')} />
        <Card title={vi.workspace.reportTab} desc={vi.overview.reportDesc} onClick={() => onOpenWorkspace('report')} />
      </div>

      <h2>{vi.overview.exportGroup}</h2>
      <div className="cards">
        <Card title={vi.overview.exportCard} desc={vi.overview.exportDesc} onClick={() => setExporting(true)} />
      </div>

      <h2>{vi.overview.integrate}</h2>
      <div className="cards">
        <McpCard project={project} />
      </div>

      <h2>{vi.overview.ai}</h2>
      <div className="cards">
        <Card title={vi.overview.semantic} desc={vi.overview.semanticDesc} status={vi.overview.wave2} disabled />
      </div>

      {options && (
        <IndexOptionsDialog onClose={() => setOptions(false)} onSubmit={(o) => { setOptions(false); onReindex(o) }} />
      )}
      {exporting && <ExportDialog projectId={pid} projectName={project.name} scope={{ kind: 'all' }} onClose={() => setExporting(false)} />}
    </main>
  )
}
