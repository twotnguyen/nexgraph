import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Changes, ExportFormat, ExportScope, GraphEdge, GraphNode, NodeImpact, ProjectSummary } from '@shared/graph-types'
import type { HostCommand } from '@shared/api'
import { ChangesPanel } from '../components/changes/ChangesPanel'
import { EditorTab, type EditorContextGetter } from '../components/editor/EditorTab'
import type { AgentContextItem, AgentEditorState } from '@shared/agent-types'
import type { AgentInspection } from '../components/agent/useAgentWorkbench'
import { TaskInspector } from '../components/agent/TaskInspector'
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
import { IntegrationsDialog } from '../components/overview/IntegrationsDialog'
import { MapView } from '../components/map/MapView'
import { PrsView } from '../components/prs/PrsView'
import { useChanges } from '../state/useChanges'
import { Icon, VIEW_TONE } from '../components/common/icons'
import { openThemePicker } from '../components/layout/ThemePicker'
import { FileTypeIcon } from '../components/common/FileTypeIcon'
import { vi } from '../strings'
import './workspace.css'

type Tab = 'arch' | 'map' | 'flows' | 'graph' | 'tree' | 'report' | 'prs' | `file:${string}` | `task:${string}`
const MAIN_TABS = ['arch', 'map', 'flows', 'graph', 'tree', 'report'] as const
const TAB_LABELS = { arch: vi.workspace.archTab, map: vi.workspace.mapTab, flows: vi.workspace.flowsTab,
  graph: vi.workspace.graphTab, tree: vi.workspace.treeTab, report: vi.workspace.reportTab }
/** `seq`: mỗi lần mở một số mới, để mở lại đúng dòng cũ (đã cuộn đi chỗ khác) vẫn cuộn về. */
interface OpenFile { file: string; line: number; lineEnd?: number; seq: number }
const baseName = (p: string): string => p.split(/[/\\]/).pop() ?? p
type Overlay = { nodes: GraphNode[]; edges: GraphEdge[] }
type Panel = 'explorer' | 'search' | 'changes' | 'tour'
const PANEL_TITLES: Record<Panel, string> = {
  explorer: 'Duyệt tệp', search: vi.activity.search, changes: vi.activity.changes, tour: vi.activity.tour
}
const messageOf = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)

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

const FilesIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 3h8l4 4v12H8zM15 3v5h5M4 7v14h12" />
  </svg>
)

const FileIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3h8l4 4v14H6zM13 3v5h5M9.5 12l-1.5 1.5 1.5 1.5M14.5 12l1.5 1.5-1.5 1.5" />
  </svg>
)

const ACTIVITIES = [
  { id: 'explorer', title: PANEL_TITLES.explorer, icon: FilesIcon },
  { id: 'search', title: PANEL_TITLES.search, icon: SearchIcon },
  { id: 'changes', title: PANEL_TITLES.changes, icon: ChangesIcon },
  { id: 'tour', title: PANEL_TITLES.tour, icon: TourIcon }
] satisfies { id: Panel; title: string; icon: typeof SearchIcon }[]
const AGENT_ACTIVITY = { id: 'agent', title: vi.chat.title, icon: <Icon name="spark" size={20} /> }
type ChatDock = 'left' | 'right'

interface Props {
  project: ProjectSummary
  initialTab?: Tab
  initialFlowId?: number
  onBack?: () => void
  onOpenSettings?: () => void
  backLabel?: string
  indexNotice?: string
  initialCommand?: HostCommand
}

