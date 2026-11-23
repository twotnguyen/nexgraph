import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Changes, ExportFormat, ExportScope, GraphEdge, GraphNode, NodeImpact, ProjectSummary } from '@shared/graph-types'
import type { HostCommand, TaskDefinition } from '@shared/api'
import type { EditorContextGetter } from '../components/editor/EditorTab'
import { useDocumentSymbols } from '../components/editor/EditorPanels'
import { EditorTools } from '../components/editor/EditorTools'
import { FileView } from '../components/viewers/FileView'
import { MarkdownPreview } from '../components/viewers/MarkdownPreview'
import { MultiBufferView } from '../components/viewers/MultiBufferView'
import { SplitEditor } from '../components/editor/SplitEditor'
import { clearNotifications, notify, toggleNotifications, withdrawNotification } from '../components/common/NotificationCenter'
import { TerminalPanel } from '../components/terminal/TerminalPanel'
import { TaskPicker, readTaskHistory, rememberTask } from '../components/terminal/TaskPicker'
import { WorktreePicker } from '../components/git/WorktreePicker'
import { GitDiffView } from '../components/git/GitDiffView'
import { debugKindOf } from '../components/debug/DebugPanel'
import { clearAllBreakpoints, debugStep, pauseDebugging, restartDebugging, setDebugOpener, setDebugProject, startDebugging, stopDebugging, useDebugState } from '../state/debugState'
import { CollabBar, CollabTab, JoinDialog } from '../components/collab/CollabUi'
import { leaveSession, shareActiveFile, useCollab } from '../state/collab'
import type { AgentContextItem, AgentEditorState } from '@shared/agent-types'
import type { AgentInspection } from '../components/agent/useAgentWorkbench'
import { TaskInspector } from '../components/agent/TaskInspector'
import { ExportDialog } from '../components/export/ExportDialog'
import { ArchitectureCanvas } from '../components/architecture/ArchitectureCanvas'
import { ActivityBar } from '../components/layout/ActivityBar'
import { QuickActionBar } from '../components/layout/WorkbenchBar'
import { WorkspaceShell } from '../components/layout/WorkspaceShell'
import { WorkbenchCenter } from '../components/layout/WorkbenchCenter'
import { ChatDock } from '../components/layout/ChatDock'
import { WORKBENCH_PANELS, getWorkbenchPanel, type WorkbenchPanelContext } from '../state/workbenchPanels'
import { GraphCanvas } from '../components/graph/GraphCanvas'
import type { HighlightKind } from '../components/graph/kindStyle'
import { NodeContextMenu } from '../components/graph/NodeContextMenu'
import { NodeInspector } from '../components/graph/NodeInspector'
import { ReportView } from '../components/report/ReportView'
import { FlowsView } from '../components/flows/FlowsView'
import { AgentPanel } from '../components/agent/AgentPanel'
import { IntegrationsDialog } from '../components/overview/IntegrationsDialog'
import { MapView } from '../components/map/MapView'
import { PrsView } from '../components/prs/PrsView'
import { useChanges } from '../state/useChanges'
import { Icon, VIEW_TONE } from '../components/common/icons'
import { openThemePicker } from '../components/layout/ThemePicker'
import { FileFinder } from '../components/layout/FileFinder'
import { useCommand } from '../state/commands'
import { getFileSaver, saveAllFiles } from '../state/fileSaveRegistry'
import { getExplorerOpen, setChatDock, setChatWidth, useChatDock, useChatWidth } from '../state/layoutPrefs'
import { getActiveEditor, useActiveEditor } from '../state/activeEditor'
import { listBookmarks } from '../state/bookmarks'
import { navigationBack, navigationForward, recordNavigation, type NavigationEntry } from '../state/navigationHistory'
import { startDiagnostics } from '../state/diagnostics'
import { errorText } from '../state/errorText'
import { buildExcerpts, consumePendingMultiBuffer, getPendingMultiBuffer, requestMultiBuffer, subscribeMultiBuffer, type MultiBufferRequest } from '../state/multiBuffer'
import { FileTypeIcon } from '../components/common/FileTypeIcon'
import { vi, tr } from '../strings'
import { msg, msgId, msgText, type Message, type Msg } from '../state/messages'
import './workspace.css'

type Tab = 'arch' | 'map' | 'flows' | 'graph' | 'tree' | 'report' | 'prs' | 'collab' | `file:${string}` | `preview:${string}` | `task:${string}` | `diff:${string}` | `multi:${string}`
type SplitSide = 'right' | 'left' | 'up' | 'down'
/** Thẻ diff có thể xem working tree, stage hoặc một commit lịch sử. */
type DiffTab = { file: string; staged: boolean; rev?: string; from?: string }
const diffKey = (d: DiffTab): Tab => `diff:${d.rev ?? (d.staged ? 's' : 'u')}:${d.from ?? ''}:${d.file}`
const MAIN_TABS = ['arch', 'map', 'flows', 'graph', 'tree', 'report'] as const
/** Nhãn thẻ đọc tại chỗ render: đổi ngôn ngữ phải áp dụng ngay, không giữ bản dịch lúc nạp module. */
const tabLabels = (): Record<(typeof MAIN_TABS)[number], string> => ({
  arch: vi.workspace.archTab, map: vi.workspace.mapTab, flows: vi.workspace.flowsTab,
  graph: vi.workspace.graphTab, tree: vi.workspace.treeTab, report: vi.workspace.reportTab
})
/** `seq`: mỗi lần mở một số mới, để mở lại đúng dòng cũ (đã cuộn đi chỗ khác) vẫn cuộn về. */
interface OpenFile { file: string; line: number; lineEnd?: number; column?: number; seq: number }
const baseName = (p: string): string => p.split(/[/\\]/).pop() ?? p
const isMarkdownFile = (file: string) => /\.(?:md|markdown|mdown|mkd)$/i.test(file)
/** Khoá câu cảnh báo refresh nền; ở cấp module để lúc lỗi và lúc khôi phục dùng đúng một khoá (M3). */
const WATCH_ERROR_KEY = 'Cập nhật đồ thị sau khi tệp thay đổi bị lỗi: {error}. Đồ thị có thể cũ hơn mã nguồn.'
const containsPath = (parent: string, file: string) => file === parent || file.startsWith(`${parent}/`)
const readRecentFiles = (projectId: string): string[] => {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(`nexgraph.recentFiles:${projectId}`) ?? '[]')
    return Array.isArray(data) ? [...new Set(data.filter((item): item is string => typeof item === 'string'))].slice(0, 100) : []
  } catch { return [] }
}
type Overlay = { nodes: GraphNode[]; edges: GraphEdge[] }
type Panel = 'explorer' | 'find' | 'git' | 'debug' | 'search' | 'changes' | 'tour' | 'outline' | 'diagnostics'
const messageOf = (e: unknown): string =>
  e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)

/** Ảnh hưởng của một nút hiển thị bằng chính ChangesPanel (nút nguồn đứng ở mục "đã đổi"). */
const impactAsChanges = (i: NodeImpact): Changes => ({
  base: 'last_index', base_commit: null, note: vi.impact.title(i.node.label), changed_files: [], changed_nodes: [i.node],
  impacted: i.impacted, tests: i.tests, test_gaps: [], truncated: i.truncated
})


const FileIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3h8l4 4v14H6zM13 3v5h5M9.5 12l-1.5 1.5 1.5 1.5M14.5 12l1.5 1.5-1.5 1.5" />
  </svg>
)


interface Props {
  project: ProjectSummary
  initialTab?: Tab
  initialFlowId?: number
  onBack?: () => void
  onOpenSettings?: (page?: string) => void
  /** Mở một thư mục khác làm dự án (App chuyển màn hình); chỉ khi có thì mở được worktree. */
  onOpenProject?: (project: ProjectSummary) => void
  /** Về danh sách dự án (nút "Dự án" ở đường dẫn khối); không có thì nút đó chỉ hiện ở mức gốc và khoá. */
  onOpenProjects?: () => void
  backLabel?: string
  indexNotice?: string
  initialCommand?: HostCommand
  hidden?: boolean
}

