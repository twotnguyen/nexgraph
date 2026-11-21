// Hình dạng JSON v1 của engine (xem roadmap, "Hình dạng JSON v1"). Đổi ở đây thì đổi cả engine/api/serialize.py.
export type NodeKind =
  | 'repository' | 'package' | 'directory' | 'file' | 'module' | 'class' | 'mixin' | 'enum' | 'extension'
  | 'function' | 'method' | 'test' | 'widget' | 'screen' | 'route' | 'document' | 'concept'
  | 'type' | 'variable' | 'table' | 'resource' | 'config_key'

export interface GraphNode {
  id: string
  kind: NodeKind
  label: string
  qualified_name: string
  language: string | null
  file: string | null
  line_start: number | null
  line_end: number | null
  is_test: boolean
  origin: string
  signature: string | null
  community: null
}

export interface Evidence {
  file: string | null
  line: number
  col: number | null
}

export interface GraphEdge {
  id: number
  source: string
  target: string
  type: string
  subtype: string | null
  confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'
  confidence_score: number
  origin: string
  evidence: Evidence | null
}

export interface Neighborhood {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
  total?: number | null
}

export interface NeighborQuery {
  node: string
  types?: string[]
  direction?: 'in' | 'out' | 'both'
  depth?: number
  limit?: number
}

/** `running`: job tổng quát (clone, ingest…) của `JobManager.start_task`. */
export type JobState = 'queued' | 'structure' | 'resolve' | 'running' | 'waiting_llm' | 'done' | 'error' | 'cancelled'

export interface Job {
  job_id: string
  /** `null` với job không gắn dự án (clone). */
  project_id: string | null
  state: JobState
  files_done: number
  files_total: number
  message: string | null
  /** `index` | `clone` | `ingest` | … */
  kind?: string
  result?: Record<string, unknown> | null
}

/** Nguồn tải từ URL của một dự án (`<data_dir>/sources/<pid>/`), trong graph là `file`. */
export interface SourceItem {
  name: string
  file: string
  size: number
  added_at: number
  url: string | null
}

export interface ProjectSummary {
  project_id: string
  path: string
  name: string
  storage: 'in_project' | 'app_dir'
  is_git?: boolean
  last_indexed_at?: number | null
  last_index_commit?: string | null
}

export interface CodeSlice {
  file: string
  start: number
  end: number
  text: string
  language: string | null
  stale: boolean
}

export interface GraphStats {
  files: number
  nodes_by_kind: Record<string, number>
  edges_by_type: Record<string, number>
  languages: Record<string, number>
  unresolved: number
  indexed_at?: number | null
  index_commit?: string | null
  head_commit?: string | null
  changed_files?: number | null
  stale?: boolean
  generic_languages?: string[]
}

export interface SearchHit {
  node: GraphNode
  score: number
}

export type BlockKind = 'directory' | 'community' | 'file' | 'group'

export interface ArchBlock {
  id: string
  label: string
  kind: BlockKind
  size: number
  symbols: number
  drillable: boolean
}

export interface ArchLink {
  from: string
  to: string
  count: number
  types: Record<string, number>
}

export interface ArchView {
  parent: { id: string; label: string } | null
  blocks: ArchBlock[]
  links: ArchLink[]
}

export interface ArchEvidence {
  edge: GraphEdge
  file: string
  line: number
}

export interface ScanInfo {
  files: number
  by_language: Record<string, number>
  large: boolean
  threshold: number
  top_dirs: { path: string; files: number }[]
}

export type ChangeStatus = 'M' | 'A' | 'D' | 'R'

export interface ChangedFile {
  path: string
  status: ChangeStatus
  old_path: string | null
}

export interface ImpactedNode {
  node: GraphNode
  score: number
  hops: number
}

/** Kết quả `GET /changes`: vùng đổi, vùng ảnh hưởng, test liên quan và test gap (xem roadmap). */
export interface Changes {
  base: 'git_head' | 'last_index'
  base_commit: string | null
  note: string | null
  changed_files: ChangedFile[]
  changed_nodes: GraphNode[]
  impacted: ImpactedNode[]
  tests: GraphNode[]
  test_gaps: GraphNode[]
  truncated: boolean
}

