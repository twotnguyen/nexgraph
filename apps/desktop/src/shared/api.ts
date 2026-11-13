import type { EngineStatus } from './engine-status'
import type { AgentId, IntegrationPlan } from './integration-types'
import type {
  AiSettings, ChatAnswer, ChatMessage,
  ArchEvidence, ArchView, AskResult, Changes, CodeSlice, EngineEvent, ExportFormat, ExportResult, ExportScope,
  ContextPack, TourStep, FlowDetail, FlowList, FlowQuery, ImportCycles, ProjectMap,
  GraphNode, GraphReport, GraphStats, IndexOptions, NeighborQuery, Neighborhood, NodeImpact, PathResult,
  ProjectSummary, PushRequest, PushResult, RefreshResult, ScanInfo, SearchHit
} from './graph-types'

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
    send(projectId: string, chatId: string, messages: ChatMessage[]): Promise<ChatAnswer>
    cancel(chatId: string): Promise<void>
    onEvent(cb: (e: { chatId: string; type: 'tool'; name: string }) => void): () => void
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
