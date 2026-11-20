import type { EngineStatus } from './engine-status'
import type { AgentId, IntegrationOptions, IntegrationPlan } from './integration-types'
import type { GeminiCliApi } from './gemini-types'
import type {
  AgentEvent, AgentMode, AiConsentTarget, AuthEventView, AuthPromptView, CustomProvider, ModelInfo, ProviderInfo,
  LocalModelInfo, AgentPromptOptions, AgentExecutionSettings, AgentRunLimits, AgentSessionInfo, AgentSessionSnapshot,
  ProjectCommands, AgentCheckpointInfo, AgentRollbackResult, AgentEditorState
} from './agent-types'
import type {
  AiSettings,
  ArchEvidence, ArchView, AskResult, Changes, CodeSlice, EngineEvent, ExportFormat, ExportResult, ExportScope,
  ContextPack, TourStep, FlowDetail, FlowList, FlowQuery, ImportCycles, ProjectMap,
  DocSection, GraphNode, GraphReport, GraphStats, IndexOptions, Job, NeighborQuery, Neighborhood, NodeExplain, NodeImpact, PathResult,
  ProjectSummary, PushRequest, PushResult, RefreshResult, ScanInfo, SearchHit, SourceItem
} from './graph-types'
import type { IndexSources } from './graph-types'
import type { PrAvailability, PrDetail, PrList } from './graph-types'

export type FileRevision = { mtimeMs: number; version: string }
export type FileContent = FileRevision & {
  text: string
  eol: '\n' | '\r\n'
  bom: boolean
  readOnly: boolean
  reason?: 'too_large' | 'not_text'
}
export type WriteOpts = {
  eol: '\n' | '\r\n'
  bom: boolean
  /** Phiên bản từ lúc đọc hoặc `null` nếu tệp phải chưa tồn tại. */
  expectedVersion?: string | null
  expectedMtimeMs?: number
}

export type ProjectDirectory = {
  entries: { path: string; name: string; kind: 'directory' | 'file' }[]
  truncated: boolean
}

export type HostCommand = { name: string; arg?: unknown }