export interface RefreshResult {
  status: 'ok' | 'skipped'
  reason: 'index_running' | 'refresh_running' | 'not_indexed' | null
  added: number
  changed: number
  removed: number
  seconds: number
}

export type EngineEvent =
  | ({ type: 'job_progress' } & Job)
  | { type: 'graph_updated'; project_id: string }
  | { type: 'changes_updated'; project_id: string }

// --- F10 đợt 1: báo cáo, truy vấn, export (hình dạng JSON của engine) ---------------------------

export interface ReportCommunity {
  id: string
  label: string
  size: number
  cohesion: number
}

/** `GET /report`: surprising/questions mang nhãn (Graphify chỉ trả nhãn, không trả id nút). */
/** Thẻ "Giải thích": cạnh vào/ra theo loại, tối đa `limit` node mỗi nhóm, phần còn lại đếm theo tệp. */
export interface ExplainGroup {
  direction: 'in' | 'out'
  type: string
  total: number
  nodes: GraphNode[]
  more_by_file: { file: string | null; count: number }[]
}

export interface NodeExplain {
  node: GraphNode
  degree: number
  community: { id: string; label: string } | null
  groups: ExplainGroup[]
}

/** Thân một mục tài liệu (đã che secret). */
export interface DocSection {
  node: GraphNode
  file: string
  start: number
  end: number
  text: string
  truncated: boolean
  stale: boolean
}

export interface GraphFreshness {
  indexed_at: number | null
  index_commit: string | null
  head_commit: string | null
  changed_files: number | null
  stale: boolean
}

export interface GraphReport {
  god_nodes: { node: GraphNode; degree: number }[]
  communities: ReportCommunity[]
  surprising: { source: string; target: string; source_files: string[]; relation: string; why: string }[]
  questions: { question: string; why: string }[]
  benchmark: { corpus_tokens: number; graph_tokens: number; reduction: number } | null
  truncated: boolean
  cycles: ImportCycles
  freshness: GraphFreshness
  /** Lỗ hổng tri thức: node cô lập (không có cạnh ngoài cấu trúc chứa) và cạnh AMBIGUOUS. */
  gaps: { isolated: { total: number; nodes: GraphNode[] }; ambiguous_edges: { total: number; edges: GraphEdge[] } }
}

/** Độ tin cậy của đường đi = hop yếu nhất; score null khi EXTRACTED. */
export interface PathConfidence {
  level: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'
  score: number | null
  hop: number
}

export interface PathResult {
  nodes: GraphNode[]
  edges: GraphEdge[]
  unconnected: string[]
  confidence?: PathConfidence | null
}

export interface NodeImpact {
  node: GraphNode
  impacted: ImpactedNode[]
  tests: GraphNode[]
  truncated: boolean
}

