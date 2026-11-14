import { useEffect, useState, type ReactNode } from 'react'
import type { GraphStats, IndexOptions, ProjectSummary } from '@shared/graph-types'
import { ExportDialog } from '../components/export/ExportDialog'
import { IndexOptionsDialog } from '../components/overview/IndexOptionsDialog'
import { GraphArt, Icon, VIEW_TONE, type IconName, type Tone } from '../components/common/icons'
import { HookCard } from '../components/overview/HookCard'
import { IntegrationsDialog } from '../components/overview/IntegrationsDialog'
import { McpCard } from '../components/overview/McpCard'
import { vi } from '../strings'

export type WorkspaceTab = 'arch' | 'map' | 'flows' | 'graph' | 'tree' | 'report'

interface Props {
  project: ProjectSummary
  onOpenWorkspace: (tab?: WorkspaceTab) => void
  onReindex: (opts: IndexOptions) => void
  onBack: () => void
  onOpenSettings?: () => void
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
const num = (n: number) => n.toLocaleString('vi-VN')

function Card({ title, desc, status, onClick, disabled, icon, tone = 'blue' }: { title: string; desc: string; status?: ReactNode; onClick?: () => void; disabled?: boolean; icon: IconName; tone?: Tone }) {
  return (
    <button type="button" className="card" data-tone={tone} onClick={onClick} disabled={disabled}>
      <span className="card-icon"><Icon name={icon} /></span>
      <b>{title}</b>
      <span className="muted">{desc}</span>
      {status && <small className="card-status">{status}</small>}
    </button>
  )
}

export function ProjectOverviewScreen({ project, onOpenWorkspace, onReindex, onBack, onOpenSettings }: Props) {
  const pid = project.project_id
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [clusters, setClusters] = useState<string | null>(null)
  const [options, setOptions] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [integrating, setIntegrating] = useState(false)

  useEffect(() => {
    let alive = true
    window.nexgraph.graph.stats(pid).then((s) => alive && setStats(s)).catch(() => {})
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
      <header className="hero">
      <GraphArt />
      <button type="button" className="link" onClick={onBack}>{vi.overview.back}</button>
      <h1>{project.name}</h1>
      <p className="muted mono">{project.path}</p>

      <section className="graph-status" aria-label={vi.overview.statusLabel}>
        {stats ? (
          <span>{vi.overview.stats(num(stats.files), num(sum(stats.nodes_by_kind)), num(sum(stats.edges_by_type)))}</span>
        ) : <span className="muted">{vi.overview.loading}</span>}
        {when && <span className="muted">{vi.overview.lastIndexed(when)}</span>}
        {stats?.stale && <><span className="badge">{vi.overview.stale}</span> <small className="muted">{vi.overview.staleHint}</small></>}
      </section>
      </header>
      {stats?.generic_languages?.length ? <p className="muted" role="note">{vi.overview.genericLanguages(stats.generic_languages.join(', '))}</p> : null}

      <h2>{vi.overview.build}</h2>
      <div className="cards">
        <Card title={vi.overview.reindex} icon="refresh" desc={vi.overview.reindexDesc} onClick={() => onReindex({ exclude: [] })} />
        <Card title={vi.overview.options} icon="sliders" desc={vi.overview.optionsDesc} onClick={() => setOptions(true)} />
        <Card title={vi.overview.recluster} icon="cluster" desc={vi.overview.reclusterDesc} status={clusters} onClick={() => void recluster()} />
      </div>

      <h2>{vi.overview.view}</h2>
      <div className="cards">
        <Card title={vi.workspace.archTab} icon="arch" tone={VIEW_TONE.arch} desc={vi.overview.archDesc} onClick={() => onOpenWorkspace('arch')} />
        <Card title={vi.workspace.mapTab} icon="map" tone={VIEW_TONE.map} desc={vi.overview.mapDesc} onClick={() => onOpenWorkspace('map')} />
        <Card title={vi.workspace.flowsTab} icon="flows" tone={VIEW_TONE.flows} desc={vi.overview.flowsDesc} onClick={() => onOpenWorkspace('flows')} />
        <Card title={vi.workspace.graphTab} icon="graph" tone={VIEW_TONE.graph} desc={vi.overview.graphDesc} onClick={() => onOpenWorkspace('graph')} />
        <Card title={vi.workspace.treeTab} icon="tree" tone={VIEW_TONE.tree} desc={vi.overview.treeDesc} onClick={() => onOpenWorkspace('tree')} />
        <Card title={vi.workspace.reportTab} icon="report" tone={VIEW_TONE.report} desc={vi.overview.reportDesc} onClick={() => onOpenWorkspace('report')} />
      </div>

      <h2>{vi.overview.exportGroup}</h2>
      <div className="cards">
        <Card title={vi.overview.exportCard} icon="export" tone="teal" desc={vi.overview.exportDesc} onClick={() => setExporting(true)} />
      </div>

      <h2>{vi.overview.integrate}</h2>
      <div className="cards">
        <McpCard project={project} />
        <HookCard project={project} />
        <Card title={vi.integrate.card} icon="plug" tone="green" desc={vi.integrate.cardDesc} onClick={() => setIntegrating(true)} />
      </div>

      <h2>{vi.overview.ai}</h2>
      <div className="cards">
        <Card title={vi.overview.aiSettings} icon="spark" tone="violet" desc={vi.overview.aiSettingsDesc} onClick={onOpenSettings} />
        <Card title={vi.overview.semantic} icon="spark" tone="violet" desc={vi.overview.semanticDesc} status={vi.overview.wave2} disabled />
      </div>

      {options && (
        <IndexOptionsDialog onClose={() => setOptions(false)} onSubmit={(o) => { setOptions(false); onReindex(o) }} />
      )}
      {integrating && <IntegrationsDialog project={project} onClose={() => setIntegrating(false)} />}
      {exporting && <ExportDialog projectId={pid} projectName={project.name} scope={{ kind: 'all' }} onClose={() => setExporting(false)} />}
    </main>
  )
}