/** API mà preload phơi ra renderer qua `window.nexgraph`. Lỗi từ engine là đối tượng `{ name, code, message }` (không phải Error: contextBridge làm mất thuộc tính của Error). */
export interface NexGraphApi {
  gemini: GeminiCliApi
  /** Chỉ có khi chạy trong extension (nền Code-OSS): thư mục đang mở và lệnh mở tệp bằng editor của nền. */
  host?: {
    folder: string | null
    openFile(file: string, line?: number, lineEnd?: number): Promise<void>
    /** Thẻ cần mở đầu tiên (do lệnh của nền chọn). */
    initialView?: string
    /** Lệnh đã mở webview Code-OSS, gồm cả lệnh chuyển thẻ và công cụ. */
    initialCommand?: HostCommand
    /** Lệnh từ giao diện của nền hoặc từ view khác: `view:<thẻ>`, `panel:<tên>`, `export`, `overview`, `settings`, `highlight` (kèm `arg`). Trả về hàm huỷ đăng ký. */
    onCommand(cb: (name: string, arg?: unknown) => void): () => void
    /** Gửi một lệnh sang tab NexGraph chính (dùng từ view Trợ lý AI). */
    emit(name: string, arg?: unknown): Promise<void>
  }
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
    /** Gỡ đăng ký tại ứng dụng. Mở lại cùng thư mục sẽ dùng lại đồ thị đã lưu. */
    remove(projectId: string): Promise<void>
  }
  index: {
    scan(projectId: string): Promise<ScanInfo>
    start(projectId: string, opts?: IndexOptions): Promise<{ jobId: string }>
    status(jobId: string): Promise<Job>
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
    explain(projectId: string, nodeId: string): Promise<NodeExplain>
    section(projectId: string, nodeId: string): Promise<DocSection>
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
    /** Liệt kê một cấp trong thư mục dự án, dùng đường dẫn tương đối hoặc `.` cho gốc. */
    list?(projectId: string, directory: string): Promise<ProjectDirectory>
    /** Đọc tệp trong gốc dự án; lỗi có `code` là `outside_project` | `file_not_found`. */
    read(projectId: string, relPath: string): Promise<FileContent>
    /** Ghi nguyên tử trong gốc dự án. Nếu tệp lệch phiên bản yêu cầu thì báo `conflict`. */
    write(projectId: string, relPath: string, text: string, opts: WriteOpts & { expectedVersion: string | null }): Promise<FileRevision>
  }
  exporter: {
    /** Hộp thoại chọn thư mục đích; main nhớ theo projectId, `null` khi huỷ. */
    pickDir(projectId: string): Promise<string | null>
    /** Chỉ dùng thư mục đã lưu theo projectId; renderer không gửi path. */
    run(projectId: string, format: ExportFormat, scope: ExportScope): Promise<ExportResult>
    push(projectId: string, req: PushRequest): Promise<PushResult>
    /** Chụp vùng `rect` của cửa sổ (toạ độ CSS; vắng thì cả cửa sổ) và lưu PNG; `null` khi huỷ. */
    png(rect?: { x: number; y: number; width: number; height: number }): Promise<string | null>
    /** Chỉ cho path nằm trong gốc dự án hoặc thư mục xuất đã lưu. */
    reveal(projectId: string, path: string): Promise<void>
  }
  hook: {
    status(projectId: string): Promise<'no_git' | 'off' | 'on' | 'outdated'>
    preview(projectId: string): Promise<string>
    install(projectId: string): Promise<void>
    uninstall(projectId: string): Promise<void>
  }
  ai: {
    /** Cấu hình của đích nhận dữ liệu đang chọn. */
    getSettings(): Promise<AiSettings>
    hasConsent(projectId: string, target: AiConsentTarget): Promise<boolean>
    grantConsent(projectId: string, target: AiConsentTarget): Promise<void>
  }
  /** Tài khoản AI: key chỉ ở main (safeStorage), renderer chỉ nhận `hasKey`. */
  auth: {
    list(): Promise<ProviderInfo[]>
    setKey(providerId: string, key: string): Promise<void>
    removeKey(providerId: string): Promise<void>
    saveCustom(p: CustomProvider, apiKey?: string): Promise<void>
    removeCustom(id: string): Promise<void>
    /** Đăng nhập OAuth; resolve khi xong. Sự kiện/câu hỏi qua `onEvent`/`onPrompt`, trả lời `promptReply`. */
    login(providerId: string): Promise<void>
    loginCancel(): Promise<void>
    promptReply(id: string, value: string | null): Promise<void>
    logout(providerId: string): Promise<void>
    /** Quên đăng ký ChatGPT đã đăng xuất để chọn tài khoản/workspace khác. */
    forgetRegistration(): Promise<void>
    models(): Promise<ModelInfo[]>
    selectModel(provider: string, id: string): Promise<void>
    /** Gọi provider thật với model đang chọn. */
    test(): Promise<{ ok: boolean; message: string; capabilities?: { streaming: boolean; tools: boolean } }>
    discoverLocal(baseUrl?: string): Promise<LocalModelInfo[]>
    connectLocal(baseUrl: string, modelId: string): Promise<void>
    onEvent(cb: (e: AuthEventView) => void): () => void
    onPrompt(cb: (p: AuthPromptView) => void): () => void
  }
  /** Phiên agent lưu theo dự án, tài khoản và đích nhận dữ liệu. */
  agent: {
    /** Gửi một lượt; kết quả đến qua `onEvent` (`text`… rồi `done` hoặc `error`). Resolve khi lượt kết thúc. */
    prompt(projectId: string, text: string, target: AiConsentTarget, options?: AgentPromptOptions): Promise<void>
    abort(projectId: string): Promise<void>
    /** Đổi chế độ; yêu cầu duyệt đang chờ bị từ chối. */
    setMode(projectId: string, mode: AgentMode): Promise<void>
    getMode(projectId: string): Promise<AgentMode>
    approve(projectId: string, id: string, allow: boolean): Promise<void>
    /** Rời dự án: từ chối yêu cầu đang chờ, huỷ phiên. */
    close(projectId: string): Promise<void>
    snapshot(projectId: string): Promise<AgentSessionSnapshot>
    listSessions(projectId: string): Promise<AgentSessionInfo[]>
    newSession(projectId: string): Promise<AgentSessionSnapshot>
    switchSession(projectId: string, sessionId: string): Promise<AgentSessionSnapshot>
    renameSession(projectId: string, sessionId: string, title: string): Promise<void>
    deleteSession(projectId: string, sessionId: string): Promise<void>
    setExecution(projectId: string, settings: AgentExecutionSettings): Promise<void>
    getExecution(projectId: string): Promise<AgentExecutionSettings>
    setLimits(projectId: string, limits: AgentRunLimits): Promise<void>
    getLimits(projectId: string): Promise<AgentRunLimits>
    projectCommands(projectId: string): Promise<ProjectCommands>
    checkpoints(projectId: string, taskId: string): Promise<AgentCheckpointInfo[]>
    rollback(projectId: string, taskId: string): Promise<AgentRollbackResult>
    editorState(projectId: string, states: AgentEditorState[]): Promise<void>
    onEvent(cb: (projectId: string, e: AgentEvent) => void): () => void
  }
  mcp: {
    /** JSON `mcpServers` cho trợ lý AI chạy MCP qua stdio. */
    config(projectId: string): Promise<{ stdio: string }>
    /** Xem trước các tệp sẽ ghi cho một nền tảng (MCP, khối quy tắc, skill, hook); không ghi gì. */
    plan(agent: AgentId, projectId: string, opts?: IntegrationOptions): Promise<IntegrationPlan[]>
    apply(agent: AgentId, projectId: string, opts?: IntegrationOptions): Promise<IntegrationPlan[]>
    /** Xem trước phần NexGraph sẽ gỡ khỏi các tệp của nền tảng. */
    planRemove(agent: AgentId, projectId: string): Promise<IntegrationPlan[]>
    remove(agent: AgentId, projectId: string): Promise<IntegrationPlan[]>
    startHttp(projectId: string): Promise<{ url: string; key: string }>
    stopHttp(projectId: string): Promise<void>
    httpStatus(projectId: string): Promise<{ url: string } | null>
  }
  /** Theo dõi thư mục project; sự thay đổi làm main gọi refresh và engine phát `changes_updated`. */
  watch: {
    start(projectId: string): Promise<void>
    stop(projectId: string): Promise<void>
  }
  /** Nguồn ngoài thư mục. Tiến độ job theo dõi bằng `index.status`/`index.cancel`. */
  sources: {
    /** Clone repo `https://github.com/…` hoặc `https://gitlab.com/…` vào thư mục dữ liệu app; `result.project` khi xong. */
    clone(url: string): Promise<{ jobId: string }>
    list(projectId: string): Promise<SourceItem[]>
    /** Tải URL vào nguồn của dự án rồi cập nhật đồ thị; lỗi `bad_url` khi URL bị chặn. */
    add(projectId: string, url: string): Promise<{ jobId: string }>
    remove(projectId: string, name: string): Promise<void>
  },
  /** Nguồn bổ sung của Tuỳ chọn index (W11). DSN chỉ gửi xuống main, không bao giờ đọc lại được. */
  indexSources: {
    hasDsn(projectId: string): Promise<boolean>
    saveDsn(projectId: string, dsn: string | null): Promise<void>
    pickFile(kind: 'scip' | 'mcp'): Promise<string | null>
    /** Lựa chọn nguồn đã nhớ (không gồm DSN) để hộp thoại hiện lại. */
    remembered(projectId: string): Promise<IndexSources | null>
  }
  /** Pull request của GitHub qua `gh` (W7), chỉ đọc. Lỗi có `code`: `gh_missing` | `gh_auth` | `not_github` | `gh_timeout` | `gh_failed` | `pr_not_found`. */
  prs: {
    /** Tab Pull request chỉ hiện khi `available`. */
    status(projectId: string): Promise<PrAvailability>
    list(projectId: string): Promise<PrList>
    detail(projectId: string, prNumber: number): Promise<PrDetail>
  }
}