export interface AskResult {
  seeds: GraphNode[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  flows?: FlowSummary[]
  truncated: boolean
  /** Câu hỏi là đúng tên của nhiều node ở nhiều tệp: engine không chọn bừa, trả mỗi tệp một ứng viên. */
  ambiguous?: GraphNode[]
}

export interface TourStep {
  order: number
  kind: 'entry' | 'flow' | 'community' | 'hub' | 'tests'
  title: string
  body: string
  node: GraphNode | null
  flow_id: number | null
  block_id: string | null
}

export interface MapNode { id: string; label: string; kind: 'directory' | 'file'; files: number; symbols: number; community: number | null; drillable: boolean }
export interface MapEdge { source: string; target: string; weight: number; types: Record<string, number> }
export interface ProjectMap { parent: { id: string; label: string } | null; nodes: MapNode[]; edges: MapEdge[]; truncated: boolean; totals: { files: number; nodes: number } }
export interface ImportCycles { cycles: { files: string[]; size: number }[]; total: number }

export type FlowKind = 'main' | 'route' | 'cli' | 'event' | 'root'

export interface FlowSummary {
  id: number
  name: string
  kind: FlowKind
  detail: string | null
  entry: GraphNode
  steps: number
  files: number
  depth: number
  criticality: number
  truncated: boolean
}

export interface FlowStep {
  order: number
  depth: number
  node: GraphNode
  caller: string | null
  line: number | null
}

export interface FlowList {
  flows: FlowSummary[]
  total: number
  truncated: boolean
}

export interface FlowDetail {
  flow: FlowSummary
  steps: FlowStep[]
}

export interface FlowQuery {
  q?: string
  kind?: FlowKind
  node?: string
  limit?: number
  offset?: number
}

export type ExportFormat = 'html' | 'callflow_html' | 'obsidian' | 'wiki' | 'svg' | 'graphml' | 'cypher' | 'json' | 'markdown'

export type ExportScope = { kind: 'all' } | { kind: 'community'; value: string } | { kind: 'node'; value: string }

export interface ExportResult {
  files: string[]
  truncated: boolean
}

export interface PushRequest {
  target: 'neo4j' | 'falkordb'
  uri: string
  user?: string
  password?: string
  scope: ExportScope
}

export interface PushResult {
  nodes: number
  edges: number
  truncated: boolean
}

/** Tuỳ chọn lập chỉ mục đầy đủ (F10, W2): mẫu bỏ qua, tài liệu, audio/video, tệp cấu hình, số tiến trình, index lại từ đầu. */
export interface IndexOptions {
  subdir?: string
  exclude?: string[]
  includeDocs?: boolean
  includeMedia?: boolean
  includeConfig?: boolean
  workers?: number
  force?: boolean
  /** Nguồn bổ sung (W11). DSN PostgreSQL không đi qua đây: main giữ trong kho khoá và tự gắn vào request. */
  sources?: IndexSources
}

export interface IndexSources {
  postgres?: boolean
  cargo?: boolean
  manifests?: boolean
  scipFiles?: string[]
  mcpFiles?: string[]
}

export interface AiSettings {
  runtime?: 'pi' | 'antigravity-cli'
  baseUrl: string
  model: string
  hasKey: boolean
  provider?: string
  accountId?: string
  connectionId?: string
}
export interface Citation { raw: string; file: string; start: number; end: number; valid: boolean; reason: null | 'file_not_found' | 'out_of_range' }
export interface ContextItem { node: GraphNode; score: number; reasons: string[]; code: { file: string; start: number; end: number; text: string } | null }
export interface ContextPack { items: ContextItem[]; flows: FlowSummary[]; tokens: number; truncated: boolean }

/** Bộ nhớ làm việc (W10). `kind` và `outcome` giữ đúng giá trị trong CSDL. */
export type MemoryKind = 'lesson' | 'decision' | 'incident' | 'owner'
export type RatingOutcome = 'huu_ich' | 'ngo_cut' | 'da_sua'
export interface MemoryItem {
  id: number; kind: MemoryKind | 'danh_gia'; text: string; node_ids: string[]; missing_node_ids: string[]
  outcome: RatingOutcome | null; created_at: number; source: 'nguoi_dung' | 'tro_ly' | 'mcp'
  question?: string; answer?: string; correction?: string
}
export interface LessonEntry { node: string; score: number; n?: number; pos?: number; neg?: number; verdict?: 'useful' | 'dead end' | 'even'; last?: string }
export interface MemoryRecall {
  memories: MemoryItem[]
  node_id?: string; node_exists?: boolean
  lesson?: (LessonEntry & { status: 'preferred' | 'tentative' | 'contested' }) | null
}
export interface Lessons {
  total: number; min_corroboration: number
  counts: { useful: number; dead_end: number; corrected: number; unmarked: number }
  preferred: LessonEntry[]; tentative: LessonEntry[]; contested: LessonEntry[]
  dead_ends: { question: string; nodes: string[]; date: string }[]
  corrections: { question: string; correction: string; date: string }[]
  labels: Record<string, string>
}
export interface AnswerRating { question: string; answer: string; outcome: RatingOutcome; correction?: string; citations: { file: string; line: number }[] }

/** Graph chung nhiều repo (W8). */
export interface GlobalMember {
  project_id: string
  /** `null` khi dự án đã bị gỡ khỏi ứng dụng. */
  name: string | null
  path: string | null
  added_at: number
  /** `false` khi dự án đã gỡ, mất thư mục hoặc chưa có đồ thị: bị bỏ qua khi tìm và xem chung. */
  available: boolean
}

export interface GlobalSearchHit extends SearchHit {
  project_id: string
  project_name: string
}

export interface GlobalGraph {
  projects: { project_id: string; name: string }[]
  /** Id nút dạng `<project_id>::<id nút>`. */
  nodes: (GraphNode & { project_id: string })[]
  edges: (GraphEdge & { cross_repo?: boolean })[]
  truncated: boolean
  skipped: string[]
}

export interface GlobalExportResult {
  files: string[]
  nodes: number
  edges: number
  truncated: boolean
  skipped: string[]
}

/** Pull request của GitHub (W7). Nhãn theo thứ tự ưu tiên của bộ phân loại. */
export type PrStatusLabel = 'WRONG-BASE' | 'CI-FAIL' | 'CHANGES-REQ' | 'DRAFT' | 'STALE' | 'PENDING' | 'APPROVED' | 'READY'
export interface PrAvailability { available: boolean; reason: 'gh_missing' | 'gh_auth' | 'not_github' | 'gh_timeout' | 'gh_failed' | null; repo: string | null; default_branch: string | null }
export interface PrInfo {
  number: number; title: string; branch: string; base: string; author: string; draft: boolean
  review: string | null; ci: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NONE'; updated_at: string; days_old: number
  status: PrStatusLabel; url: string | null
}
export interface PrListItem extends PrInfo { files: string[]; nodes_affected: number }
export interface PrConflict { a: number; b: number; files: string[]; nodes: number }
export interface PrList { repo: string | null; default_branch: string; base: string; prs: PrListItem[]; conflicts: PrConflict[]; truncated: boolean }
export interface PrDetail {
  pr: PrInfo
  changed_files: { path: string; status: 'M' | 'A' | 'D' | 'R'; old_path: string | null }[]
  changed_nodes: GraphNode[]
  impacted: ImpactedNode[]
  tests: GraphNode[]
  test_gaps: GraphNode[]
  stale_docs: { node: GraphNode; symbols: string[] }[]
  unreferenced: { node: GraphNode; heuristic: true }[]
  test_selection: { files: string[]; commands: string[]; run_all: boolean; reasons: string[] }
  /** Tác động sang repo khác khi dự án nằm trong graph chung; `null` khi chưa có. */
  cross_repo: unknown | null
  comment: string
  truncated: boolean
}

// ----- Phân tích ngữ nghĩa bằng AI (W9) -----
export type SemanticTarget = 'docs' | 'images' | 'deep' | 'labels' | 'dedup' | 'pr_triage'
/** Cấu hình AI theo dự án (engine `ai_theo_du_an`): mặc định tắt. `app` = đường A, `direct` = đường B. */
export interface ProjectAiSettings { enabled: boolean; transport: 'direct' | 'app' | null; model: string | null }
export interface SemanticEstimate {
  files: string[]; chunks: number; cached_chunks: number; input_tokens: number; output_tokens: number
  /** Model sẽ dùng thật nếu chạy bây giờ (`provider / model`), do main điền; `null` khi chưa chọn model. */
  model?: string | null
}
export interface SemanticResult {
  target: SemanticTarget
  nodes_added: number
  edges_added: number
  labels: Record<string, string>
  merged: number
  triage: { number: number; priority: number; action: string }[] | null
  errors: { chunk_id: string; files: string[]; message: string }[]
  usage: { input_tokens: number; output_tokens: number }
  chunks: { total: number; cached: number; sent: number; done: number; failed: number; skipped_budget: number }
}