export function WorkspaceScreen({ project, initialTab, initialFlowId, onBack, onOpenSettings, backLabel = vi.workspace.back, indexNotice, initialCommand }: Props) {
  const hosted = !!window.nexgraph?.host
  const id = useId()
  const tabList = useRef<HTMLDivElement>(null)
  const focusTabAfterClose = useRef(false)
  const graphRequest = useRef(0)
  const nodeRequest = useRef(0)
  const impactRequest = useRef(0)
  const hostInitialHandled = useRef(false)
  const [revision, setRevision] = useState(0)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [chatDock, setChatDock] = useState<ChatDock>(() => { try { return localStorage.getItem('nexgraph.chat.dock') === 'right' ? 'right' : 'left' } catch { return 'left' } })
  // Kiểu Wu (trái): khung chat dùng chung chỗ với bảng công cụ nên mặc định đóng để cây tệp hiện trước.
  const [chatOpen, setChatOpen] = useState(() => !hosted && chatDock === 'right' && (window.matchMedia?.('(min-width: 980px)').matches ?? true))
  const [connectOpenCode, setConnectOpenCode] = useState(false)
  const editorContexts = useRef(new Map<string, EditorContextGetter>())
  const [inspections, setInspections] = useState<AgentInspection[]>([])
  const [chatWidth, setChatWidth] = useState(() => { try { return Math.max(300, Math.min(640, Number(localStorage.getItem('nexgraph.chat.width')) || 360)) } catch { return 360 } })
  const resize = useRef<{ x: number; width: number } | null>(null)
  const saveChatWidth = (width: number) => {
    const next = Math.max(300, Math.min(640, Math.max(300, window.innerWidth - 560), width))
    setChatWidth(next)
    try { localStorage.setItem('nexgraph.chat.width', String(next)) } catch { /* preference only */ }
  }
  const toggleDock = () => {
    const next: ChatDock = chatDock === 'left' ? 'right' : 'left'
    setChatDock(next)
    try { localStorage.setItem('nexgraph.chat.dock', next) } catch { /* preference only */ }
  }
  const leftChat = !hosted && chatOpen && chatDock === 'left'
  const flushEditorState = useCallback(async () => {
    const states: AgentEditorState[] = []
    for (const [file, get] of editorContexts.current) {
      const snapshot = get()
      if (snapshot) states.push({ file, dirty: snapshot.dirty === true, version: snapshot.version })
    }
    await window.nexgraph.agent.editorState(project.project_id, states)
  }, [project.project_id])
  const contextReady = useCallback((file: string, get: EditorContextGetter | null) => {
    if (get) editorContexts.current.set(file, get)
    else editorContexts.current.delete(file)
    void flushEditorState().catch(() => {})
  }, [flushEditorState])
  useEffect(() => {
    if (hosted) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        setChatOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hosted])
  const [archParent, setArchParent] = useState<string | undefined>(undefined)
  const [archContext, setArchContext] = useState<string | undefined>(undefined)
  const [flowId, setFlowId] = useState<number | undefined>(initialFlowId)
  const [flowContext, setFlowContext] = useState<number | undefined>(undefined)
  // Tăng ở mỗi lần mở luồng/khối/tệp: mở lại cùng đích sau khi người dùng đã đi chỗ khác vẫn có tác dụng.
  const [openSeq, setOpenSeq] = useState(0)
  const openFlow = (id: number) => {
    setFlowContext(undefined)
    setFlowId(id)
    setOpenSeq((n) => n + 1)
    setTab('flows')
  }
  // Cây dùng cùng bảng duyệt tệp ở cả ứng dụng độc lập và Code-OSS.
  const [panel, setPanel] = useState<Panel | null>(!hosted || initialTab === 'tree' ? 'explorer' : null)
  // Ở bên trái, mở một bảng công cụ (cây tệp, ảnh hưởng…) thì nhường chỗ: đóng khung chat. Chỉ chạy khi bảng đổi.
  const dockRef = useRef(chatDock)
  dockRef.current = chatDock
  useEffect(() => { if (panel && dockRef.current === 'left') setChatOpen(false) }, [panel])
  const live = useChanges(project.project_id)
  const [nodeImpact, setNodeImpact] = useState<NodeImpact | null>(null)
  const [impactPending, setImpactPending] = useState(false)
  const changes = impactPending ? null : nodeImpact ? impactAsChanges(nodeImpact) : live.changes

  // Theo dõi thư mục khi đang xem project; tắt khi rời đi để không giữ tay cầm tệp. Rời đi cũng đóng phiên agent.
  useEffect(() => {
    let current = true
    void window.nexgraph.watch.start(project.project_id).catch((error: unknown) => {
      if (current) setFeedback(`Không theo dõi được thay đổi của tệp. ${messageOf(error)}`)
    })
    return () => {
      current = false
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
  // Tab Pull request chỉ hiện khi có remote GitHub và `gh` đã đăng nhập.
  const [prsAvailable, setPrsAvailable] = useState(false)
  useEffect(() => {
    let alive = true
    setPrsAvailable(false)
    window.nexgraph.prs.status(project.project_id).then((s) => alive && setPrsAvailable(s.available)).catch(() => {})
    return () => { alive = false }
  }, [project.project_id])
  const activeFile = tab.startsWith('file:') ? tab.slice('file:'.length) : undefined
  const [lastMain, setLastMain] = useState<Tab>(initialTab ?? 'arch')
  useEffect(() => {
    if (!tab.startsWith('file:') && !tab.startsWith('task:')) setLastMain(tab)
  }, [tab])
  const [focus, setFocus] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [files, setFiles] = useState<OpenFile[]>([])
  const chatFile = files.find(({ file }) => file === activeFile)
  const [exportScope, setExportScope] = useState<ExportScope | null>(null)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('html')
  const [menu, setMenu] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const [pathFrom, setPathFrom] = useState<GraphNode | null>(null)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const inspect = (inspection: AgentInspection) => {
    setInspections((current) => current.some((item) => item.id === inspection.id) ? current.map((item) => item.id === inspection.id ? inspection : item) : [...current, inspection])
    setTab(`task:${inspection.id}`)
  }
  const graphContext: AgentContextItem | undefined = tab === 'graph' && selected ? { kind: 'node', nodeId: selected.id, label: selected.label }
    : tab === 'flows' && flowContext !== undefined ? { kind: 'flow', flowId: flowContext, label: `Luồng ${flowContext}` }
    : tab === 'arch' ? { kind: 'architecture', blockId: archContext ?? 'root', label: archContext ?? 'Kiến trúc dự án' } : undefined

  useEffect(() => window.nexgraph.index.onEvent((event) => {
    if (event.type !== 'graph_updated' || event.project_id !== project.project_id) return
    graphRequest.current++
    nodeRequest.current++
    impactRequest.current++
    setRevision((value) => value + 1)
    setSelected(null)
    setOverlay(null)
    setNotice(null)
    setNodeImpact(null)
    setImpactPending(false)
    setPathFrom(null)
    setMenu(null)
  }), [project.project_id])

  useEffect(() => {
    if (!focusTabAfterClose.current) return
    focusTabAfterClose.current = false
    tabList.current?.querySelector<HTMLButtonElement>('[role=tab][aria-selected=true]')?.focus()
  }, [tab])

  useEffect(() => {
    if (!pathFrom) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPathFrom(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pathFrom])

  const clearOverlay = () => {
    graphRequest.current++
    setOverlay(null)
    setNotice(null)
  }
  const findPath = async (from: GraphNode, to: GraphNode) => {
    const request = ++graphRequest.current
    setTab('graph')
    setPathFrom(null)
    setOverlay(null)
    setNotice('Đang tìm đường nối…')
    try {
      const r = await window.nexgraph.graph.paths(project.project_id, [from.id, to.id])
      if (request !== graphRequest.current) return
      // Không nối được: chỉ tô hai nút, không vẽ mũi tên (spec gốc §5.8).
      setOverlay({ nodes: r.nodes, edges: r.unconnected.length ? [] : r.edges })
      setNotice(r.unconnected.length ? vi.path.noLink : vi.path.found(r.edges.length, r.confidence ?? null))
    } catch (e) {
      if (request === graphRequest.current) {
        setFeedback(messageOf(e))
        setNotice(null)
      }
    }
  }
  const askOnGraph = async (question: string) => {
    const request = ++graphRequest.current
    setTab('graph')
    setOverlay(null)
    setNotice(vi.search.asking)
    try {
      const r = await window.nexgraph.graph.ask(project.project_id, question)
      if (request !== graphRequest.current) return
      setOverlay(r.nodes.length ? { nodes: r.nodes, edges: r.edges } : null)
      setNotice(!r.nodes.length ? vi.search.askNone : r.truncated ? vi.search.askTruncated : null)
    } catch (e) {
      if (request === graphRequest.current) {
        setFeedback(messageOf(e))
        setNotice(null)
      }
    }
  }
  const highlightFromChat = (nodes: GraphNode[], edges: GraphEdge[], note: string | null) => {
    graphRequest.current++
    setOverlay(nodes.length ? { nodes, edges } : null)
    setNotice(note)
    setTab('graph')
  }
  const openArch = (blockId: string) => {
    setArchParent(blockId)
    setArchContext(blockId)
    setOpenSeq((n) => n + 1)
    setTab('arch')
  }
  const openExport = (scope: ExportScope, format: ExportFormat = 'html') => {
    setExportFormat(format)
    setExportScope(scope)
  }
  const exportCurrent = () => {
    const node = selected?.id ?? (overlay ? null : focus)
    openExport(tab === 'graph' && node ? { kind: 'node', value: node } : { kind: 'all' })
  }
  const showImpact = async (node: GraphNode) => {
    const request = ++impactRequest.current
    setPanel('changes')
    setImpactPending(true)
    try {
      const impact = await window.nexgraph.graph.impactOf(project.project_id, node.id)
      if (request === impactRequest.current) setNodeImpact(impact)
    } catch (e) {
      if (request === impactRequest.current) setFeedback(messageOf(e))
    } finally {
      if (request === impactRequest.current) setImpactPending(false)
    }
  }

  const openCode = (file: string, line = 1, lineEnd?: number) => {
    // Trong extension, tệp mở bằng editor của nền thay cho thẻ Monaco.
    if (window.nexgraph.host) return void window.nexgraph.host.openFile(file, line, lineEnd).catch((e: unknown) => setFeedback(messageOf(e)))
    const seq = openSeq + 1
    setOpenSeq(seq)
    setFiles((cur) => (cur.some((f) => f.file === file) ? cur.map((f) => (f.file === file ? { file, line, lineEnd, seq } : f)) : [...cur, { file, line, lineEnd, seq }]))
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
    void flushEditorState().catch((e) => setFeedback(messageOf(e)))
  }, [flushEditorState])
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
    const next = order[Math.max(0, at - 1)]
    if (tab === `file:${file}`) {
      focusTabAfterClose.current = true
      if (next === 'tree') setPanel('explorer')
    }
    setFiles((cur) => cur.filter((f) => f.file !== file))
    setTab((cur) => (cur === `file:${file}` ? next : cur))
  }
  const selectView = (view: (typeof MAIN_TABS)[number]) => {
    if (view === 'tree') {
      setPanel('explorer')
      if (activeFile) {
        setLastMain('tree')
        return
      }
    }
    if (view === 'arch') setArchParent(undefined)
    setTab(view)
  }
  // Trong extension, thanh công cụ và cây điều hướng của nền gửi lệnh vào đây. Không có mảng phụ thuộc: luôn dùng trạng thái mới nhất.
  useEffect(() => {
    const applyCommand = (c: string, arg?: unknown) => {
      if (c.startsWith('view:')) {
        const view = c.slice(5) as (typeof MAIN_TABS)[number]
        if (!MAIN_TABS.includes(view)) return
        selectView(view)
      } else if (c.startsWith('panel:')) {
        const tool = c.slice(6)
        if (Object.hasOwn(PANEL_TITLES, tool)) setPanel((cur) => cur === tool ? null : tool as Panel)
      } else if (c === 'highlight') {
        const h = arg as { nodes: GraphNode[]; edges: GraphEdge[]; note: string | null } | undefined
        if (Array.isArray(h?.nodes) && Array.isArray(h?.edges)) highlightFromChat(h.nodes, h.edges, h.note)
      } else if (c === 'export') exportCurrent()
      else if (c === 'overview') guardLeave(onBack)?.()
      else if (c === 'settings') guardLeave(onOpenSettings)?.()
    }
    if (hosted && initialCommand && !hostInitialHandled.current) {
      hostInitialHandled.current = true
      applyCommand(initialCommand.name, initialCommand.arg)
    }
    return window.nexgraph.host?.onCommand(applyCommand)
  })

  const openNode = (node: GraphNode) => {
    if (pathFrom) return void findPath(pathFrom, node)
    nodeRequest.current++
    clearOverlay()
    setSelected(node)
    setFocus(node.id)
    setTab('graph')
  }
  // Mở theo id (từ khối tệp hoặc bằng chứng của mũi tên): lấy chi tiết nút để thẻ thông tin có nội dung.
  const openNodeId = (id: string) => {
    const request = ++nodeRequest.current
    clearOverlay()
    setFocus(id)
    setTab('graph')
    setSelected(null)
    void window.nexgraph.graph.node(project.project_id, id)
      .then((node) => { if (request === nodeRequest.current) setSelected(node) })
      .catch((error: unknown) => { if (request === nodeRequest.current) setFeedback(messageOf(error)) })
  }

  const onTabKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLButtonElement)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'))
    const index = buttons.indexOf(event.target)
    if (index < 0) return
    let next
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    else if (event.key === 'ArrowRight') next = (index + 1) % buttons.length
    else if (event.key === 'ArrowLeft') next = (index + buttons.length - 1) % buttons.length
    else return
    event.preventDefault()
    buttons[next]?.focus()
    buttons[next]?.click()
  }
  const tabId = (name: Tab) => `${id}-${encodeURIComponent(name)}`
  const viewId = `${id}-view`
  const toolsId = `${id}-tools`
  const chatId = `${id}-chat`
  const togglePanel = (key: string) => {
    if (key === AGENT_ACTIVITY.id) return setChatOpen((v) => !v)
    if (!Object.hasOwn(PANEL_TITLES, key)) return
    if (leftChat) {
      setChatOpen(false)
      setPanel(key as Panel)
    } else setPanel((cur) => cur === key ? null : key as Panel)
  }
  // Kéo thanh chia: khung trái rộng ra khi kéo sang phải, khung phải rộng ra khi kéo sang trái.
  const grow = chatDock === 'left' ? 1 : -1
  const resizeHandle = !hosted && chatOpen && <div className="agent-resize-handle" role="separator" aria-label="Độ rộng trợ lý AI" aria-orientation="vertical" tabIndex={0} aria-valuemin={300} aria-valuemax={640} aria-valuenow={chatWidth}
    onPointerDown={(event) => { resize.current = { x: event.clientX, width: chatWidth }; event.currentTarget.setPointerCapture(event.pointerId) }}
    onPointerMove={(event) => { if (resize.current) saveChatWidth(resize.current.width + grow * (event.clientX - resize.current.x)) }}
    onPointerUp={() => { resize.current = null }} onPointerCancel={() => { resize.current = null }}
    onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); saveChatWidth(chatWidth + grow * (event.key === 'ArrowRight' ? 20 : -20)) } }} />
  const agentPanel = !hosted && <AgentPanel id={chatId} hidden={!chatOpen} projectId={project.project_id} projectName={project.name}
    activeFile={chatFile} onClose={() => setChatOpen(false)} onConnectOpenCode={() => setConnectOpenCode(true)}
    getEditorContext={() => activeFile ? editorContexts.current.get(activeFile)?.() ?? null : null} graphContext={graphContext} beforePrompt={flushEditorState} onInspect={inspect}
    onOpenCode={openCode} onHighlight={highlightFromChat} onOpenSettings={guardLeave(onOpenSettings) ?? (() => {})} dock={chatDock} onToggleDock={toggleDock} />

  return (
    <div className="workspace workspace-shell" data-hosted={hosted || undefined} data-chat-dock={chatDock} style={{ '--ws-chat': `${chatWidth}px` } as CSSProperties}>
      {/* Trong extension, thanh bên của nền đã có mục Công cụ nên không dựng dải icon thứ hai. */}
      {!hosted && (
        <ActivityBar
          items={[...(chatDock === 'left' ? [AGENT_ACTIVITY] : []), ...ACTIVITIES.map((a) => a.id === 'changes' ? { ...a, badge: live.changes?.changed_files.length } : a)]}
          active={leftChat ? AGENT_ACTIVITY.id : panel}
          panelId={leftChat ? chatId : toolsId}
          onToggle={togglePanel}
          manage={[
            ...(onOpenSettings ? [{ label: 'Cài đặt', icon: 'sliders' as const, onSelect: () => guardLeave(onOpenSettings)?.() }] : []),
            { label: 'Chọn theme…', icon: 'palette', onSelect: openThemePicker }
          ]}
        />
      )}
      {chatDock === 'left' && <>{agentPanel}{resizeHandle}</>}
      {panel && !leftChat && (
        <aside id={toolsId} className={`sidebar ws-tools ws-tools-${panel}`} aria-label={PANEL_TITLES[panel]}>
          <div className="ws-tools-head">
            <h2>{PANEL_TITLES[panel]}</h2>
            <button type="button" className="ws-icon-button" aria-label={vi.workspace.closePanel} title={vi.workspace.closePanel}
              onClick={() => setPanel(null)}><Icon name="close" size={15} /></button>
          </div>
          {panel === 'explorer' && (
            <div className="ws-project-root" title={project.path}>
              <Icon name="folder" size={16} /><span>{project.name}</span>
            </div>
          )}
          <div className="ws-tools-body">
            {panel === 'explorer' && (
              <TreeView projectId={project.project_id} activeFile={activeFile} revision={revision} onOpenNode={openNodeId} onOpenCode={openCode} compact />
            )}
            {panel === 'search' && (
              <SearchPanel projectId={project.project_id} revision={revision} onOpen={openNode}
                onShowSubgraph={(g) => highlightFromChat(g.nodes, g.edges, null)} onOpenFlow={openFlow} />
            )}
            {panel === 'tour' && (
              <TourPanel projectId={project.project_id} revision={revision} projectName={project.name} onOpenFlow={openFlow} onOpenNode={openNodeId} onOpenArch={openArch} />
            )}
            {panel === 'changes' && (
              <>
                {nodeImpact && !impactPending && (
                  <button type="button" className="link back" onClick={() => setNodeImpact(null)}>{vi.impact.back}</button>
                )}
                <ChangesPanel changes={changes} loading={impactPending || (!nodeImpact && live.loading)} error={nodeImpact || impactPending ? null : live.error}
                  onReload={nodeImpact ? () => void showImpact(nodeImpact.node) : live.reload} onOpenNode={openNodeId} onOpenCode={openCode} />
              </>
            )}
          </div>
        </aside>
      )}
      <section className="center">
        <header className="ws-head">
          {onBack && <button type="button" className="ws-icon-button ws-back" title={backLabel} aria-label={backLabel} onClick={guardLeave(onBack)}>←</button>}
          <span className="ws-path muted mono" title={project.path}>{project.path}</span>
          <span className="ws-actions">
            {!hosted && <button type="button" aria-label={vi.chat.toggle} title={`${vi.chat.toggle} · Ctrl+L`} aria-pressed={chatOpen}
              aria-controls={chatId} onClick={() => setChatOpen((v) => !v)}>
              <Icon name="spark" size={16} /><span>{vi.chat.title}</span>
            </button>}
            <button type="button" aria-label={vi.workspace.export} title={vi.workspace.export} onClick={exportCurrent}>
              <Icon name="export" size={16} /><span>{vi.workspace.export}</span>
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
        <div className="tabs ws-tabs" role="tablist" aria-label="Các thẻ không gian làm việc" ref={tabList} onKeyDown={onTabKeys}>
          {MAIN_TABS.map((t) => (
            <button key={t} id={tabId(t)} type="button" role="tab" aria-selected={tab === t} aria-controls={viewId} tabIndex={tab === t ? 0 : -1}
              data-tone={VIEW_TONE[t]} className={`tab${tab === t ? ' active' : ''}`} onClick={() => selectView(t)}>
              <Icon name={t} size={16} /><span>{TAB_LABELS[t]}</span>
            </button>
          ))}
          {prsAvailable && (
            <button id={tabId('prs')} type="button" role="tab" aria-selected={tab === 'prs'} aria-controls={viewId} tabIndex={tab === 'prs' ? 0 : -1}
              data-tone="teal" className={`tab${tab === 'prs' ? ' active' : ''}`} onClick={() => setTab('prs')}>
              <Icon name="pr" size={16} /><span>{vi.prs.tab}</span>
            </button>
          )}
          {files.map((f) => (
            <span key={f.file} className={`tab file-tab${tab === `file:${f.file}` ? ' active' : ''}`}>
              <button id={tabId(`file:${f.file}`)} type="button" role="tab" aria-selected={tab === `file:${f.file}`} aria-controls={viewId}
                aria-label={baseName(f.file)} tabIndex={tab === `file:${f.file}` ? 0 : -1}
                title={f.file} className="tab-name" onClick={() => setTab(`file:${f.file}`)}>
                <FileTypeIcon name={f.file} /><span>{baseName(f.file)}</span>
                {dirtyFiles.has(f.file) && <span className="dirty-dot" aria-hidden="true"> ●</span>}
              </button>
              <button type="button" className="tab-close" aria-label={`Đóng ${baseName(f.file)}`} onClick={() => closeFile(f.file)}><Icon name="close" size={12} /></button>
            </span>
          ))}
          {inspections.map((inspection) => <span key={inspection.id} className={`tab file-tab${tab === `task:${inspection.id}` ? ' active' : ''}`}>
            <button id={tabId(`task:${inspection.id}`)} type="button" role="tab" aria-selected={tab === `task:${inspection.id}`} aria-controls={viewId} tabIndex={tab === `task:${inspection.id}` ? 0 : -1} className="tab-name" onClick={() => setTab(`task:${inspection.id}`)}><Icon name="spark" size={14} /><span>{inspection.title}</span></button>
            <button type="button" className="tab-close" aria-label={`Đóng ${inspection.title}`} onClick={() => { setInspections((current) => current.filter((item) => item.id !== inspection.id)); if (tab === `task:${inspection.id}`) setTab(lastMain) }}><Icon name="close" size={12} /></button>
          </span>)}
        </div>
        <div className="canvas-wrap" id={viewId} role="tabpanel" aria-labelledby={tabId(tab)} tabIndex={0}>
          {tab === 'arch' && <ArchitectureCanvas key={`${archParent ?? 'root'}:${openSeq}`} projectId={project.project_id} revision={revision} initialParent={archParent} onParentChange={setArchContext} onOpenNode={openNodeId} onOpenCode={openCode} />}
          {tab === 'map' && <MapView projectId={project.project_id} revision={revision} onOpenNode={openNodeId} onOpenCode={openCode} onOpenArch={openArch} />}
          {tab === 'flows' && <FlowsView projectId={project.project_id} revision={revision} initialFlowId={flowId} openRequest={openSeq} onSelectedFlowChange={setFlowContext} onOpenCode={openCode} onOpenNode={openNodeId} />}
          {tab === 'graph' && (
            <>
              <GraphCanvas projectId={project.project_id} revision={revision} startNodeId=".#repository" focusNodeId={focus} highlights={highlights}
                onSelect={(n) => {
                  nodeRequest.current++
                  if (pathFrom) void findPath(pathFrom, n)
                  else {
                    setSelected(n)
                    if (!overlay) setFocus(n.id)
                  }
                }}
                onNodeContextMenu={(node, x, y) => setMenu({ node, x, y })}
                overlay={overlay} onClearOverlay={clearOverlay}
                onBackToRoot={() => { nodeRequest.current++; setFocus(null); setSelected(null) }} />
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
          {tab === 'tree' && (
            <div className="ws-editor-empty">
              <span className="ws-editor-empty-icon">{FileIcon}</span>
              <h2>{hosted ? 'Xem mã nguồn' : 'Chưa mở tệp'}</h2>
              <p className="muted">{hosted
                ? 'Chọn một tệp trong cây để mở bằng trình soạn thảo của nền.'
                : 'Chọn một tệp trong cây bên trái để xem và chỉnh sửa mã.'}</p>
              {panel !== 'explorer' && (
                <button type="button" onClick={() => setPanel('explorer')}>Mở cây tệp</button>
              )}
            </div>
          )}
          {tab === 'prs' && <PrsView projectId={project.project_id} onOpenNode={openNodeId} />}
          {tab === 'report' && (
            <ReportView projectId={project.project_id} revision={revision} onOpenNode={openNodeId} onAsk={(q) => void askOnGraph(q)}
              onExportMarkdown={() => openExport({ kind: 'all' }, 'markdown')} />
          )}
          {files.map((f) => (
            <EditorTab key={f.file} projectId={project.project_id} file={f.file} line={f.line} lineEnd={f.lineEnd} revealRequest={f.seq} active={tab === `file:${f.file}`}
              onClose={() => closeFile(f.file)} onDirtyChange={onDirtyChange} onContextReady={contextReady} />
          ))}
          {inspections.filter((inspection) => tab === `task:${inspection.id}`).map((inspection) => <TaskInspector key={inspection.id} inspection={inspection} />)}
          {feedback && (
            <div className="ws-feedback">
              <span role="alert">{feedback}</span>
              <button type="button" className="ws-icon-button" aria-label="Đóng thông báo" onClick={() => setFeedback(null)}>×</button>
            </div>
          )}
        </div>
      </section>
      {chatDock === 'right' && <>{resizeHandle}{agentPanel}</>}
      {connectOpenCode && <IntegrationsDialog project={project} initialAgent="opencode" onClose={() => setConnectOpenCode(false)} />}
    </div>
  )
}
