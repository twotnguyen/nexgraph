import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Changes, ExportFormat, ExportScope, GraphEdge, GraphNode, NodeImpact, ProjectSummary } from '@shared/graph-types'
import { ChangesPanel } from '../components/changes/ChangesPanel'
import { EditorTab } from '../components/editor/EditorTab'
import { ExportDialog } from '../components/export/ExportDialog'
import { ArchitectureCanvas } from '../components/architecture/ArchitectureCanvas'
import { ActivityBar } from '../components/layout/ActivityBar'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import type { HighlightKind } from '../components/graph/kindStyle'
import { NodeContextMenu } from '../components/graph/NodeContextMenu'
import { NodeInspector } from '../components/graph/NodeInspector'
import { ReportView } from '../components/report/ReportView'
import { TreeView } from '../components/tree/TreeView'
import { SearchPanel } from '../components/search/SearchPanel'
import { FlowsView } from '../components/flows/FlowsView'
import { TourPanel } from '../components/tour/TourPanel'
import { AgentPanel } from '../components/agent/AgentPanel'
import { MapView } from '../components/map/MapView'
import { useChanges } from '../state/useChanges'
import { Logo, VIEW_TONE } from '../components/common/icons'
import { vi } from '../strings'

type Tab = 'arch' | 'map' | 'flows' | 'graph' | 'tree' | 'report' | `file:${string}`
const MAIN_TABS = ['arch', 'map', 'flows', 'graph', 'tree', 'report'] as const
interface OpenFile { file: string; line: number; lineEnd?: number }
const baseName = (p: string): string => p.split('/').pop() as string
type Overlay = { nodes: GraphNode[]; edges: GraphEdge[] }

/** Ảnh hưởng của một nút hiển thị bằng chính ChangesPanel (nút nguồn đứng ở mục "đã đổi"). */
const impactAsChanges = (i: NodeImpact): Changes => ({
  base: 'last_index', base_commit: null, note: vi.impact.title(i.node.label), changed_files: [], changed_nodes: [i.node],
  impacted: i.impacted, tests: i.tests, test_gaps: [], truncated: i.truncated
})

const SearchIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </svg>
)

const TourIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <path d="m15.5 8.5-2 5-5 2 2-5z" />
  </svg>
)

const ChangesIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="12" r="2.5" />
    <path d="M6 8.5v7M8.5 6C14 6 18 7 18 9.5" />
  </svg>
)

interface Props {
  project: ProjectSummary
  initialTab?: Tab
  initialFlowId?: number
  onBack?: () => void
  onOpenSettings?: () => void
  backLabel?: string
  indexNotice?: string
}

