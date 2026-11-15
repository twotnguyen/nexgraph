import type { EngineStatus } from './engine-status'
import type { AgentId, IntegrationPlan } from './integration-types'
import type { AgentEvent, AgentMode } from './agent-types'
import type {
  AiSettings,
  ArchEvidence, ArchView, AskResult, Changes, CodeSlice, EngineEvent, ExportFormat, ExportResult, ExportScope,
  ContextPack, TourStep, FlowDetail, FlowList, FlowQuery, ImportCycles, ProjectMap,
  GraphNode, GraphReport, GraphStats, IndexOptions, NeighborQuery, Neighborhood, NodeImpact, PathResult,
  ProjectSummary, PushRequest, PushResult, RefreshResult, ScanInfo, SearchHit
} from './graph-types'

export type FileContent = { text: string; eol: '\n' | '\r\n'; bom: boolean; mtimeMs: number; readOnly: boolean; reason?: 'too_large' | 'not_text' }
export type WriteOpts = { eol: '\n' | '\r\n'; bom: boolean; expectedMtimeMs?: number }

/** API mà preload phơi ra renderer qua `window.nexgraph`. Lỗi từ engine là đối tượng `{ name, code, message }` (không phải Error: contextBridge làm mất thuộc tính của Error). */
export interface NexGraphApi {
  engine: {
    status(): Promise<EngineStatus>
    restart(): Promise<void>
    /** Công cụ ngoài có trên máy: `{ ffmpeg, faster_whisper, git, gh, yt_dlp }`. */
    tools(): Promise<Record<string, boolean>>
    /** Trả về hàm huỷ đăng ký. */
    onStatus(cb: (s: EngineStatus) => void): () => void
  }
  project: {
    /** Hộp thoại chọn thư mục; `null` khi người dùng huỷ. */
    pickFolder(): Promise<string | null>
    open(path: string): Promise<ProjectSummary>
    list(): Promise<ProjectSummary[]>
  }
  index: {
    scan(projectId: string): Promise<ScanInfo>
    start(projectId: string, opts?: IndexOptions): Promise<{ jobId: string }>
    cancel(jobId: string): Promise<void>
    /** Lập chỉ mục tăng dần; `status: 'skipped'` khi đang lập chỉ mục đầy đủ hoặc đang refresh. */
    refresh(projectId: string): Promise<RefreshResult>
    onEvent(cb: (e: EngineEvent) => void): () => void
  }
  graph: {
    stats(projectId: string): Promise<GraphStats>
    neighbors(projectId: string, q: NeighborQuery): Promise<Neighborhood>
    node(projectId: string, id: string): Promise<GraphNode>
    code(projectId: string, file: string, start?: number, end?: number): Promise<CodeSlice>
    search(projectId: string, q: string, opts?: { kinds?: string[]; limit?: number }): Promise<SearchHit[]>
    architecture(projectId: string, parent?: string): Promise<ArchView>
    archEvidence(projectId: string, from: string, to: string, limit?: number): Promise<ArchEvidence[]>
    /** `refresh: false` chỉ đọc, không cập nhật đồ thị trước. */
    changes(projectId: string, opts?: { refresh?: boolean }): Promise<Changes>
    report(projectId: string): Promise<GraphReport>
    paths(projectId: string, nodeIds: string[], opts?: { maxHops?: number; directed?: boolean }): Promise<PathResult>
    impactOf(projectId: string, nodeId: string): Promise<NodeImpact>
    ask(projectId: string, question: string, opts?: { depth?: number; budget?: number; mode?: 'bfs' | 'dfs' }): Promise<AskResult>
    /** Tính lại cộng đồng (khối kiến trúc) trên đồ thị đã có. */
    recluster(projectId: string): Promise<{ communities: number }>
    flows(projectId: string, opts?: FlowQuery): Promise<FlowList>
    flow(projectId: string, flowId: number): Promise<FlowDetail>
    tour(projectId: string): Promise<{ steps: TourStep[] }>
    locate(projectId: string, file: string, line: number): Promise<{ node: GraphNode }>
    context(projectId: string, question: string, budget?: number): Promise<ContextPack>
    map(projectId: string, opts?: { parent?: string; detail?: number }): Promise<ProjectMap>
    cycles(projectId: string, limit?: number): Promise<ImportCycles>
  }
  fs: {
    /** Đọc tệp trong gốc dự án; lỗi có `code` là `outside_project` | `file_not_found`. */
    read(projectId: string, relPath: string): Promise<FileContent>
    /** Ghi nguyên tử trong gốc dự án; `expectedMtimeMs` lệch với đĩa thì lỗi `conflict`. */
    write(projectId: string, relPath: string, text: string, opts: WriteOpts): Promise<{ mtimeMs: number }>
  }
  exporter: {
    /** Hộp thoại chọn thư mục đích, nhớ lựa chọn lần trước; `null` khi huỷ. */
    pickDir(): Promise<string | null>
    run(projectId: string, format: ExportFormat, scope: ExportScope, outDir: string): Promise<ExportResult>
    push(projectId: string, req: PushRequest): Promise<PushResult>
    /** Chụp vùng `rect` của cửa sổ (toạ độ CSS; vắng thì cả cửa sổ) và lưu PNG; `null` khi huỷ. */
    png(rect?: { x: number; y: number; width: number; height: number }): Promise<string | null>
    reveal(path: string): Promise<void>
  }
  hook: {
    status(projectPath: string): Promise<'no_git' | 'off' | 'on' | 'outdated'>
    preview(projectPath: string): Promise<string>
    install(projectPath: string): Promise<void>
    uninstall(projectPath: string): Promise<void>
  }
  ai: {
    getSettings(): Promise<AiSettings>
    saveSettings(s: { baseUrl: string; model: string; apiKey?: string }): Promise<AiSettings>
    test(): Promise<{ ok: boolean; ms: number; error: string | null }>
    hasConsent(projectId: string): Promise<boolean>
    grantConsent(projectId: string): Promise<void>
  }
  /** Phiên agent theo dự án (giữ hội thoại trong bộ nhớ). Lỗi có `code`: `consent_required` | `ai_not_configured` | `agent_busy`. */
  agent: {
    /** Gửi một lượt; kết quả đến qua `onEvent` (`text`… rồi `done` hoặc `error`). Resolve khi lượt kết thúc. */
    prompt(projectId: string, text: string): Promise<void>
    abort(projectId: string): Promise<void>
    /** Đổi chế độ; yêu cầu duyệt đang chờ bị từ chối. */
    setMode(projectId: string, mode: AgentMode): Promise<void>
    getMode(projectId: string): Promise<AgentMode>
    approve(projectId: string, id: string, allow: boolean): Promise<void>
    /** Rời dự án: từ chối yêu cầu đang chờ, huỷ phiên. */
    close(projectId: string): Promise<void>
    onEvent(cb: (projectId: string, e: AgentEvent) => void): () => void
  }
  mcp: {
    /** JSON `mcpServers` cho trợ lý AI chạy MCP qua stdio. */
    config(projectPath: string): Promise<{ stdio: string }>
    plan(agent: AgentId, projectPath: string): Promise<IntegrationPlan>
    apply(agent: AgentId, projectPath: string): Promise<IntegrationPlan>
    startHttp(projectId: string, projectPath: string): Promise<{ url: string; key: string }>
    stopHttp(projectId: string): Promise<void>
    httpStatus(projectId: string): Promise<{ url: string } | null>
  }
  /** Theo dõi thư mục project; sự thay đổi làm main gọi refresh và engine phát `changes_updated`. */
  watch: {
    start(projectId: string, path: string): Promise<void>
    stop(projectId: string): Promise<void>
  }
}
