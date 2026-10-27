// Hình dạng JSON v1 của engine (xem roadmap, "Hình dạng JSON v1"). Đổi ở đây thì đổi cả engine/api/serialize.py.
export type NodeKind =
  | 'repository' | 'package' | 'directory' | 'file' | 'module' | 'class' | 'mixin' | 'enum' | 'extension'
  | 'function' | 'method' | 'test' | 'widget' | 'screen' | 'route' | 'document' | 'concept'

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
