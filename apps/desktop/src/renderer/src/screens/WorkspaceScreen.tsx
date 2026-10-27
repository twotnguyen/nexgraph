import { useEffect, useMemo, useState } from 'react'
import type { GraphNode, ProjectSummary } from '@shared/graph-types'
import { ChangesPanel } from '../components/changes/ChangesPanel'
import { CodeViewer } from '../components/code/CodeViewer'
import { ArchitectureCanvas } from '../components/architecture/ArchitectureCanvas'
import { ActivityBar } from '../components/layout/ActivityBar'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import type { HighlightKind } from '../components/graph/kindStyle'
import { NodeInspector } from '../components/graph/NodeInspector'
import { SearchPanel } from '../components/search/SearchPanel'
import { useChanges } from '../state/useChanges'
import { vi } from '../strings'

type Tab = 'arch' | 'graph' | `file:${string}`
interface OpenFile { file: string; line: number; lineEnd?: number }
const baseName = (p: string): string => p.split('/').pop() as string

const SearchIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
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

export function WorkspaceScreen({ project }: { project: ProjectSummary }) {
  const [panel, setPanel] = useState<string | null>('search')
  const { changes, loading, error, reload } = useChanges(project.project_id)

  // Theo dõi thư mục khi đang xem project; tắt khi rời đi để không giữ tay cầm tệp.
  useEffect(() => {
    void window.nexgraph.watch.start(project.project_id, project.path).catch(() => {})
    return () => void window.nexgraph.watch.stop(project.project_id).catch(() => {})
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
  const [tab, setTab] = useState<Tab>('arch')
  const [focus, setFocus] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [files, setFiles] = useState<OpenFile[]>([])

  const openCode = (file: string, line = 1, lineEnd?: number) => {
    setFiles((cur) => (cur.some((f) => f.file === file) ? cur.map((f) => (f.file === file ? { file, line, lineEnd } : f)) : [...cur, { file, line, lineEnd }]))
    setTab(`file:${file}`)
  }
  const closeFile = (file: string) => {
    const order: Tab[] = ['arch', 'graph', ...files.map((f) => `file:${f.file}` as Tab)]
    const at = order.indexOf(`file:${file}`)
    setFiles((cur) => cur.filter((f) => f.file !== file))
    setTab((cur) => (cur === `file:${file}` ? order[Math.max(0, at - 1)] : cur))
  }
  const openNode = (node: GraphNode) => {
    setSelected(node)
    setFocus(node.id)
    setTab('graph')
  }
  // Mở theo id (từ khối tệp hoặc bằng chứng của mũi tên): lấy chi tiết nút để thẻ thông tin có nội dung.
  const openNodeId = (id: string) => {
    setFocus(id)
    setTab('graph')
    setSelected(null)
    window.nexgraph.graph.node(project.project_id, id).then(setSelected).catch(() => {})
  }

  return (
    <div className="workspace">
      <ActivityBar
        items={[
          { id: 'search', title: vi.activity.search, icon: SearchIcon },
          { id: 'changes', title: vi.activity.changes, icon: ChangesIcon }
        ]}
        active={panel}
        onToggle={(id) => setPanel((cur) => (cur === id ? null : id))}
      />
      {panel === 'search' && (
        <aside className="sidebar">
          <SearchPanel projectId={project.project_id} onOpen={openNode} />
        </aside>
      )}
      {panel === 'changes' && (
        <aside className="sidebar wide">
          <ChangesPanel changes={changes} loading={loading} error={error} onReload={reload} onOpenNode={openNodeId} onOpenCode={openCode} />
        </aside>
      )}
      <section className="center">
        <header className="ws-head">
          <b>{project.name}</b>
          <span className="muted mono">{project.path}</span>
        </header>
        <div className="tabs" role="tablist">
          {(['arch', 'graph'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {t === 'arch' ? vi.workspace.archTab : vi.workspace.graphTab}
            </button>
          ))}
          {files.map((f) => (
            <span key={f.file} className={`tab file-tab${tab === `file:${f.file}` ? ' active' : ''}`}>
              <button type="button" role="tab" aria-selected={tab === `file:${f.file}`} title={f.file} className="tab-name" onClick={() => setTab(`file:${f.file}`)}>
                {baseName(f.file)}
              </button>
              <button type="button" className="tab-close" aria-label={`Đóng ${baseName(f.file)}`} onClick={() => closeFile(f.file)}>×</button>
            </span>
          ))}
        </div>
        <div className="canvas-wrap">
          {tab === 'arch' && <ArchitectureCanvas projectId={project.project_id} onOpenNode={openNodeId} onOpenCode={openCode} />}
          {tab === 'graph' && (
            <>
              <GraphCanvas projectId={project.project_id} startNodeId=".#repository" focusNodeId={focus} onSelect={setSelected} highlights={highlights} />
              <NodeInspector node={selected} onOpenCode={openCode} />
            </>
          )}
          {files.map((f) =>
            tab === `file:${f.file}` ? (
              <CodeViewer key={f.file} projectId={project.project_id} file={f.file} line={f.line} lineEnd={f.lineEnd} onClose={() => closeFile(f.file)} />
            ) : null
          )}
        </div>
      </section>
    </div>
  )
}