export function WorkspaceScreen({ project, initialTab, initialFlowId, onBack, onOpenSettings, backLabel = vi.workspace.back, indexNotice }: Props) {
  const [chatOpen, setChatOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        setChatOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const [archParent, setArchParent] = useState<string | undefined>(undefined)
  const [flowId, setFlowId] = useState<number | undefined>(initialFlowId)
  const openFlow = (id: number) => {
    setFlowId(id)
    setTab('flows')
  }
  // Trong extension bảng công cụ đóng sẵn: thanh bên của nền đã có điều hướng, nhường chỗ cho đồ thị.
  const [panel, setPanel] = useState<string | null>(window.nexgraph.host ? null : 'search')
  const live = useChanges(project.project_id)
  const [nodeImpact, setNodeImpact] = useState<NodeImpact | null>(null)
  const changes = nodeImpact ? impactAsChanges(nodeImpact) : live.changes

  // Theo dõi thư mục khi đang xem project; tắt khi rời đi để không giữ tay cầm tệp. Rời đi cũng đóng phiên agent.
  useEffect(() => {
    void window.nexgraph.watch.start(project.project_id).catch(() => {})
    return () => {
      void window.nexgraph.watch.stop(project.project_id).catch(() => {})
      // Trong extension, trợ lý sống ở view riêng của nền nên rời màn này không đóng phiên của nó.
      if (!window.nexgraph.host) void window.nexgraph.agent.close(project.project_id).catch(() => {})
    }
  }, [project.project_id, project.path])

  // Một nút vừa đổi vừa thiếu test thì hiện là "chưa có test" (đỏ); ưu tiên: gap > changed > test > impacted.
  const highlights = useMemo(() => {
    const h: Record<string, HighlightKind> = {}
    if (!changes) return h
    for (const i of changes.impacted) h[i.node.id] = 'impacted'
    for (const n of changes.tests) h[n.id] = 'test'
    for (const n of changes.changed_nodes) h[n.id] = 'changed'
    for (const n of changes.test_gaps) h[n.id] = 'gap'
    return h
  }, [changes])
  const [tab, setTab] = useState<Tab>(initialTab ?? 'arch')
  const [lastMain, setLastMain] = useState<Tab>(initialTab ?? 'arch')
  useEffect(() => {
    if (!tab.startsWith('file:')) setLastMain(tab)
  }, [tab])
  const [focus, setFocus] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [files, setFiles] = useState<OpenFile[]>([])
  const [exportScope, setExportScope] = useState<ExportScope | null>(null)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('html')
  const [menu, setMenu] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const [pathFrom, setPathFrom] = useState<GraphNode | null>(null)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!pathFrom) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPathFrom(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pathFrom])

  const clearOverlay = () => {
    setOverlay(null)
    setNotice(null)
  }
  const findPath = async (from: GraphNode, to: GraphNode) => {
    setPathFrom(null)
    try {
      const r = await window.nexgraph.graph.paths(project.project_id, [from.id, to.id])
      // Không nối được: chỉ tô hai nút, không vẽ mũi tên (spec gốc §5.8).
      setOverlay({ nodes: r.nodes, edges: r.unconnected.length ? [] : r.edges })
      setNotice(r.unconnected.length ? vi.path.noLink : vi.path.found(r.edges.length))
    } catch (e) {
      setNotice((e as { message?: string }).message ?? String(e))
    }
    setTab('graph')
  }
  const askOnGraph = async (question: string) => {
    try {
      const r = await window.nexgraph.graph.ask(project.project_id, question)
      setOverlay(r.nodes.length ? { nodes: r.nodes, edges: r.edges } : null)
      setNotice(!r.nodes.length ? vi.search.askNone : r.truncated ? vi.search.askTruncated : null)
    } catch (e) {
      setNotice((e as { message?: string }).message ?? String(e))
    }
    setTab('graph') // thông báo chỉ hiện ở tab Graph
  }
  const highlightFromChat = (nodes: GraphNode[], edges: GraphEdge[], note: string | null) => {
    setOverlay(nodes.length ? { nodes, edges } : null)
    setNotice(note)
    setTab('graph')
  }
  const openArch = (blockId: string) => {
    setArchParent(blockId)
    setTab('arch')
  }
  const openExport = (scope: ExportScope, format: ExportFormat = 'html') => {
    setExportFormat(format)
    setExportScope(scope)
  }
  const showImpact = async (node: GraphNode) => {
    try {
      setNodeImpact(await window.nexgraph.graph.impactOf(project.project_id, node.id))
      setPanel('changes')
    } catch (e) {
      setNotice((e as { message?: string }).message ?? String(e))
    }
  }

  const openCode = (file: string, line = 1, lineEnd?: number) => {
    // Trong extension, tệp mở bằng editor của nền thay cho thẻ Monaco.
    if (window.nexgraph.host) return void window.nexgraph.host.openFile(file, line, lineEnd).catch((e) => setNotice((e as Error).message))
    setFiles((cur) => (cur.some((f) => f.file === file) ? cur.map((f) => (f.file === file ? { file, line, lineEnd } : f)) : [...cur, { file, line, lineEnd }]))
    setTab(`file:${file}`)
  }
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set()) // tệp có thay đổi chưa lưu
  const onDirtyChange = useCallback((file: string, dirty: boolean) => {
    setDirtyFiles((cur) => {
      if (cur.has(file) === dirty) return cur
      const next = new Set(cur)
      if (dirty) next.add(file)
      else next.delete(file)
      return next
    })
  }, [])
  // Đóng cửa sổ khi còn tệp chưa lưu: chặn unload, main hỏi bằng hộp thoại hệ thống (will-prevent-unload).
  useEffect(() => {
    if (dirtyFiles.size === 0) return
    const block = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', block)
    return () => window.removeEventListener('beforeunload', block)
  }, [dirtyFiles.size])
  // Rời màn hình dự án làm mất mọi thẻ đang sửa nên hỏi trước, giống khi đóng một thẻ.
  const guardLeave = (go?: () => void): (() => void) | undefined =>
    go && (() => { if (dirtyFiles.size === 0 || window.confirm(vi.editor.confirmLeave(dirtyFiles.size))) go() })
  const closeFile = (file: string) => {
    if (dirtyFiles.has(file) && !window.confirm(vi.editor.confirmClose(baseName(file)))) return
    const order: Tab[] = [lastMain, ...files.map((f) => `file:${f.file}` as Tab)] // về tab chính dùng gần nhất
    const at = order.indexOf(`file:${file}`)
    setFiles((cur) => cur.filter((f) => f.file !== file))
    setTab((cur) => (cur === `file:${file}` ? order[Math.max(0, at - 1)] : cur))
  }
  // Trong extension, thanh công cụ và cây điều hướng của nền gửi lệnh vào đây. Không có mảng phụ thuộc: luôn dùng trạng thái mới nhất.
  useEffect(() => window.nexgraph.host?.onCommand((c, arg) => {
    if (c.startsWith('view:')) {
      if (c === 'view:arch') setArchParent(undefined)
      setTab(c.slice(5) as Tab)
    } else if (c.startsWith('panel:')) setPanel((cur) => (cur === c.slice(6) ? null : c.slice(6))) // bấm lại mục đang mở thì đóng
    else if (c === 'highlight') {
      const h = arg as { nodes: GraphNode[]; edges: GraphEdge[]; note: string | null }
      highlightFromChat(h.nodes, h.edges, h.note)
    }
    else if (c === 'export') openExport(tab === 'graph' && focus ? { kind: 'node', value: focus } : { kind: 'all' })
    else if (c === 'overview') guardLeave(onBack)?.()
    else if (c === 'settings') guardLeave(onOpenSettings)?.()
  }))

  const openNode = (node: GraphNode) => {
    if (pathFrom) return void findPath(pathFrom, node)
    clearOverlay()
    setSelected(node)
    setFocus(node.id)
    setTab('graph')
  }
  // Mở theo id (từ khối tệp hoặc bằng chứng của mũi tên): lấy chi tiết nút để thẻ thông tin có nội dung.
  const openNodeId = (id: string) => {
    clearOverlay()
    setFocus(id)
    setTab('graph')
    setSelected(null)
    window.nexgraph.graph.node(project.project_id, id).then(setSelected).catch(() => {})
  }

  const hosted = !!window.nexgraph.host
  const closePanel = hosted && <button type="button" className="panel-close" aria-label={vi.workspace.closePanel} onClick={() => setPanel(null)}>×</button>

  return (
    <div className="workspace">
      {/* Trong extension, thanh bên của nền đã có mục Công cụ nên không dựng dải icon thứ hai. */}
      {!hosted && (
        <ActivityBar
          items={[
            { id: 'search', title: vi.activity.search, icon: SearchIcon },
            { id: 'changes', title: vi.activity.changes, icon: ChangesIcon },
            { id: 'tour', title: vi.activity.tour, icon: TourIcon }
          ]}
          active={panel}
          onToggle={(id) => setPanel((cur) => (cur === id ? null : id))}
        />
      )}
      {panel === 'search' && (
        <aside className="sidebar">
          {closePanel}
          <SearchPanel projectId={project.project_id} onOpen={openNode} onShowSubgraph={(g) => { setOverlay(g); setNotice(null); setTab('graph') }} onOpenFlow={openFlow} />
        </aside>
      )}
      {panel === 'tour' && (
        <aside className="sidebar wide">
          {closePanel}
          <TourPanel projectId={project.project_id} projectName={project.name} onOpenFlow={openFlow} onOpenNode={openNodeId} onOpenArch={openArch} />
        </aside>
      )}
      {panel === 'changes' && (
        <aside className="sidebar wide">
          {closePanel}
          {nodeImpact && (
            <button type="button" className="link back" onClick={() => setNodeImpact(null)}>{vi.impact.back}</button>
          )}
          <ChangesPanel changes={changes} loading={!nodeImpact && live.loading} error={nodeImpact ? null : live.error}
            onReload={nodeImpact ? () => void showImpact(nodeImpact.node) : live.reload} onOpenNode={openNodeId} onOpenCode={openCode} />
        </aside>
      )}
      <section className="center">
        <header className="ws-head">
          {onBack && <button type="button" className="link" onClick={guardLeave(onBack)}>{backLabel}</button>}
          <b className="ws-name"><Logo size={18} /> {project.name}</b>
          <span className="muted mono">{project.path}</span>
          <span className="ws-actions">
            <button type="button" aria-label={vi.chat.toggle} aria-pressed={chatOpen} onClick={() => setChatOpen((v) => !v)}>{vi.chat.title}</button>
            <button type="button" onClick={() => openExport(tab === 'graph' && focus ? { kind: 'node', value: focus } : { kind: 'all' })}>
              {vi.workspace.export}
            </button>
          </span>
        </header>
        {indexNotice && <div role="status" className="ws-index-status muted">{indexNotice}</div>}
        {exportScope && (
          <ExportDialog projectId={project.project_id} projectName={project.name} scope={exportScope} initialFormat={exportFormat}
            onClose={() => setExportScope(null)} />
        )}
        {pathFrom && (
          <div role="status" aria-label={vi.path.pickingLabel} className="pick-banner">
            {vi.path.picking(pathFrom.label)}
            <button type="button" onClick={() => setPathFrom(null)}>{vi.path.cancel}</button>
          </div>
        )}
        <div className="tabs" role="tablist">
          {MAIN_TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} data-tone={VIEW_TONE[t]} className={`tab${tab === t ? ' active' : ''}`} onClick={() => { if (t === 'arch') setArchParent(undefined); setTab(t) }}>
              {{ arch: vi.workspace.archTab, map: vi.workspace.mapTab, flows: vi.workspace.flowsTab, graph: vi.workspace.graphTab, tree: vi.workspace.treeTab, report: vi.workspace.reportTab }[t]}
            </button>
          ))}
          {files.map((f) => (
            <span key={f.file} className={`tab file-tab${tab === `file:${f.file}` ? ' active' : ''}`}>
              <button type="button" role="tab" aria-selected={tab === `file:${f.file}`} title={f.file} className="tab-name" onClick={() => setTab(`file:${f.file}`)}>
                {baseName(f.file)}
                {dirtyFiles.has(f.file) && <span className="dirty-dot" aria-hidden="true"> ●</span>}
              </button>
              <button type="button" className="tab-close" aria-label={`Đóng ${baseName(f.file)}`} onClick={() => closeFile(f.file)}>×</button>
            </span>
          ))}
        </div>
        <div className="canvas-wrap">
          {tab === 'arch' && <ArchitectureCanvas key={archParent ?? 'root'} projectId={project.project_id} initialParent={archParent} onOpenNode={openNodeId} onOpenCode={openCode} />}
          {tab === 'map' && <MapView projectId={project.project_id} onOpenNode={openNodeId} onOpenCode={openCode} onOpenArch={openArch} />}
          {tab === 'flows' && <FlowsView projectId={project.project_id} initialFlowId={flowId} onOpenCode={openCode} onOpenNode={openNodeId} />}
          {tab === 'graph' && (
            <>
              <GraphCanvas projectId={project.project_id} startNodeId=".#repository" focusNodeId={focus} highlights={highlights}
                onSelect={(n) => (pathFrom ? void findPath(pathFrom, n) : setSelected(n))}
                onNodeContextMenu={(node, x, y) => setMenu({ node, x, y })}
                overlay={overlay} onClearOverlay={clearOverlay} />
              {notice && <p role="status" className="path-notice">{notice}</p>}
              <NodeInspector node={selected} onOpenCode={openCode} projectId={project.project_id} onOpenNode={openNode} />
              {menu && (
                <NodeContextMenu node={menu.node} x={menu.x} y={menu.y} onClose={() => setMenu(null)}
                  onFindPath={(n) => { clearOverlay(); setPathFrom(n) }}
                  onImpact={(n) => void showImpact(n)}
                  onExport={(n) => openExport({ kind: 'node', value: n.id })} />
              )}
            </>
          )}
          {tab === 'tree' && <TreeView projectId={project.project_id} onOpenNode={openNodeId} onOpenCode={openCode} />}
          {tab === 'report' && (
            <ReportView projectId={project.project_id} onOpenNode={openNodeId} onAsk={(q) => void askOnGraph(q)}
              onExportMarkdown={() => openExport({ kind: 'all' }, 'markdown')} />
          )}
          {files.map((f) => (
            <EditorTab key={f.file} projectId={project.project_id} file={f.file} line={f.line} lineEnd={f.lineEnd} active={tab === `file:${f.file}`}
              onClose={() => closeFile(f.file)} onDirtyChange={onDirtyChange} />
          ))}
        </div>
      </section>
      {!window.nexgraph.host && <AgentPanel hidden={!chatOpen} projectId={project.project_id} projectName={project.name} onOpenCode={openCode} onHighlight={highlightFromChat} onOpenSettings={guardLeave(onOpenSettings) ?? (() => {})} />}
    </div>
  )
}
