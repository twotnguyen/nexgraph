import { useEffect, useState, type ReactNode } from 'react'
import type { GraphStats, IndexOptions, ProjectAiSettings, ProjectSummary } from '@shared/graph-types'
import { ExportDialog } from '../components/export/ExportDialog'
import { IndexOptionsDialog } from '../components/overview/IndexOptionsDialog'
import { Icon, VIEW_TONE, type IconName, type Tone } from '../components/common/icons'
import { HookCard } from '../components/overview/HookCard'
import { IntegrationsDialog } from '../components/overview/IntegrationsDialog'
import { McpCard } from '../components/overview/McpCard'
import { SourcesPanel } from '../components/overview/SourcesPanel'
import { SemanticDialog } from '../components/overview/SemanticDialog'
import { vi } from '../strings'
import './welcome.css'
import './overview.css'

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
  const [statsError, setStatsError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [reclustering, setReclustering] = useState(false)
  const [clusterError, setClusterError] = useState<string | null>(null)
  const [options, setOptions] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [integrating, setIntegrating] = useState(false)
  const [semantic, setSemantic] = useState<'run' | 'labels' | null>(null)
  const [ai, setAi] = useState<ProjectAiSettings | null>(null)
  useEffect(() => {
    void window.nexgraph.semantic.getSettings(pid).then(setAi, () => setAi(null))
  }, [pid])

  useEffect(() => {
    let alive = true
    let newest = 0
    const read = () => {
      const request = ++newest
      setStatsError(null)
      void window.nexgraph.graph.stats(pid).then(
        (value) => { if (alive && request === newest) setStats(value) },
        (error: { message?: string }) => { if (alive && request === newest) setStatsError(error?.message ?? String(error)) }
      )
    }
    read()
    const off = window.nexgraph.index.onEvent((event) => {
      if (event.project_id !== pid) return
      if (event.type === 'job_progress' && event.state === 'done') read()
      if (event.type === 'graph_updated') read()
    })
    return () => {
      alive = false
      off()
    }
  }, [pid, refresh])

  const recluster = async () => {
    if (reclustering) return
    setReclustering(true)
    setClusters(null)
    setClusterError(null)
    try {
      const r = await window.nexgraph.graph.recluster(pid)
      setClusters(vi.overview.clusters(r.communities))
    } catch (e) {
      setClusterError((e as { message?: string }).message ?? String(e))
    } finally {
      setReclustering(false)
    }
  }

  const indexedAt = stats?.indexed_at ?? project.last_indexed_at
  const when = indexedAt == null ? null : new Date(indexedAt * 1000).toLocaleString('vi-VN')
  const nodeCount = stats ? sum(stats.nodes_by_kind) : 0
  const noGraph = stats?.files === 0 && nodeCount === 0
  return (
    <main className="screen overview welcome-page">
      <div className="welcome welcome-wide">
      <button type="button" className="welcome-back" onClick={onBack}>{vi.overview.back}</button>
      <header className="welcome-head">
        <span className="welcome-icon"><Icon name="folder" size={22} /></span>
        <div><h1>{project.name}</h1><p className="mono" title={project.path}>{project.path}</p></div>
      </header>
      <section className="workbench-panel overview-metrics" aria-label={vi.overview.statusLabel} aria-busy={!stats && !statsError}>
        <header className="panel-title">
          <h2>Tình trạng đồ thị</h2>
          {when && <span className="muted">{vi.overview.lastIndexed(when)}</span>}
        </header>
        {stats ? (
          <div className="graph-metrics" aria-label={vi.overview.stats(num(stats.files), num(nodeCount), num(sum(stats.edges_by_type)))}>
            <div><strong>{num(stats.files)}</strong><span>Tệp đã lập chỉ mục</span></div>
            <div><strong>{num(nodeCount)}</strong><span>Nút</span></div>
            <div><strong>{num(sum(stats.edges_by_type))}</strong><span>Quan hệ</span></div>
          </div>
        ) : !statsError && <div className="panel-empty"><p className="muted">{vi.overview.loading}</p><div className="skeleton-line" /></div>}
        {statsError && <div className="inline-message error" role="alert">
          {statsError} <button type="button" onClick={() => setRefresh((value) => value + 1)}>Tải lại số liệu</button>
        </div>}
        {noGraph ? <div className="inline-message" role="status">Chưa có dữ liệu đồ thị. Chọn <strong>{vi.overview.reindex}</strong> để đọc lại thư mục này.</div>
          : stats?.stale ? <div className="inline-message warning" role="status"><strong>{vi.overview.stale}</strong><span>{vi.overview.staleHint}</span></div>
          : stats?.changed_files === null && <div className="inline-message">Chưa xác minh được đồ thị có khớp với mã nguồn hiện tại.</div>}
      </section>
      {stats?.generic_languages?.length ? <p className="muted" role="note">{vi.overview.genericLanguages(stats.generic_languages.join(', '))}</p> : null}

      <h2>{vi.overview.build}</h2>
      <div className="cards">
        <Card title={vi.overview.reindex} icon="refresh" desc={vi.overview.reindexDesc} onClick={() => onReindex({ exclude: [] })} />
        <Card title={vi.overview.options} icon="sliders" desc={vi.overview.optionsDesc} onClick={() => setOptions(true)} />
        <Card title={vi.overview.recluster} icon="cluster" desc={vi.overview.reclusterDesc}
          status={reclustering ? vi.overview.reclustering : clusters} disabled={reclustering || noGraph} onClick={() => void recluster()} />
        <Card title={vi.semantic.labelsCard} icon="spark" tone="violet" desc={vi.semantic.labelsDesc} disabled={noGraph} onClick={() => setSemantic('labels')} />
      </div>
      {clusterError && <p role="alert" className="inline-message error">{clusterError}</p>}
      <SourcesPanel projectId={pid} />

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
        <Card title={vi.overview.semantic} icon="spark" tone="violet" desc={vi.semantic.cardDesc} disabled={noGraph}
          status={ai?.enabled ? vi.semantic.on(ai.model ?? '') : vi.semantic.off} onClick={() => setSemantic('run')} />
      </div>

      {options && (
        <IndexOptionsDialog projectId={pid} onClose={() => setOptions(false)} onSubmit={(o) => { setOptions(false); onReindex(o) }} />
      )}
      {semantic && <SemanticDialog projectId={pid} target={semantic === 'labels' ? 'labels' : undefined} onSettings={setAi} onClose={() => setSemantic(null)} />}
      {integrating && <IntegrationsDialog project={project} onClose={() => setIntegrating(false)} />}
      {exporting && <ExportDialog projectId={pid} projectName={project.name} scope={{ kind: 'all' }} onClose={() => setExporting(false)} />}
      </div>
    </main>
  )
}