export function WorkspaceScreen({ project, initialTab, initialFlowId, onBack, onOpenSettings, onOpenProject, onOpenProjects, backLabel = vi.workspace.back, indexNotice, initialCommand, hidden = false }: Props) {
  const hosted = !!window.nexgraph?.host
  const id = useId()
  const tabList = useRef<HTMLDivElement>(null)
  const focusTabAfterClose = useRef(false)
  const graphRequest = useRef(0)
  const nodeRequest = useRef(0)
  const impactRequest = useRef(0)
  const hostInitialHandled = useRef(false)
  const [revision, setRevision] = useState(0)
  const [feedback, setFeedbackText] = useState<Message | null>(null)
  // Mọi lỗi/feedback của Workspace cũng vào trung tâm thông báo để chuông trên thanh công cụ đếm đúng.
  const setFeedback = useCallback((message: Message | null) => {
    setFeedbackText(message)
    if (message) notify(msgText(message), msgId(message) ?? undefined)
  }, [])
  const chatDock = useChatDock()
  // Kiểu Wu (trái): khung chat dùng chung chỗ với bảng công cụ nên mặc định đóng để cây tệp hiện trước.
  const [chatOpen, setChatOpen] = useState(() => !hosted && chatDock === 'right' && (window.matchMedia?.('(min-width: 980px)').matches ?? true))
  const [connectOpenCode, setConnectOpenCode] = useState(false)
  const editorContexts = useRef(new Map<string, EditorContextGetter>())
  const [inspections, setInspections] = useState<AgentInspection[]>([])
  const chatWidth = useChatWidth()
  const resize = useRef<{ x: number; width: number } | null>(null)
  // Cửa sổ hẹp thì khung chat không được chiếm quá nửa; giới hạn 300–640 do kho tuỳ chọn tự áp.
  const saveChatWidth = (width: number) => setChatWidth(Math.min(width, Math.max(300, window.innerWidth - 560)))
  const toggleDock = () => setChatDock(chatDock === 'left' ? 'right' : 'left')
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
  const [finder, setFinder] = useState(false)
  const [side, setSide] = useState<string | null>(null) // tệp ở khung phải khi chia đôi
  const [previewSide, setPreviewSide] = useState<string | null>(null)
  const [splitSide, setSplitSide] = useState<SplitSide>('right')
  const [findFocus, setFindFocus] = useState(0)
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
  const [panel, setPanel] = useState<Panel | null>((!hosted && getExplorerOpen()) || initialTab === 'tree' ? 'explorer' : null)
  const activeEditor = useActiveEditor()
  const documentSymbols = useDocumentSymbols(project.project_id, hidden ? null : activeEditor)
  useLayoutEffect(() => startDiagnostics(), [])
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
    // M3 (review #51): giữ dữ liệu lỗi (chi tiết), không giữ câu đã dịch — đổi ngôn ngữ giữa lỗi và
    // lúc khôi phục vẫn so/thu hồi đúng.
    let lastWatchError: { error: string } | null = null
    const watchMessage = (error: string): Msg => msg(WATCH_ERROR_KEY, { error })
    // UI-REFRESH-ERR: refresh nền lỗi phải hiện thông báo riêng (main đã lọc lỗi lặp), không chỉ cảnh báo graph cũ.
    const offWatchError = window.nexgraph.watch.onError((failure) => {
      if (!current || failure.projectId !== project.project_id) return
      // Câu lỗi của engine thường đã có dấu chấm cuối: bỏ để không thành ".." trong câu ghép.
      const detail = failure.message.trim().replace(/\.+$/, '')
      if (lastWatchError?.error === detail) return
      lastWatchError = { error: detail }
      setFeedback(watchMessage(detail))
    })
    // UI-REFRESH-ERR M2: refresh nền chạy được trở lại thì gỡ cảnh báo cũ (toast + mục trung tâm thông báo).
    const offWatchRecovered = window.nexgraph.watch.onRecovered((projectId) => {
      if (!current || projectId !== project.project_id || !lastWatchError) return
      const message = watchMessage(lastWatchError.error)
      const id = msgId(message)
      lastWatchError = null
      withdrawNotification(msgText(message), id ?? undefined)
      setFeedbackText((previous) => (msgId(previous) === id ? null : previous))
    })
    void window.nexgraph.watch.start(project.project_id).catch((error: unknown) => {
      if (current) setFeedback(msg('Không theo dõi được thay đổi của tệp. {error}', { error: messageOf(error) }))
    })
    return () => {
      current = false
      offWatchError()
      offWatchRecovered()
      void window.nexgraph.watch.stop(project.project_id).catch(() => {})
      // Trong extension, trợ lý sống ở view riêng của nền nên rời màn này không đóng phiên của nó.
      if (!window.nexgraph.host) void window.nexgraph.agent.close(project.project_id).catch(() => {})
    }
  }, [project.project_id, project.path, setFeedback])

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
  const previewFile = tab.startsWith('preview:') ? tab.slice('preview:'.length) : undefined
  const [lastMain, setLastMain] = useState<Tab>(initialTab ?? 'arch')
  useEffect(() => {
    if (!tab.startsWith('file:') && !tab.startsWith('preview:') && !tab.startsWith('task:') && !tab.startsWith('multi:')) setLastMain(tab)
  }, [tab])
  const [multiBuffers, setMultiBuffers] = useState<MultiBufferRequest[]>([])
  useEffect(() => subscribeMultiBuffer(() => {
    const request = getPendingMultiBuffer()
    if (!request) return
    setMultiBuffers((cur) => cur.some((item) => item.id === request.id)
      ? cur.map((item) => item.id === request.id ? request : item) : [...cur, request])
    setTab(`multi:${request.id}`)
    consumePendingMultiBuffer()
  }), [])
  const [focus, setFocus] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [files, setFiles] = useState<OpenFile[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [readOnlyFiles, setReadOnlyFiles] = useState<Record<string, boolean>>({})
  const [lockedFiles, setLockedFiles] = useState<Set<string>>(new Set())
  const [viewerErrors, setViewerErrors] = useState<Record<string, string | null>>({})
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const [tabMenu, setTabMenu] = useState<{ file: string; x: number; y: number } | null>(null)
  const closedFiles = useRef<OpenFile[]>([])
  const fileMru = useRef<string[]>([])
  const tabCycle = useRef<{ order: string[]; index: number } | null>(null)
  const [recentStore, setRecentStore] = useState(() => ({ projectId: project.project_id, paths: readRecentFiles(project.project_id) }))
  const recentFiles = recentStore.projectId === project.project_id ? recentStore.paths : []
  const orderedFiles = useMemo(() => [...files.filter((f) => pinned.has(f.file)), ...files.filter((f) => !pinned.has(f.file))], [files, pinned])
  const draggedTab = useRef<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const moveTab = (from: string, to: string) => {
    if (!from || from === to) return
    const order = orderedFiles.map((item) => item.file)
    const fromIndex = order.indexOf(from)
    const toIndex = order.indexOf(to)
    if (fromIndex < 0 || toIndex < 0) return
    order.splice(toIndex, 0, ...order.splice(fromIndex, 1))
    setFiles((cur) => [...cur].sort((a, b) => order.indexOf(a.file) - order.indexOf(b.file)))
    tabCycle.current = null
  }
  const toggleLocked = (file: string) => setLockedFiles((cur) => {
    const next = new Set(cur)
    if (next.has(file)) next.delete(file)
    else next.add(file)
    return next
  })
  useEffect(() => {
    setRecentStore({ projectId: project.project_id, paths: readRecentFiles(project.project_id) })
    fileMru.current = []
    closedFiles.current = []
    tabCycle.current = null
  }, [project.project_id])
  useEffect(() => {
    const file = activeFile ?? previewFile
    if (!file) return
    if (!tabCycle.current) fileMru.current = [file, ...fileMru.current.filter((item) => item !== file)]
    setRecentStore((current) => {
      const paths = current.projectId === project.project_id ? current.paths : readRecentFiles(project.project_id)
      return paths[0] === file && current.projectId === project.project_id ? current
        : { projectId: project.project_id, paths: [file, ...paths.filter((item) => item !== file)].slice(0, 100) }
    })
  }, [activeFile, previewFile, project.project_id])
  useEffect(() => {
    if (recentStore.projectId !== project.project_id) return
    try { localStorage.setItem(`nexgraph.recentFiles:${project.project_id}`, JSON.stringify(recentStore.paths)) } catch { /* sở thích tạm thời */ }
  }, [project.project_id, recentStore])
  useEffect(() => {
    const finishCycle = () => {
      const cycle = tabCycle.current
      if (!cycle) return
      const file = cycle.order[cycle.index]
      if (file) fileMru.current = [file, ...fileMru.current.filter((item) => item !== file)]
      tabCycle.current = null
    }
    if (hidden) { finishCycle(); return }
    const keyup = (event: KeyboardEvent) => { if (!event.ctrlKey && !event.metaKey) finishCycle() }
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', finishCycle)
    return () => { window.removeEventListener('keyup', keyup); window.removeEventListener('blur', finishCycle) }
  }, [hidden])
  useEffect(() => {
    if (!tabMenu || hidden) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setTabMenu(null) }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [tabMenu, hidden])
  const chatFile = files.find(({ file }) => file === activeFile)
  const [exportScope, setExportScope] = useState<ExportScope | null>(null)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('html')
  const [menu, setMenu] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const [pathFrom, setPathFrom] = useState<GraphNode | null>(null)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [notice, setNoticeText] = useState<Message | null>(null)
  // Thông báo trên đồ thị cũng vào trung tâm để chuông đếm cả thao tác tìm đường/hỏi/trích dẫn.
  const setNotice = useCallback((message: Message | null) => {
    setNoticeText(message)
    if (message) notify(msgText(message), msgId(message) ?? undefined)
  }, [])
  const inspect = (inspection: AgentInspection) => {
    setInspections((current) => current.some((item) => item.id === inspection.id) ? current.map((item) => item.id === inspection.id ? inspection : item) : [...current, inspection])
    setTab(`task:${inspection.id}`)
  }
  const graphContext: AgentContextItem | undefined = tab === 'graph' && selected ? { kind: 'node', nodeId: selected.id, label: selected.label }
    : tab === 'flows' && flowContext !== undefined ? { kind: 'flow', flowId: flowContext, label: tr('Luồng {id}', { id: flowContext }) }
    : tab === 'arch' ? { kind: 'architecture', blockId: archContext ?? 'root', label: archContext ?? tr('Kiến trúc dự án') } : undefined

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
    if (!pathFrom || hidden) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPathFrom(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pathFrom, hidden])

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
    setNotice(msg('Đang tìm đường nối…'))
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
    setNotice(msg('Đang tìm…'))
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

  const openCode = (file: string, line = 1, lineEnd?: number, column?: number, record = true) => {
    // Các lệnh đi tới/quay lại chỉ di chuyển con trỏ trong lịch sử, không thêm mục mới.
    if (record) recordNavigation(project.project_id, { file, line, column: column ?? 1 })
    // Trong extension, tệp mở bằng editor của nền thay cho thẻ Monaco.
    if (window.nexgraph.host) return void window.nexgraph.host.openFile(file, line, lineEnd).catch((e: unknown) => setFeedback(messageOf(e)))
    const seq = openSeq + 1
    setOpenSeq(seq)
    setFiles((cur) => (cur.some((f) => f.file === file) ? cur.map((f) => (f.file === file ? { file, line, lineEnd, column, seq } : f)) : [...cur, { file, line, lineEnd, column, seq }]))
    setTab(`file:${file}`)
  }
  const previewCode = (file: string, line = 1) => {
    openCode(file, line)
    setPreviews((cur) => cur.includes(file) ? cur : [...cur, file])
    setTab(`preview:${file}`)
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
  const openWorkspaceSettings = onOpenSettings && ((page?: string) => {
    if (hosted) guardLeave(() => onOpenSettings(page))?.()
    else onOpenSettings(page)
  })
  // Worktree mở như một dự án: project.open đăng ký thư mục, App chuyển màn hình; còn tệp chưa lưu thì hỏi trước.
  const [worktrees, setWorktrees] = useState(false)
  const openWorktree = onOpenProject && !hosted && ((path: string) => guardLeave(() => {
    void window.nexgraph.project.open(path).then(onOpenProject, (e: unknown) => setFeedback(errorText(e)))
  })?.())
  const closeFiles = (paths: string[], force = false) => {
    const selected = orderedFiles.filter((item) => paths.includes(item.file))
    if (!selected.length) return
    for (const item of selected) {
      if (!force && dirtyFiles.has(item.file) && !window.confirm(vi.editor.confirmClose(baseName(item.file)))) return
    }
    const closing = new Set(selected.map((item) => item.file))
    closedFiles.current = [...closedFiles.current, ...selected].slice(-100)
    fileMru.current = fileMru.current.filter((file) => !closing.has(file))
    tabCycle.current = null
    const current = activeFile ?? previewFile
    const index = orderedFiles.findIndex((item) => item.file === current)
    const nextFile = orderedFiles.slice(0, Math.max(index, 0)).reverse().find((item) => !closing.has(item.file))
      ?? orderedFiles.find((item) => !closing.has(item.file))
    if (current && closing.has(current)) {
      focusTabAfterClose.current = true
      const next = nextFile ? `file:${nextFile.file}` as Tab : lastMain
      if (next === 'tree') setPanel('explorer')
      setTab(next)
    }
    setFiles((cur) => cur.filter((item) => !closing.has(item.file)))
    setPreviews((cur) => cur.filter((item) => !closing.has(item)))
    setReadOnlyFiles((cur) => Object.fromEntries(Object.entries(cur).filter(([file]) => !closing.has(file))))
    setViewerErrors((cur) => Object.fromEntries(Object.entries(cur).filter(([file]) => !closing.has(file))))
    setPinned((cur) => new Set([...cur].filter((item) => !closing.has(item))))
    setLockedFiles((cur) => new Set([...cur].filter((item) => !closing.has(item))))
    setSide((cur) => cur && closing.has(cur) ? null : cur)
    setPreviewSide((cur) => cur && closing.has(cur) ? null : cur)
  }
  const closeFile = (file: string) => closeFiles([file])
  const togglePinned = (file: string) => setPinned((current) => {
    const next = new Set(current)
    if (next.has(file)) next.delete(file)
    else next.add(file)
    return next
  })
  const renamedPath = (from: string, to: string) => {
    const remap = (path: string) => containsPath(from, path) ? to + path.slice(from.length) : path
    setFiles((cur) => cur.map((item) => ({ ...item, file: remap(item.file) })))
    setPreviews((cur) => cur.map(remap))
    setReadOnlyFiles((cur) => Object.fromEntries(Object.entries(cur).map(([file, value]) => [remap(file), value])))
    setViewerErrors((cur) => Object.fromEntries(Object.entries(cur).map(([file, value]) => [remap(file), value])))
    setPinned((cur) => new Set([...cur].map(remap)))
    setLockedFiles((cur) => new Set([...cur].map(remap)))
    setSide((cur) => cur ? remap(cur) : cur)
    setPreviewSide((cur) => cur ? remap(cur) : cur)
    setTab((cur) => {
      if (cur.startsWith('file:')) return `file:${remap(cur.slice(5))}`
      if (cur.startsWith('preview:')) return `preview:${remap(cur.slice(8))}`
      return cur
    })
    fileMru.current = fileMru.current.map(remap)
    closedFiles.current = closedFiles.current.map((item) => ({ ...item, file: remap(item.file) }))
    setRecentStore((cur) => ({ ...cur, paths: [...new Set(cur.paths.map(remap))] }))
    tabCycle.current = null
  }
  const trashedPath = (path: string) => {
    const closing = new Set(files.filter((item) => containsPath(path, item.file)).map((item) => item.file))
    setFiles((cur) => cur.filter((item) => !closing.has(item.file)))
    setPreviews((cur) => cur.filter((item) => !containsPath(path, item)))
    setReadOnlyFiles((cur) => Object.fromEntries(Object.entries(cur).filter(([file]) => !containsPath(path, file))))
    setViewerErrors((cur) => Object.fromEntries(Object.entries(cur).filter(([file]) => !containsPath(path, file))))
    setPinned((cur) => new Set([...cur].filter((item) => !containsPath(path, item))))
    setLockedFiles((cur) => new Set([...cur].filter((item) => !containsPath(path, item))))
    setSide((cur) => cur && containsPath(path, cur) ? null : cur)
    setPreviewSide((cur) => cur && containsPath(path, cur) ? null : cur)
    if ((activeFile && containsPath(path, activeFile)) || (previewFile && containsPath(path, previewFile))) setTab(lastMain)
    fileMru.current = fileMru.current.filter((file) => !containsPath(path, file))
    closedFiles.current = closedFiles.current.filter((item) => !containsPath(path, item.file))
    setRecentStore((cur) => ({ ...cur, paths: cur.paths.filter((file) => !containsPath(path, file)) }))
    tabCycle.current = null
  }
  const closePreview = (file: string) => {
    setPreviews((cur) => cur.filter((item) => item !== file))
    if (tab === `preview:${file}`) setTab(`file:${file}`)
  }
  const selectView = (view: (typeof MAIN_TABS)[number]) => {
    if (view === 'tree') {
      setPanel('explorer')
      if (activeFile ?? previewFile) {
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
        const target = getWorkbenchPanel(tool)
        if (target && target.group !== 'dock') setPanel((cur) => cur === tool ? null : tool as Panel)
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
    if (key === 'agent') return setChatOpen((v) => !v)
    const entry = getWorkbenchPanel(key)
    if (!entry || entry.group === 'dock') return
    if (leftChat) {
      setChatOpen(false)
      setPanel(key as Panel)
    } else setPanel((cur) => cur === key ? null : key as Panel)
  }
  // Kéo thanh chia: khung trái rộng ra khi kéo sang phải, khung phải rộng ra khi kéo sang trái.
  const grow = chatDock === 'left' ? 1 : -1
  const resizeHandle = !hosted && chatOpen && <div className="agent-resize-handle" role="separator" aria-label={tr('Độ rộng trợ lý AI')} aria-orientation="vertical" tabIndex={0} aria-valuemin={300} aria-valuemax={640} aria-valuenow={chatWidth}
    onPointerDown={(event) => { resize.current = { x: event.clientX, width: chatWidth }; event.currentTarget.setPointerCapture(event.pointerId) }}
    onPointerMove={(event) => { if (resize.current) saveChatWidth(resize.current.width + grow * (event.clientX - resize.current.x)) }}
    onPointerUp={() => { resize.current = null }} onPointerCancel={() => { resize.current = null }}
    onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); saveChatWidth(chatWidth + grow * (event.key === 'ArrowRight' ? 20 : -20)) } }} />
  const agentPanel = !hosted && <AgentPanel id={chatId} hidden={!chatOpen} projectId={project.project_id} projectName={project.name}
    activeFile={chatFile} onClose={() => setChatOpen(false)} onConnectOpenCode={() => setConnectOpenCode(true)}
    getEditorContext={() => activeFile ? editorContexts.current.get(activeFile)?.() ?? null : null} graphContext={graphContext} beforePrompt={flushEditorState} onInspect={inspect}
    onOpenCode={openCode} onHighlight={highlightFromChat} onOpenSettings={openWorkspaceSettings ?? (() => {})} dock={chatDock} onToggleDock={toggleDock} />

  // Lệnh cho bảng lệnh và phím tắt (state/commands.ts); rời màn hình thì hỏi trước nếu còn tệp chưa lưu.
  useCommand('agent.toggle', () => setChatOpen((v) => !v), !hosted)
  useCommand('file_finder.toggle', () => setFinder((v) => !v))
  useCommand('file.new', () => setFinder(true))
  useCommand('file.open_recent', () => setFinder(true))
  useCommand('file.save_all', () => {
    void saveAllFiles(project.project_id, [...dirtyFiles]).then((failed) => {
      for (const file of failed) notify(tr('Không lưu được tệp {file}', { file }))
    })
  }, dirtyFiles.size > 0)
  useCommand('file.save_as', () => { const current = activeFile ?? previewFile; if (current) void getFileSaver(project.project_id, current)?.saveAs() }, !!(activeFile ?? previewFile))
  const openHistoryLocation = (entry: NavigationEntry | null) => { if (entry) openCode(entry.file, entry.line, undefined, entry.column, false) }
  useCommand('navigation.back', () => openHistoryLocation(navigationBack(project.project_id)))
  useCommand('navigation.forward', () => openHistoryLocation(navigationForward(project.project_id)))
  useCommand('explorer.toggle', () => togglePanel('explorer'))
  useCommand('graph_search.toggle', () => togglePanel('search'))
  useCommand('changes.toggle', () => togglePanel('changes'))
  useCommand('git_panel.toggle', () => togglePanel('git'))
  useCommand('git.worktree', () => setWorktrees(true), !!openWorktree && !!window.nexgraph.git)
  // Gỡ lỗi: tệp đích là tệp .js/.py mở gần nhất; phiên sống ngoài bảng (state/debugState) nên phím F5… dùng được khi bảng đóng.
  const debugState = useDebugState()
  const [debugTarget, setDebugTarget] = useState<string | undefined>(undefined)
  useEffect(() => { setDebugProject(project.project_id) }, [project.project_id])
  useEffect(() => { if (debugKindOf(activeFile) && debugState.status === 'idle') setDebugTarget(activeFile) }, [activeFile, debugState.status])
  useEffect(() => { setDebugOpener((file, line) => openCode(file, line)); return () => setDebugOpener(null) })
  useCommand('debug.toggle', () => togglePanel('debug'))
  useCommand('debug.start', () => {
    if (debugState.status === 'stopped') return debugStep('continue')
    const kind = debugKindOf(debugTarget)
    if (panel !== 'debug') togglePanel('debug')
    if (debugState.status === 'idle') void startDebugging(project.project_id, kind, debugTarget ?? null)
  })
  useCommand('debug.step_over', () => debugStep('next'))
  useCommand('debug.step_into', () => debugStep('stepIn'))
  useCommand('debug.step_out', () => debugStep('stepOut'))
  useCommand('debug.stop', stopDebugging)
  useCommand('debug.pause', pauseDebugging, debugState.status === 'running')
  useCommand('debug.restart', restartDebugging, debugState.status !== 'idle' && debugState.status !== 'starting')
  useCommand('debug.clear_breakpoints', clearAllBreakpoints)
  // Cộng tác LAN: chia sẻ tệp đang mở hoặc tham gia phiên của máy khác (thẻ "collab").
  const collab = useCollab()
  const [joining, setJoining] = useState(false)
  useCommand('collab.share', () => void shareActiveFile(), !hosted)
  useCommand('collab.join', () => setJoining(true), !hosted)
  useCommand('collab.leave', leaveSession, !!collab.role)
  useEffect(() => { if (collab.role !== 'guest' && tab === 'collab') setTab(lastMain) }, [collab.role]) // eslint-disable-line react-hooks/exhaustive-deps
  const [diffs, setDiffs] = useState<DiffTab[]>([])
  const openDiff = (file: string, staged: boolean, rev?: string, from?: string) => {
    const item = { file, staged, rev, from }
    setDiffs((cur) => cur.some((d) => diffKey(d) === diffKey(item)) ? cur : [...cur, item])
    setTab(diffKey(item))
  }
  const closeDiff = (d: DiffTab) => {
    setDiffs((cur) => cur.filter((item) => diffKey(item) !== diffKey(d)))
    if (tab === diffKey(d)) setTab(lastMain)
  }
  const closeMulti = (request: MultiBufferRequest) => {
    setMultiBuffers((cur) => cur.filter((item) => item.id !== request.id))
    if (tab === `multi:${request.id}`) setTab(lastMain)
  }
  // Dấu trang và tệp đang mở thành một thẻ nhiều đoạn; mỗi đoạn dựng một editor.
  // shortcut: dấu trang không bị giới hạn số đoạn, thêm trần như tệp đang mở nếu danh sách dài.
  useCommand('editor.view_bookmarks', () => {
    const marks = listBookmarks(project.project_id)
    if (!marks.length) return setFeedback(msg('Không có dấu trang nào trong dự án này.'))
    requestMultiBuffer({ id: `bookmarks-${Date.now()}`, title: msg('Dấu trang'), excerpts: buildExcerpts(marks) })
  })
  // Tệp đang hiện đứng đầu (dòng con trỏ nếu biết) để không bị cắt khi mở quá 8 tệp.
  useCommand('editor.open_multibuffer', () => {
    const editor = getActiveEditor()
    const cursor = editor && editor.file === activeFile ? editor.handle.getPosition?.()?.line : undefined
    const shown = [...files].sort((a, b) => Number(b.file === activeFile) - Number(a.file === activeFile)).slice(0, 8)
    if (!shown.length) return setFeedback(msg('Chưa mở tệp'))
    requestMultiBuffer({ id: `open-files-${Date.now()}`, title: msg('Nhiều đoạn mã'),
      excerpts: buildExcerpts(shown.map((item) => ({ file: item.file, line: item.file === activeFile ? cursor ?? item.line : item.line }))) })
  })
  useCommand('tour.toggle', () => togglePanel('tour'))
  useCommand('view.arch', () => selectView('arch'))
  useCommand('view.map', () => selectView('map'))
  useCommand('view.flows', () => selectView('flows'))
  useCommand('view.graph', () => selectView('graph'))
  useCommand('view.tree', () => selectView('tree'))
  useCommand('view.report', () => selectView('report'))
  useCommand('graph.export', () => exportCurrent())
  useCommand('project.overview', () => guardLeave(onBack)?.(), !!onBack)
  useCommand('settings.open', () => openWorkspaceSettings?.(), !!openWorkspaceSettings)
  useCommand('keymap.open', () => openWorkspaceSettings?.('keymap'), !!openWorkspaceSettings)
  useCommand('tab.close', () => {
    const currentMulti = multiBuffers.find((item) => `multi:${item.id}` === tab)
    if (currentMulti) return closeMulti(currentMulti)
    if (activeFile && pinned.has(activeFile)) {
      const next = orderedFiles.find((item) => !pinned.has(item.file))
      if (next) setTab(`file:${next.file}`)
    } else if (activeFile) closeFile(activeFile)
    else if (tab.startsWith('task:')) {
      setInspections((current) => current.filter((item) => `task:${item.id}` !== tab))
      setTab(lastMain)
    }
  })
  const cycleFiles = (step: number) => {
    const available = orderedFiles.map((item) => item.file)
    if (!available.length) return
    let cycle = tabCycle.current
    if (!cycle) {
      const current = activeFile ?? previewFile
      const recent = fileMru.current.filter((file) => available.includes(file) && file !== current)
      const order = [...(current ? [current] : []), ...recent, ...available.filter((file) => file !== current && !recent.includes(file))]
      cycle = { order, index: current ? 0 : step > 0 ? -1 : 0 }
      tabCycle.current = cycle
    }
    cycle.index = (cycle.index + step + cycle.order.length) % cycle.order.length
    setTab(`file:${cycle.order[cycle.index]}`)
  }
  useCommand('tab.next_mru', () => cycleFiles(1), !hosted)
  useCommand('tab.previous_mru', () => cycleFiles(-1), !hosted)
  useCommand('tab.reopen', () => {
    let item = closedFiles.current.pop()
    while (item && files.some((file) => file.file === item?.file)) item = closedFiles.current.pop()
    if (item) openCode(item.file, item.line, item.lineEnd, item.column)
  }, !hosted)
  useCommand('tab.pin', () => { if (activeFile) togglePinned(activeFile) }, !hosted && !!activeFile)
  useCommand('editor.toggle_read_only', () => { if (activeFile) toggleLocked(activeFile) }, !!activeFile)
  const activateFile = (index: number) => {
    tabCycle.current = null
    const item = index === 0 ? orderedFiles.at(-1) : orderedFiles[index - 1]
    if (item) setTab(`file:${item.file}`)
  }
  useCommand('tab.activate_0', () => activateFile(0), !hosted)
  useCommand('tab.activate_1', () => activateFile(1), !hosted)
  useCommand('tab.activate_2', () => activateFile(2), !hosted)
  useCommand('tab.activate_3', () => activateFile(3), !hosted)
  useCommand('tab.activate_4', () => activateFile(4), !hosted)
  useCommand('tab.activate_5', () => activateFile(5), !hosted)
  useCommand('tab.activate_6', () => activateFile(6), !hosted)
  useCommand('tab.activate_7', () => activateFile(7), !hosted)
  useCommand('tab.activate_8', () => activateFile(8), !hosted)
  useCommand('tab.activate_9', () => activateFile(9), !hosted)
  const previousPanel = useRef<Panel>('explorer')
  useEffect(() => { if (panel) previousPanel.current = panel }, [panel])
  useCommand('dock.left', () => {
    if (leftChat) setChatOpen(false)
    else setPanel((current) => current ? null : previousPanel.current)
  }, !hosted)
  useEffect(() => {
    if (!hidden) return
    tabCycle.current = null
    setTabMenu(null)
  }, [hidden])
  const splitTo = (direction: SplitSide) => {
    if (previewSide) setPreviewSide(null)
    if (side) {
      if (splitSide === direction) { setSide(null); setSplitSide('right') }
      else setSplitSide(direction)
      return
    }
    // Thẻ xem trước (`preview:`) không có `activeFile`; chia đôi phải dùng tệp đang xem.
    const current = activeFile ?? previewFile
    if (current) {
      setSplitSide(direction)
      setSide(current)
      // MIN-43 M1: chia đôi một thẻ xem trước thì nó thành tab thường (như VS Code), không bị thay khi bấm tệp khác.
      if (!activeFile && previewFile) {
        setPreviews((cur) => cur.filter((file) => file !== previewFile))
        setTab(`file:${previewFile}`)
      }
    }
  }
  useCommand('editor.split_right', () => splitTo('right'))
  useCommand('editor.split_up', () => splitTo('up'))
  useCommand('editor.split_down', () => splitTo('down'))
  useCommand('editor.split_left', () => splitTo('left'))
  useCommand('markdown.preview', () => {
    if (previewFile) return closePreview(previewFile)
    if (!activeFile) return
    setPreviews((cur) => cur.includes(activeFile) ? cur : [...cur, activeFile])
    setTab(`preview:${activeFile}`)
  }, !hidden && (!!previewFile || !!activeFile && isMarkdownFile(activeFile)))
  useCommand('markdown.preview_side', () => {
    if (!activeFile) return
    setSide(null)
    setPreviewSide(activeFile)
  }, !hidden && !!activeFile && isMarkdownFile(activeFile))
  // Terminal: 'closed' chưa mở (không có phiên), 'hidden' ẩn nhưng phiên vẫn chạy như Wu.
  const [terminal, setTerminal] = useState<'closed' | 'open' | 'hidden'>('closed')
  const [terminalNew, setTerminalNew] = useState(0)
  const [taskPicker, setTaskPicker] = useState(false)
  const [taskHistory, setTaskHistory] = useState(() => readTaskHistory(project.project_id))
  const [taskRequest, setTaskRequest] = useState<{ seq: number; task?: TaskDefinition; command?: string } | null>(null)
  const taskSequence = useRef(0)
  const lastTask = useRef<{ task?: TaskDefinition; command?: string } | null>(null)
  const taskProject = useRef(project.project_id)
  taskProject.current = project.project_id
  useEffect(() => {
    lastTask.current = null
    setTaskRequest(null)
    setTaskHistory(readTaskHistory(project.project_id))
  }, [project.project_id])
  const queueTask = (request: { task?: TaskDefinition; command?: string }) => {
    lastTask.current = request
    setTaskRequest({ seq: ++taskSequence.current, ...request })
    setTerminal('open')
  }
  const runTask = async (task: TaskDefinition, oneshot: boolean) => {
    const api = window.nexgraph.tasks
    if (!api) return
    const pid = project.project_id
    const editor = getActiveEditor()
    const file = activeFile
    const line = editor && editor.file === file ? editor.handle.getPosition?.()?.line : undefined
    try {
      // REV-13: lệnh gõ tay không phải task của dự án nên không xin chữ ký; gõ vào shell như người dùng.
      if (oneshot) {
        setTaskHistory(rememberTask(pid, task, true))
        queueTask({ command: task.command })
        return
      }
      const resolved = await api.resolve(pid, task, { file, line })
      if (taskProject.current !== pid) return
      setTaskHistory(rememberTask(pid, task, oneshot))
      queueTask({ task: resolved })
    } catch (e) {
      if (taskProject.current === pid) setFeedback(errorText(e))
    }
  }
  const rerunTask = async () => {
    if (lastTask.current) return queueTask(lastTask.current)
    const recent = taskHistory[0]
    if (!recent) return setTaskPicker(true)
    try {
      if (recent.oneshot) return queueTask({ command: recent.command })
      const task = (await window.nexgraph.tasks?.list(project.project_id))?.find((item) => item.label === recent.label && item.command === recent.command)
      if (task) await runTask(task, false)
      else setTaskPicker(true)
    } catch (e) { setFeedback(errorText(e)) }
  }
  useCommand('task.spawn', () => setTaskPicker(true), !hosted && !!window.nexgraph.tasks)
  useCommand('task.rerun', () => void rerunTask(), !hosted && !!window.nexgraph.tasks)
  useCommand('terminal.toggle', () => setTerminal((cur) => (cur === 'open' ? 'hidden' : 'open')), !hosted)
  useCommand('dock.bottom', () => setTerminal((cur) => cur === 'open' ? 'hidden' : 'open'), !hosted && !hidden)
  useCommand('terminal.new', () => { if (terminal === 'open') setTerminalNew((n) => n + 1); else setTerminal('open') }, !hosted)
  useCommand('project_search.toggle', () => {
    if (leftChat) setChatOpen(false)
    setPanel('find')
    setFindFocus((n) => n + 1)
  })
  const previewSideShown = !!activeFile && previewSide === activeFile
  // Thẻ xem trước (`preview:`) không có `activeFile` nhưng vẫn là một tệp đang xem — chia đôi phải hiện.
  const sideShown = previewSideShown || (side !== null && (activeFile ?? previewFile) !== undefined && files.some((f) => f.file === side))
  useCommand('notifications.toggle', toggleNotifications)
  useCommand('notification.clear', clearNotifications)
  useCommand('dock.right', () => {
    if (chatDock !== 'right') { setChatDock('right'); setChatOpen(true) }
    else setChatOpen((value) => !value)
  }, !hosted)
  const docked = useRef<{
    saved: { panel: Panel | null; chatOpen: boolean; terminal: 'closed' | 'open' | 'hidden' }
    hidden: { panel: Panel | null; chatOpen: boolean; terminal: 'closed' | 'open' | 'hidden' }
  } | null>(null)
  useEffect(() => {
    const snapshot = docked.current
    if (snapshot && (panel !== snapshot.hidden.panel || chatOpen !== snapshot.hidden.chatOpen || terminal !== snapshot.hidden.terminal)) docked.current = null
  }, [panel, chatOpen, terminal])
  useCommand('dock.all', () => {
    const snapshot = docked.current
    if (snapshot) {
      docked.current = null
      setPanel(snapshot.saved.panel)
      setChatOpen(snapshot.saved.chatOpen)
      setTerminal(snapshot.saved.terminal)
    } else {
      const hidden = { panel: null, chatOpen: false, terminal: terminal === 'closed' ? 'closed' as const : 'hidden' as const }
      docked.current = { saved: { panel, chatOpen, terminal }, hidden }
      setPanel(hidden.panel)
      setChatOpen(hidden.chatOpen)
      setTerminal(hidden.terminal)
    }
  }, !hosted)
  const [zoomPane, setZoomPane] = useState(false)
  useCommand('view.zoom_pane', () => setZoomPane((value) => !value))
  const [centered, setCentered] = useState(false)
  useCommand('view.centered_layout', () => setCentered((value) => !value))
  const focusPart = (step: number) => {
    const parts = Array.from(document.querySelectorAll<HTMLElement>(
      '.workspace-shell > [data-ws-part]:not([data-ws-part="center"]), .workspace-shell .ws-head, .workspace-shell .canvas-wrap'
    )).filter((part) => !part.hidden && !part.querySelector(':scope > [hidden]'))
    if (!parts.length) return
    const current = parts.findIndex((part) => part.contains(document.activeElement))
    const index = current < 0 ? (step > 0 ? -1 : 0) : current
    const part = parts[(index + step + parts.length) % parts.length]
    const target = part.querySelector<HTMLElement>('button, [tabindex="0"], input, textarea') ?? (part.tabIndex >= 0 ? part : null)
    target?.focus()
  }
  useCommand('focus.next_part', () => focusPart(1))
  useCommand('focus.previous_part', () => focusPart(-1))
  const lastPicker = useRef<'theme' | 'file' | 'task' | 'worktree'>('file')
  useEffect(() => {
    if (finder) lastPicker.current = 'file'
    else if (taskPicker) lastPicker.current = 'task'
    else if (worktrees) lastPicker.current = 'worktree'
  }, [finder, taskPicker, worktrees])
  const openTheme = () => { lastPicker.current = 'theme'; openThemePicker() }
  useCommand('picker.reopen', () => {
    if (lastPicker.current === 'theme') openTheme()
    else if (lastPicker.current === 'task') setTaskPicker(true)
    else if (lastPicker.current === 'worktree' && openWorktree) setWorktrees(true)
    else { lastPicker.current = 'file'; setFinder(true) }
  })
  const panelCtx: WorkbenchPanelContext = {
    projectId: project.project_id, projectName: project.name, projectPath: project.path,
    revision, activeFile, previewFile, dirtyFiles, findFocus,
    editor: activeEditor, symbols: documentSymbols.symbols, symbolError: documentSymbols.error,
    debugTarget, worktreeAvailable: !!openWorktree && !!window.nexgraph.git, chatDock, hosted,
    openFlow, openArch, openNode, openNodeId, openCode, previewCode,
    pinFile: (file, line) => { setPreviews((cur) => cur.filter((item) => item !== file)); openCode(file, line ?? 1) },
    closeFile, renamePath: renamedPath, trashPath: trashedPath,
    showSubgraph: (g) => highlightFromChat(g.nodes, g.edges, null),
    openDiff, openWorktrees: openWorktree ? () => setWorktrees(true) : undefined,
    nodeImpact, impactPending,
    changes, changesLoading: live.loading, changesError: live.error,
    reloadChanges: live.reload,
    reloadImpact: () => { if (nodeImpact) void showImpact(nodeImpact.node) },
    clearImpact: () => setNodeImpact(null)
  }

  return (
    <WorkspaceShell hidden={hidden} hosted={hosted} chatWidth={chatWidth} dockSide={chatDock}
      rail={!hosted && (
        <ActivityBar
          items={WORKBENCH_PANELS.filter((entry) => !entry.visible || entry.visible(panelCtx))
            .sort((a, b) => Number(b.group === 'dock') - Number(a.group === 'dock'))
            .map((entry) => ({ id: entry.id, title: entry.title(), icon: entry.icon,
              ...(entry.id === 'changes' ? { badge: live.changes?.changed_files.length } : {}) }))}
          active={leftChat ? 'agent' : panel}
          panelId={leftChat ? chatId : toolsId}
          onToggle={togglePanel}
          manage={[
            ...(openWorkspaceSettings ? [{ label: tr('Cài đặt'), icon: 'sliders' as const, onSelect: () => openWorkspaceSettings() }] : []),
            { label: tr('Chọn chủ đề màu…'), icon: 'palette', onSelect: openTheme }
          ]}
        />
      )}
      sidebar={panel && !leftChat && !zoomPane && (
        <aside id={toolsId} className={`sidebar ws-tools ws-tools-${panel}`} aria-label={getWorkbenchPanel(panel)?.title()}>
          <div className="ws-tools-head">
            <h2>{getWorkbenchPanel(panel)?.title()}</h2>
            <button type="button" className="ws-icon-button" aria-label={vi.workspace.closePanel} title={vi.workspace.closePanel}
              onClick={() => setPanel(null)}><Icon name="close" size={15} /></button>
          </div>
          {getWorkbenchPanel(panel)?.render(panelCtx)}
        </aside>
      )}
      center={
        <WorkbenchCenter centered={centered}>
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
        <CollabBar />
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
        <QuickActionBar />
        <div className="tabs ws-tabs" role="tablist" aria-label={tr('Các thẻ không gian làm việc')} ref={tabList} onKeyDown={onTabKeys}>
          {MAIN_TABS.map((t) => (
            <button key={t} id={tabId(t)} type="button" role="tab" aria-selected={tab === t} aria-controls={viewId} tabIndex={tab === t ? 0 : -1}
              data-tone={VIEW_TONE[t]} className={`tab${tab === t ? ' active' : ''}`} onClick={() => selectView(t)}>
              <Icon name={t} size={16} /><span>{tabLabels()[t]}</span>
            </button>
          ))}
          {prsAvailable && (
            <button id={tabId('prs')} type="button" role="tab" aria-selected={tab === 'prs'} aria-controls={viewId} tabIndex={tab === 'prs' ? 0 : -1}
              data-tone="teal" className={`tab${tab === 'prs' ? ' active' : ''}`} onClick={() => setTab('prs')}>
              <Icon name="pr" size={16} /><span>{vi.prs.tab}</span>
            </button>
          )}
          {orderedFiles.map((f) => {
            const locked = lockedFiles.has(f.file)
            return <span key={f.file} className={`tab file-tab${tab === `file:${f.file}` ? ' active' : ''}`} style={dropTarget === f.file ? { outline: '2px solid var(--teal)', outlineOffset: -2 } : undefined}
              draggable
              onDragStart={(event) => { draggedTab.current = f.file; if (event.dataTransfer) { event.dataTransfer.setData('text/plain', f.file); event.dataTransfer.effectAllowed = 'move' } }}
              onDragOver={(event) => { event.preventDefault(); if (draggedTab.current && draggedTab.current !== f.file) setDropTarget(f.file) }}
              onDragLeave={() => setDropTarget((cur) => cur === f.file ? null : cur)}
              onDrop={(event) => { event.preventDefault(); const from = draggedTab.current ?? event.dataTransfer?.getData('text/plain') ?? ''; moveTab(from, f.file); draggedTab.current = null; setDropTarget(null) }}
              onDragEnd={() => { draggedTab.current = null; setDropTarget(null) }}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); closeFile(f.file) } }}
              onContextMenu={(event) => { event.preventDefault(); setTabMenu({ file: f.file, x: event.clientX, y: event.clientY }) }}>
              <button id={tabId(`file:${f.file}`)} type="button" role="tab" aria-selected={tab === `file:${f.file}`} aria-controls={viewId}
                aria-label={baseName(f.file)} tabIndex={tab === `file:${f.file}` ? 0 : -1}
                title={f.file} className="tab-name" onClick={() => { tabCycle.current = null; setTab(`file:${f.file}`) }}>
                <FileTypeIcon name={f.file} /><span>{baseName(f.file)}</span>
                {dirtyFiles.has(f.file) && <span className="dirty-dot" aria-hidden="true"> ●</span>}
              </button>
              <button type="button" className="tab-close tab-lock" style={{ opacity: 1, color: locked ? 'var(--amber)' : undefined }} aria-pressed={locked}
                aria-label={locked ? tr('Bỏ khóa chỉ đọc {name}', { name: baseName(f.file) }) : tr('Khóa chỉ đọc {name}', { name: baseName(f.file) })}
                title={locked ? tr('Cho phép sửa thẻ') : tr('Chỉ đọc thẻ')} onClick={() => toggleLocked(f.file)}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="5" y="10" width="14" height="10" rx="2" />
                  <path d={locked ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M8 10V7a4 4 0 0 1 7-2.6'} />
                </svg>
              </button>
              {pinned.has(f.file)
                ? <button type="button" className="tab-close tab-pin" aria-label={tr('Bỏ ghim {name}', { name: baseName(f.file) })} title={tr('Bỏ ghim')} onClick={() => togglePinned(f.file)}>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 3 6 6-1 3 3 3-1 1-5-1-5 5 2-6-3-3 1-1 3 1z" /></svg>
                  </button>
                : <button type="button" className="tab-close" aria-label={tr('Đóng {name}', { name: baseName(f.file) })} onClick={() => closeFile(f.file)}><Icon name="close" size={12} /></button>}
            </span>
          })}
          {previews.map((file) => <span key={`preview:${file}`} className={`tab file-tab${tab === `preview:${file}` ? ' active' : ''}`}>
            <button id={tabId(`preview:${file}`)} type="button" role="tab" aria-selected={tab === `preview:${file}`} aria-controls={viewId}
              tabIndex={tab === `preview:${file}` ? 0 : -1} title={file} className="tab-name" onClick={() => setTab(`preview:${file}`)}>
              <FileTypeIcon name={file} /><span>{tr('Xem trước {name}', { name: baseName(file) })}</span>
            </button>
            <button type="button" className="tab-close" aria-label={tr('Đóng xem trước {name}', { name: baseName(file) })} onClick={() => closePreview(file)}><Icon name="close" size={12} /></button>
          </span>)}
          {inspections.map((inspection) => <span key={inspection.id} className={`tab file-tab${tab === `task:${inspection.id}` ? ' active' : ''}`}>
            <button id={tabId(`task:${inspection.id}`)} type="button" role="tab" aria-selected={tab === `task:${inspection.id}`} aria-controls={viewId} tabIndex={tab === `task:${inspection.id}` ? 0 : -1} className="tab-name" onClick={() => setTab(`task:${inspection.id}`)}><Icon name="spark" size={14} /><span>{inspection.title}</span></button>
            <button type="button" className="tab-close" aria-label={tr('Đóng {name}', { name: inspection.title })} onClick={() => { setInspections((current) => current.filter((item) => item.id !== inspection.id)); if (tab === `task:${inspection.id}`) setTab(lastMain) }}><Icon name="close" size={12} /></button>
          </span>)}
          {collab.role === 'guest' && collab.file && <span className={`tab file-tab${tab === 'collab' ? ' active' : ''}`}>
            <button id={tabId('collab')} type="button" role="tab" aria-selected={tab === 'collab'} aria-controls={viewId} tabIndex={tab === 'collab' ? 0 : -1} className="tab-name"
              title={tr('Cộng tác: {file}', { file: collab.file })} onClick={() => setTab('collab')}><Icon name="share" size={14} /><span>{tr('{name} · cộng tác', { name: baseName(collab.file) })}</span></button>
            <button type="button" className="tab-close" aria-label={tr('Rời phiên cộng tác')} onClick={leaveSession}><Icon name="close" size={12} /></button>
          </span>}
          {diffs.map((d) => <span key={diffKey(d)} className={`tab file-tab${tab === diffKey(d) ? ' active' : ''}`}>
            <button id={tabId(diffKey(d))} type="button" role="tab" aria-selected={tab === diffKey(d)} aria-controls={viewId} tabIndex={tab === diffKey(d) ? 0 : -1} className="tab-name"
              title={`${d.file} (${d.staged ? tr('đã stage') : tr('chưa stage')})`} onClick={() => setTab(diffKey(d))}><Icon name="commit" size={14} /><span>{baseName(d.file)} · diff</span></button>
            <button type="button" className="tab-close" aria-label={tr('Đóng diff {name}', { name: baseName(d.file) })} onClick={() => closeDiff(d)}><Icon name="close" size={12} /></button>
          </span>)}
          {multiBuffers.map((request) => <span key={request.id} className={`tab file-tab${tab === `multi:${request.id}` ? ' active' : ''}`}>
            <button id={tabId(`multi:${request.id}`)} type="button" role="tab" aria-selected={tab === `multi:${request.id}`} aria-controls={viewId}
              tabIndex={tab === `multi:${request.id}` ? 0 : -1} title={msgText(request.title)} className="tab-name" onClick={() => setTab(`multi:${request.id}`)}>
              <Icon name="tree" size={14} /><span>{msgText(request.title)}</span>
            </button>
            <button type="button" className="tab-close" aria-label={tr('Đóng {name}', { name: msgText(request.title) })} onClick={() => closeMulti(request)}><Icon name="close" size={12} /></button>
          </span>)}
        </div>
        {tabMenu && <>
          <div className="menu-backdrop" onClick={() => setTabMenu(null)} onContextMenu={(event) => { event.preventDefault(); setTabMenu(null) }} />
          <div role="menu" aria-label={tr('Thẻ {name}', { name: baseName(tabMenu.file) })} className="context-menu ws-tab-menu"
            style={{ left: Math.max(4, Math.min(tabMenu.x, window.innerWidth - 220)), top: Math.max(4, Math.min(tabMenu.y, window.innerHeight - 200)) }}>
            {[
              { label: tr('Đóng'), action: () => closeFile(tabMenu.file) },
              { label: tr('Đóng thẻ khác'), action: () => closeFiles(orderedFiles.filter((item) => item.file !== tabMenu.file && !pinned.has(item.file)).map((item) => item.file)) },
              { label: tr('Đóng thẻ bên phải'), action: () => closeFiles(orderedFiles.slice(orderedFiles.findIndex((item) => item.file === tabMenu.file) + 1).filter((item) => !pinned.has(item.file)).map((item) => item.file)) },
              { label: tr('Đóng tất cả'), action: () => closeFiles(orderedFiles.filter((item) => !pinned.has(item.file)).map((item) => item.file)) },
              { label: lockedFiles.has(tabMenu.file) ? tr('Cho phép sửa thẻ') : tr('Chỉ đọc thẻ'), action: () => toggleLocked(tabMenu.file) },
              { label: pinned.has(tabMenu.file) ? tr('Bỏ ghim thẻ') : tr('Ghim thẻ'), action: () => togglePinned(tabMenu.file) }
            ].map((item) => <button key={item.label} type="button" role="menuitem" onClick={() => { setTabMenu(null); item.action() }}>{item.label}</button>)}
          </div>
        </>}
        <div data-split={sideShown ? splitSide : undefined} className={`canvas-wrap${sideShown ? ' split' : ''}`} id={viewId} role="tabpanel" aria-labelledby={tabId(tab)} tabIndex={0}>
          {tab === 'arch' && <ArchitectureCanvas key={`${archParent ?? 'root'}:${openSeq}`} projectId={project.project_id} revision={revision} initialParent={archParent} onParentChange={setArchContext} onOpenNode={openNodeId} onOpenCode={openCode} onOpenProjects={onOpenProjects ? guardLeave(onOpenProjects) : undefined} />}
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
              {notice && <p role="status" className="path-notice">{msgText(notice)}</p>}
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
              <h2>{hosted ? tr('Xem mã nguồn') : tr('Chưa mở tệp')}</h2>
              <p className="muted">{hosted
                ? tr('Chọn một tệp trong cây để mở bằng trình soạn thảo của nền.')
                : tr('Chọn một tệp trong cây bên trái để xem và chỉnh sửa mã.')}</p>
              {panel !== 'explorer' && (
                <button type="button" onClick={() => setPanel('explorer')}>{tr('Mở cây tệp')}</button>
              )}
            </div>
          )}
          {tab === 'prs' && <PrsView projectId={project.project_id} onOpenNode={openNodeId} />}
          {tab === 'report' && (
            <ReportView projectId={project.project_id} revision={revision} onOpenNode={openNodeId} onAsk={(q) => void askOnGraph(q)}
              onExportMarkdown={() => openExport({ kind: 'all' }, 'markdown')} />
          )}
          {files.map((f) => (
            <FileView key={f.file} projectId={project.project_id} file={f.file} line={f.line} column={f.column} lineEnd={f.lineEnd} revealRequest={f.seq} active={!hidden && (tab === `file:${f.file}` || tab === `preview:${f.file}` && !isMarkdownFile(f.file))} locked={lockedFiles.has(f.file)}
              onClose={() => closeFile(f.file)} onDirtyChange={onDirtyChange} onContextReady={contextReady} onSplit={() => { setPreviewSide(null); setSide(f.file) }}
              onOpenFile={(file, line, column) => openCode(file, line, undefined, column)}
              onReadOnlyChange={(file, readOnly) => setReadOnlyFiles((cur) => cur[file] === readOnly ? cur : { ...cur, [file]: readOnly })}
              onLoadError={(file, error) => setViewerErrors((cur) => (cur[file] ?? null) === error ? cur : { ...cur, [file]: error })}
              onSavedAs={(from, to) => { closeFiles([from], true); openCode(to) }} />
          ))}
          {multiBuffers.map((request) => <MultiBufferView key={request.id} projectId={project.project_id} request={request}
            active={!hidden && tab === `multi:${request.id}`} onClose={() => closeMulti(request)} onDirtyChange={onDirtyChange}
            lockedFiles={lockedFiles} onOpenFile={(file, line) => openCode(file, line)} />)}
          {previewFile && isMarkdownFile(previewFile) && <MarkdownPreview key={previewFile} projectId={project.project_id} file={previewFile} active={!hidden} loadError={viewerErrors[previewFile]} readOnly={readOnlyFiles[previewFile] !== false} onClose={() => closePreview(previewFile)} onOpenFile={openCode} />}
          {previewSideShown && previewSide && isMarkdownFile(previewSide) && <MarkdownPreview key={`side:${previewSide}`} projectId={project.project_id} file={previewSide} active={!hidden} loadError={viewerErrors[previewSide]} readOnly={readOnlyFiles[previewSide] !== false} side onClose={() => setPreviewSide(null)} onOpenFile={openCode} />}
          {sideShown && !previewSideShown && side && <SplitEditor key={side} projectId={project.project_id} file={side} locked={lockedFiles.has(side)} onClose={() => setSide(null)} />}
          {inspections.filter((inspection) => tab === `task:${inspection.id}`).map((inspection) => <TaskInspector key={inspection.id} inspection={inspection} />)}
          {tab === 'collab' && collab.role === 'guest' && collab.file && <CollabTab key={collab.file} file={collab.file} />}
          {diffs.filter((d) => tab === diffKey(d)).map((d) => <GitDiffView key={diffKey(d)} projectId={project.project_id} file={d.file} staged={d.staged} rev={d.rev} from={d.from}
            onClose={() => closeDiff(d)} onOpenFile={() => openCode(d.file)} />)}
          {feedback && (
            <div className="ws-feedback">
              <span role="alert">{msgText(feedback)}</span>
              <button type="button" className="ws-icon-button" aria-label={tr('Đóng thông báo')} onClick={() => setFeedback(null)}>×</button>
            </div>
          )}
        </div>
        {terminal !== 'closed' && <TerminalPanel projectId={project.project_id} projectPath={project.path} newRequest={terminalNew} taskRequest={taskRequest} hidden={hidden || zoomPane || terminal === 'hidden'}
          onOpenFile={(file, line, column) => openCode(file, line, undefined, column)}
          onHide={() => setTerminal('hidden')} onCloseAll={() => { setTerminal('closed'); setTaskRequest(null) }} />}
      </WorkbenchCenter>
      }
      dock={!hosted && !zoomPane && (
        <ChatDock side={chatDock} hidden={!chatOpen}>
          {agentPanel}
          {resizeHandle}
        </ChatDock>
      )}>
      {!hidden && <EditorTools projectId={project.project_id} editor={activeEditor} symbols={documentSymbols.symbols} symbolsError={documentSymbols.error}
        onOpen={(file, line, column) => openCode(file, line, undefined, column)} onDiagnostics={() => togglePanel('diagnostics')} onError={setFeedback} />}
      {connectOpenCode && <IntegrationsDialog project={project} initialAgent="opencode" onClose={() => setConnectOpenCode(false)} />}
      {finder && <FileFinder projectId={project.project_id} projectName={project.name} recent={recentFiles} onOpen={(path) => openCode(path)} onClose={() => setFinder(false)} />}
      {taskPicker && <TaskPicker projectId={project.project_id} history={taskHistory} onPick={(task, oneshot) => void runTask(task, oneshot)} onOpenFile={(path) => openCode(path)} onClose={() => setTaskPicker(false)} />}
      {worktrees && openWorktree && <WorktreePicker projectId={project.project_id} onOpen={openWorktree} onClose={() => setWorktrees(false)} />}
      {joining && <JoinDialog onClose={() => setJoining(false)} onJoined={() => setTab('collab')} />}
    </WorkspaceShell>
  )
}
