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
import type { AnswerRating, Lessons, MemoryKind, MemoryRecall } from './graph-types'
import type { GlobalExportResult, GlobalGraph, GlobalMember, GlobalSearchHit } from './graph-types'
import type { PrAvailability, PrDetail, PrList } from './graph-types'
import type { ProjectAiSettings, SemanticEstimate, SemanticTarget } from './graph-types'

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

/** Tìm trong tệp (⌘⇧F). `include`/`exclude`: glob cách nhau dấu phẩy. */
export type TextSearchQuery = { query: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; include?: string; exclude?: string }
/** `column` tính từ 1; `preview` là dòng chứa (cắt quanh chỗ khớp nếu dài), bắt đầu ở ký tự `previewStart` của dòng. */
export type TextSearchMatch = { line: number; column: number; length: number; preview: string; previewStart: number }
export type TextSearchResult = { files: { file: string; matches: TextSearchMatch[] }[]; truncated: boolean }
export type TextReplaceResult = { files: number; replacements: number; skipped: string[] }
/** Kết quả language server: dòng/cột tính từ 1 như Monaco. */
export type LspLocation = { file: string; line: number; column: number }
/** `kind`: CompletionItemKind của LSP (1–25). */
export type LspCompletionItem = { label: string; kind: number; detail?: string; insertText: string; sortText?: string; filterText?: string }
/** Phạm vi LSP tính từ 0; vị trí truyền vào các phương thức editor vẫn tính từ 1. */
export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }
export type LspDiagnostic = { range: LspRange; severity?: number; message: string; source?: string; code?: string | number; tags?: number[] }
export type LspTextEdit = { range: LspRange; newText: string }
export type LspWorkspaceEdit = Record<string, LspTextEdit[]>
export type LspDocumentSymbol = { name: string; kind: number; range: LspRange; selectionRange: LspRange; children?: LspDocumentSymbol[] }
export type LspWorkspaceSymbol = { name: string; kind: number; file: string; range: LspRange; containerName?: string }
/** Mục phân cấp lời gọi; `data` do server tạo và phải gửi lại nguyên vẹn cho incoming/outgoing. */
export type LspCallHierarchyItem = { name: string; kind: number; file: string; range: LspRange; selectionRange: LspRange; detail?: string; data?: unknown }
export type LspCallHierarchyCall = { from: LspCallHierarchyItem; fromRanges: LspRange[] }
export type LspMarkup = string | { kind: 'plaintext' | 'markdown'; value: string }
export type LspSignatureHelp = {
  signatures: { label: string; documentation?: LspMarkup; parameters?: { label: string | [number, number]; documentation?: LspMarkup }[]; activeParameter?: number }[]
  activeSignature?: number
  activeParameter?: number
}
export type LspCodeAction = { title: string; kind?: string; edit: LspWorkspaceEdit }
export type LspDiagnosticsEvent = { projectId: string; file: string; diagnostics: LspDiagnostic[] }
export type TerminalEvent = { id: number; type: 'data'; data: string } | { id: number; type: 'exit'; code: number }
export type TaskDefinition = { label: string; command: string; args?: string[]; type?: 'shell' | 'process'; cwd?: string; env?: Record<string, string> }
/** `status`: chữ trạng thái của `git status --porcelain` (M, A, D, R, C, U, ? cho tệp mới chưa theo dõi). */
export type GitFileChange = { path: string; status: string; from?: string; added?: number | null; deleted?: number | null }
export type GitStatus = {
  repo: boolean; branch: string | null; staged: GitFileChange[]; unstaged: GitFileChange[]; conflicts: GitFileChange[]
  upstream: string | null; ahead: number; behind: number; remote: string | null
  lastCommit: { sha: string; subject: string; message: string; hasParent: boolean; pushed: boolean } | null
}
export type GitCommit = { sha: string; parents: string[]; subject: string; author: string; time: number; refs: string }
export type GitHunk = { id: string; header: string; oldStart: number; newStart: number }
export type GitStash = { ref: string; message: string }
/** `head`: mã commit đầy đủ; `current`: worktree chứa thư mục dự án đang mở; `prunable`: thư mục đã mất khỏi đĩa. */
export type GitWorktree = { path: string; head: string; branch: string | null; detached: boolean; locked: boolean; prunable: boolean; main: boolean; current: boolean }
export type GitBlameLine = { line: number; sha: string; author: string; time: number; summary: string; uncommitted: boolean }
/** Điểm dừng theo tệp (đường dẫn tương đối dự án → các dòng, tính từ 1). */
export type DebugBreakpoint = { line: number; enabled: boolean; condition?: string; hitCondition?: string; logMessage?: string }
export type DebugBreakpoints = Record<string, DebugBreakpoint[]>
export type DebugEvaluation = { result: string; variablesReference: number }
export type DebugModule = { id: number | string; name: string; path?: string | null; version?: string | null }
export type DebugLoadedSource = { name?: string; path?: string | null; sourceReference?: number }
export type DebugEvent =
   | { type: 'state'; state: 'starting' | 'running' | 'stopped' | 'terminated'; reason?: string; threadId?: number }
   | { type: 'output'; category: string; text: string }
  | { type: 'notice'; target: 'modules' | 'loadedSources'; code?: string; detail?: string; text?: string }
