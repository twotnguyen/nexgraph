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

export type JobState = 'queued' | 'structure' | 'resolve' | 'done' | 'error' | 'cancelled'

export interface Job {
  job_id: string
  project_id: string
  state: JobState
  files_done: number
  files_total: number
  message: string | null
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
export interface GraphReport {
  god_nodes: { node: GraphNode; degree: number }[]
  communities: ReportCommunity[]
  surprising: { source: string; target: string; source_files: string[]; relation: string; why: string }[]
  questions: { question: string; why: string }[]
  benchmark: { corpus_tokens: number; graph_tokens: number; reduction: number } | null
  truncated: boolean
}

export interface PathResult {
  nodes: GraphNode[]
  edges: GraphEdge[]
  unconnected: string[]
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

/** Tuỳ chọn lập chỉ mục đầy đủ (F10): mẫu bỏ qua, gồm tài liệu, gồm audio/video. */
export interface IndexOptions {
  subdir?: string
  exclude?: string[]
  includeDocs?: boolean
  includeMedia?: boolean
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