/** `file` null khi khung ngăn xếp nằm ngoài dự án (thư viện, mã nội bộ). */
export type DebugFrame = { id: number; name: string; file: string | null; line: number; column: number }
export type DebugScope = { name: string; variablesReference: number; expensive: boolean }
export type DebugVariable = { name: string; value: string; type: string; variablesReference: number }
/** Cấu hình gỡ lỗi đọc từ `.vscode/launch.json` hoặc `.zed/debug.json` (đã bỏ loại chưa hỗ trợ); `source` là đường dẫn tương đối của tệp. */
export type DebugConfigInfo = { name: string; source: string; kind: 'node' | 'python'; request: 'launch' | 'attach' }
/** Cộng tác LAN: lời chào máy chia sẻ gửi khi có người nối vào. */
export type CollabHello = { file: string; host: string }
export type CollabEvent =
  | { type: 'message'; data: Uint8Array }
  | { type: 'peers'; count: number }
  | { type: 'joined' }
  | { type: 'closed' }
/** Extension nạp từ thư mục: theme (biến màu) và lệnh khai báo (không chạy mã của extension). */
export type ExtensionTheme = { id: string; name: string; appearance: 'light' | 'dark'; colors: Record<string, string> }
export type ExtensionCommand = { id: string; title: string; action: { type: 'insertText'; text: string } | { type: 'runCommands'; commands: string[] } }
export type ExtensionInfo = { id: string; name: string; version: string; description: string; themes: ExtensionTheme[]; commands: ExtensionCommand[] }

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
    /** Đọc byte gốc tối đa 50 MiB, mã hoá base64; `size` là số byte trước mã hoá. */
    readBinary?(projectId: string, relPath: string): Promise<{ data: string; size: number }>
    /** Mọi tệp của dự án (đường dẫn tương đối, theo .gitignore) cho ô tìm tệp; `truncated` khi vượt giới hạn duyệt. */
    files?(projectId: string): Promise<{ files: string[]; truncated: boolean }>
    /** Ghi nguyên tử trong gốc dự án. Nếu tệp lệch phiên bản yêu cầu thì báo `conflict`. */
    write(projectId: string, relPath: string, text: string, opts: WriteOpts & { expectedVersion: string | null }): Promise<FileRevision>
    /** Thao tác với đường dẫn tương đối bên trong dự án, không ghi đè mục có sẵn. */
    createFile?(projectId: string, path: string): Promise<void>
    createDir?(projectId: string, path: string): Promise<void>
    rename?(projectId: string, from: string, to: string): Promise<void>
    copy?(projectId: string, from: string, directory: string): Promise<string>
    trash?(projectId: string, path: string): Promise<void>
    reveal?(projectId: string, path: string): Promise<void>
    /** Tìm văn bản trong mọi tệp của dự án (theo .gitignore). */
    searchText?(projectId: string, query: TextSearchQuery): Promise<TextSearchResult>
    /** Thay mọi chỗ khớp trong các tệp `files`; tệp đổi giữa chừng nằm trong `skipped`. */
    replaceText?(projectId: string, query: TextSearchQuery, replacement: string, files: string[]): Promise<TextReplaceResult>
  }
  /** Language server (TypeScript/JavaScript, Python) cho editor; mỗi yêu cầu gửi kèm nội dung hiện tại của tệp. */
  lsp?: {
    definition(projectId: string, file: string, text: string, line: number, column: number): Promise<LspLocation[]>
    declaration(projectId: string, file: string, text: string, line: number, column: number): Promise<LspLocation[]>
    typeDefinition(projectId: string, file: string, text: string, line: number, column: number): Promise<LspLocation[]>
    completion(projectId: string, file: string, text: string, line: number, column: number): Promise<LspCompletionItem[]>
    hover(projectId: string, file: string, text: string, line: number, column: number): Promise<string | null>
    references(projectId: string, file: string, text: string, line: number, column: number): Promise<LspLocation[]>
    implementation(projectId: string, file: string, text: string, line: number, column: number): Promise<LspLocation[]>
    rename(projectId: string, file: string, text: string, line: number, column: number, newName: string): Promise<LspWorkspaceEdit>
    format(projectId: string, file: string, text: string, options: { tabSize: number; insertSpaces: boolean }): Promise<LspTextEdit[]>
    documentSymbols(projectId: string, file: string, text: string): Promise<LspDocumentSymbol[]>
    callHierarchyPrepare(projectId: string, file: string, text: string, line: number, column: number): Promise<LspCallHierarchyItem[] | null>
    callHierarchyIncoming(projectId: string, file: string, text: string, line: number, column: number, item: LspCallHierarchyItem): Promise<LspCallHierarchyCall[]>
    callHierarchyOutgoing(projectId: string, file: string, text: string, line: number, column: number, item: LspCallHierarchyItem): Promise<LspCallHierarchyCall[]>
    workspaceSymbols(projectId: string, query: string): Promise<LspWorkspaceSymbol[]>
    signatureHelp(projectId: string, file: string, text: string, line: number, column: number): Promise<LspSignatureHelp | null>
    codeActions(projectId: string, file: string, text: string, range: LspRange): Promise<LspCodeAction[]>
    onDiagnostics(cb: (event: LspDiagnosticsEvent) => void): () => void
    close(projectId: string, file: string): Promise<void>
    open(projectId: string, file: string, text: string): Promise<void>
  }
  /** Terminal tích hợp (node-pty): shell của người dùng trong gốc dự án. */
  terminal?: {
    create(projectId: string, cols: number, rows: number, task?: TaskDefinition): Promise<{ id: number; shell: string; cwd: string }>
    write(id: number, data: string): Promise<void>
    resize(id: number, cols: number, rows: number): Promise<void>
    kill(id: number): Promise<void>
    resolvePath(projectId: string, path: string): Promise<string | null>
    onEvent(cb: (event: TerminalEvent) => void): () => void
  }
  /** Task khai báo trong dự án và thay biến theo ngữ cảnh editor. */
  tasks?: {
    list(projectId: string): Promise<TaskDefinition[]>
    resolve(projectId: string, task: TaskDefinition, context: { file?: string; line?: number }): Promise<TaskDefinition>
    /** Tệp cấu hình để mở trong editor (đường dẫn tương đối); tạo `.vscode/tasks.json` mẫu nếu dự án chưa có tệp nào. */
    configFile(projectId: string): Promise<string>
  }
  /** Git panel: trạng thái, stage/unstage từng tệp, commit, diff và blame trong gốc dự án. */
  git?: {
    status(projectId: string): Promise<GitStatus>
    stage(projectId: string, files: string[]): Promise<void>
    unstage(projectId: string, files: string[]): Promise<void>
    commit(projectId: string, message: string, amend?: boolean, coAuthors?: string[]): Promise<string>
    diff(projectId: string, file: string, staged: boolean, base?: string): Promise<{ before: string; after: string }>
    blame(projectId: string, file: string): Promise<GitBlameLine[]>
    restore(projectId: string, file: string): Promise<void>
    branches(projectId: string): Promise<string[]>
    switchBranch(projectId: string, name: string, create: boolean): Promise<void>
    remote(projectId: string, op: 'fetch' | 'pull' | 'push'): Promise<string>
    history(projectId: string, all: boolean): Promise<GitCommit[]>
    commitFiles(projectId: string, sha: string): Promise<GitFileChange[]>
    commitDiff(projectId: string, sha: string, file: string, from?: string): Promise<{ before: string; after: string }>
    hunks(projectId: string, file: string, staged: boolean): Promise<GitHunk[]>
    applyHunk(projectId: string, file: string, staged: boolean, id: string): Promise<void>
    stashes(projectId: string): Promise<GitStash[]>
    stashSave(projectId: string, message: string): Promise<void>
    stashAction(projectId: string, ref: string, action: 'apply' | 'pop' | 'drop'): Promise<void>
    suggestMessage(projectId: string): Promise<string>
    worktrees(projectId: string): Promise<GitWorktree[]>
    /** Tạo worktree cạnh kho cho nhánh mới (từ HEAD) hoặc nhánh có sẵn; trả về thư mục đã tạo. */
    worktreeAdd(projectId: string, branch: string, existing: boolean): Promise<string>
    /** Không cưỡng bức: worktree còn thay đổi chưa commit thì lỗi `worktree_dirty`. */
    worktreeRemove(projectId: string, path: string): Promise<void>
    /** URL web của tệp tại commit HEAD (có `#L…` khi có dòng); `text` là nội dung đang soạn, để ánh xạ đúng cả khi chưa lưu. `published` false khi remote chưa có HEAD. */
    permalink(projectId: string, file: string, start?: number, end?: number, text?: string): Promise<{ url: string; published: boolean }>
  }
  /** Gỡ lỗi (DAP): js-debug cho Node, debugpy cho Python; adapter tải về khi người dùng đồng ý. */
  debug?: {
    adapterStatus(): Promise<{ node: boolean; python: boolean }>
    installAdapter(kind: 'node' | 'python'): Promise<void>
    start(projectId: string, kind: 'node' | 'python', file: string, breakpoints: DebugBreakpoints): Promise<void>
    /** Cấu hình đọc được trong dự án; tệp JSON sai cú pháp báo lỗi. */
    configs(projectId: string): Promise<DebugConfigInfo[]>
    /** Tệp cấu hình để mở trong editor (đường dẫn tương đối); tạo `.vscode/launch.json` mẫu nếu dự án chưa có tệp nào. */
    configFile(projectId: string): Promise<string>
    /** Chạy cấu hình theo (tệp, tên); `file` là tệp đang mở để thay `${file}`. */
    startConfig(projectId: string, config: { source: string; name: string }, file: string | null, breakpoints: DebugBreakpoints): Promise<void>
    /** Nối vào tiến trình đang chờ gỡ lỗi: Node qua `--inspect` (js-debug), Python qua `debugpy.listen`. Dừng chỉ ngắt kết nối, không tắt tiến trình. */
    attach(projectId: string, kind: 'node' | 'python', host: string, port: number, breakpoints: DebugBreakpoints): Promise<void>
    setBreakpoints(file: string, breakpoints: DebugBreakpoint[]): Promise<void>
    step(action: 'continue' | 'next' | 'stepIn' | 'stepOut', threadId: number): Promise<void>
    pause(): Promise<void>
    restart(): Promise<void>
    evaluate(expression: string, frameId: number, context: 'watch' | 'repl'): Promise<DebugEvaluation>
    stackTrace(threadId: number): Promise<DebugFrame[]>
    scopes(frameId: number): Promise<DebugScope[]>
    variables(ref: number): Promise<DebugVariable[]>
    modules(): Promise<DebugModule[]>
    loadedSources(): Promise<DebugLoadedSource[]>
    stop(): Promise<void>
    onEvent(cb: (event: DebugEvent) => void): () => void
  }
  /** Cộng tác trong LAN (WebSocket ngang hàng): chia sẻ một tệp đang mở, người khác nối bằng địa chỉ + mã. */
  collab?: {
    host(hello: CollabHello): Promise<{ addresses: string[]; port: number; code: string }>
    join(address: string, code: string): Promise<CollabHello>
    send(data: Uint8Array): Promise<void>
    stop(): Promise<void>
    onEvent(cb: (event: CollabEvent) => void): () => void
  }
  /** Extension cài từ thư mục vào thư mục dữ liệu app. */
  extensions?: {
    list(): Promise<{ extensions: ExtensionInfo[]; errors: { folder: string; message: string }[] }>
    /** Mở hộp thoại chọn thư mục extension rồi cài; `null` khi huỷ. */
    install(): Promise<ExtensionInfo | null>
    remove(id: string): Promise<void>
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
    status(projectId: string): Promise<'no_git' | 'off' | 'on' | 'outdated' | 'outside_repo'>
    preview(projectId: string): Promise<string>
    install(projectId: string): Promise<void>
    uninstall(projectId: string): Promise<void>
    /** Nhánh git đang checkout, `null` khi không có. */
    branch(projectId: string): Promise<string | null>
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
    /** Hồ sơ trợ lý: tắt bớt tool cho dự án (rỗng = bật hết theo chế độ). */
    setDisabledTools?(projectId: string, tools: string[]): Promise<void>
    getDisabledTools?(projectId: string): Promise<string[]>
    /** Mọi tool NexGraph cho trợ lý. */
    toolNames?(): Promise<string[]>
    approve(projectId: string, id: string, allow: boolean): Promise<void>
    /** Rời dự án: từ chối yêu cầu đang chờ, huỷ phiên. */
    close(projectId: string): Promise<void>
    snapshot(projectId: string): Promise<AgentSessionSnapshot>
    listSessions(projectId: string): Promise<AgentSessionInfo[]>
    newSession(projectId: string): Promise<AgentSessionSnapshot>
    forkSession(projectId: string, sessionId: string): Promise<AgentSessionSnapshot>
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
    /** Thông báo hệ thống; bấm vào thì đưa cửa sổ lên. Renderer tự quyết định có gửi hay không (cửa sổ không focus, đúng cài đặt). Vắng ở host không có thông báo. */
    notify?(title: string, body: string): Promise<void>
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
  /** Bộ nhớ làm việc (W10): đánh giá câu trả lời, Bài học, Memory neo vào node. Ghi bị từ chối (`index_running`) khi đang index. */
  memory: {
    recall(projectId: string, q: { node?: string; q?: string }): Promise<MemoryRecall>
    add(projectId: string, kind: MemoryKind, text: string, nodeIds: string[]): Promise<{ id: number; created: boolean }>
    /** Engine đổi trích dẫn tệp:dòng sang node. */
    rate(projectId: string, rating: AnswerRating): Promise<{ id: number; node_ids: string[] }>
    lessons(projectId: string): Promise<Lessons>
  }
  /** Graph chung nhiều repo (W8). Thêm/gỡ chạy lại job nối cạnh liên repo; theo dõi bằng `index.status`. */
  globalGraph: {
    list(): Promise<GlobalMember[]>
    add(projectId: string): Promise<{ jobId: string }>
    remove(projectId: string): Promise<void>
    /** `projectIds` rỗng hoặc vắng: mọi dự án trong graph chung. */
    search(q: string, limit?: number, projectIds?: string[]): Promise<GlobalSearchHit[]>
    graph(projectIds: string[], limit?: number): Promise<GlobalGraph>
    /** Hộp thoại chọn thư mục ở main rồi ghi graph.json gộp; `null` khi huỷ. */
    export(projectIds: string[]): Promise<GlobalExportResult | null>
  }
  /** Pull request của GitHub qua `gh` (W7), chỉ đọc. Lỗi có `code`: `gh_missing` | `gh_auth` | `not_github` | `gh_timeout` | `gh_failed` | `pr_not_found`. */
  prs: {
    /** Tab Pull request chỉ hiện khi `available`. */
    status(projectId: string): Promise<PrAvailability>
    list(projectId: string): Promise<PrList>
    detail(projectId: string, prNumber: number): Promise<PrDetail>
  }
  /** Phân tích ngữ nghĩa bằng AI (W9). Tiến độ job theo dõi bằng `index.status`. */
  semantic: {
    getSettings(projectId: string): Promise<ProjectAiSettings>
    setSettings(projectId: string, settings: ProjectAiSettings): Promise<ProjectAiSettings>
    estimate(projectId: string, target: SemanticTarget, noCache?: boolean): Promise<SemanticEstimate>
    /** Main chọn đường theo cấu hình dự án. Đường A: main tự kéo khối và gọi model đang chọn. Đường B: main gửi key xuống engine. */
    start(projectId: string, target: SemanticTarget, budget?: number, noCache?: boolean): Promise<{ jobId: string }>
    cancel(jobId: string): Promise<void>
  }
}
