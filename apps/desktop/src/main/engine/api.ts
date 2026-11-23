import type {
  IndexOptions,
  ArchEvidence, ArchView, AskResult, Changes, CodeSlice, ExportFormat, ExportResult, ExportScope,
  ContextPack, TourStep, FlowDetail, FlowList, FlowQuery, ImportCycles, ProjectMap,
  DocSection, GraphNode, GraphReport, GraphStats, Job, NodeExplain,
  NeighborQuery, Neighborhood, NodeImpact, PathResult, ProjectSummary, PushRequest, PushResult, RefreshResult, ScanInfo, SearchHit,
  SourceItem, ProjectAiSettings, SemanticEstimate, SemanticTarget
} from '../../shared/graph-types'
import type { AnswerRating, Lessons, MemoryKind, MemoryRecall } from '../../shared/graph-types'
import type { GlobalExportResult, GlobalGraph, GlobalMember, GlobalSearchHit } from '../../shared/graph-types'
import type { PrAvailability, PrDetail, PrList } from '../../shared/graph-types'
import type { LlmChunk } from '../ai/semantic-runner'
import type { EngineHandle } from './launcher'

export class EngineApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly jobId?: string
  ) {
    super(message)
    this.name = 'EngineApiError'
  }
}

type Target = Pick<EngineHandle, 'baseUrl' | 'token'>

/** `?lang=` chỉ có khi renderer truyền ngôn ngữ UI; không truyền thì engine giữ mặc định cũ. */
const langQuery = (lang?: 'vi' | 'en'): string => lang ? `?${new URLSearchParams({ lang })}` : ''

export class EngineApi {
  constructor(private readonly h: Target, private readonly modelAudience = false) {}

  forModel(): EngineApi {
    return new EngineApi(this.h, true)
  }

  private async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.h.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.h.token}`,
        ...(this.modelAudience ? { 'X-NexGraph-Audience': 'model' } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    }).catch((error: unknown) => {
      if (signal?.aborted) throw new EngineApiError(504, 'engine_timeout', 'Engine không phản hồi kịp. Hãy thử lại.')
      if (error instanceof TypeError) throw new EngineApiError(503, 'engine_unavailable', 'Không kết nối được engine.')
      throw error
    })
    if (!res.ok) {
      let code = 'http_error'
      let message = `Engine trả về ${res.status} cho ${path}`
      let jobId: string | undefined
      try {
        const e = (await res.json()) as { error?: { code?: string; message?: string; job_id?: string } }
        code = e.error?.code ?? code
        message = e.error?.message ?? message
        if (typeof e.error?.job_id === 'string') jobId = e.error.job_id
      } catch {
        /* thân không phải JSON */
      }
      throw new EngineApiError(res.status, code, message, jobId)
    }
    return (await res.json()) as T
  }

  openProject(path: string): Promise<ProjectSummary> {
    return this.request('POST', '/v1/projects', { path }, AbortSignal.timeout(15_000))
  }
  listProjects(): Promise<ProjectSummary[]> {
    return this.request('GET', '/v1/projects', undefined, AbortSignal.timeout(15_000))
  }
  async removeProject(pid: string): Promise<void> {
    await this.request('DELETE', `/v1/projects/${encodeURIComponent(pid)}`, undefined, AbortSignal.timeout(15_000))
  }
  /** `postgresDsn` chỉ do main đọc từ kho khoá (W11); renderer không bao giờ thấy nó. */
  startIndex(pid: string, o?: IndexOptions, postgresDsn?: string): Promise<{ job_id: string }> {
    const s = o?.sources
    const body = {
      ...(o?.subdir ? { subdir: o.subdir } : {}), ...(o?.exclude?.length ? { exclude: o.exclude } : {}),
      // Không gửi cờ = engine giữ tuỳ chọn lần trước; false là tắt tường minh.
      ...(o?.includeDocs !== undefined ? { include_docs: o.includeDocs } : {}),
      ...(o?.includeMedia !== undefined ? { include_media: o.includeMedia } : {}),
      ...(o?.includeConfig !== undefined ? { include_config: o.includeConfig } : {}),
      ...(o?.workers ? { workers: o.workers } : {}), ...(o?.force ? { force: true } : {}),
      ...(s ? { sources: { cargo: !!s.cargo, manifests: !!s.manifests, scip_files: s.scipFiles ?? [], mcp_files: s.mcpFiles ?? [],
        ...(s.postgres && postgresDsn ? { postgres_dsn: postgresDsn } : {}) } } : {})
    }
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/index`, Object.keys(body).length ? body : undefined,
      AbortSignal.timeout(15_000))
  }
  scan(pid: string): Promise<ScanInfo> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/scan`, undefined, AbortSignal.timeout(20_000))
  }
  async aiSourceExcludes(pid: string): Promise<string[]> {
    try {
      const result = await this.request<{ exclude: string[] }>('GET', `/v1/projects/${encodeURIComponent(pid)}/ai/source-scope`,
        undefined, AbortSignal.timeout(5_000))
      return result.exclude
    } catch (error) {
      if (error instanceof EngineApiError && (error.code === 'not_indexed' || error.code === 'index_running')) return []
      throw error
    }
  }
  search(pid: string, q: string, o?: { kinds?: string[]; limit?: number }): Promise<SearchHit[]> {
    const p = new URLSearchParams({ q })
    if (o?.kinds?.length) p.set('kinds', o.kinds.join(','))
    if (o?.limit !== undefined) p.set('limit', String(o.limit))
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/search?${p}`)
  }
  architecture(pid: string, parent?: string): Promise<ArchView> {
    const qs = parent ? `?${new URLSearchParams({ parent })}` : ''
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/architecture${qs}`)
  }
  archEvidence(pid: string, from: string, to: string, limit?: number): Promise<ArchEvidence[]> {
    const p = new URLSearchParams({ from, to })
    if (limit !== undefined) p.set('limit', String(limit))
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/architecture/evidence?${p}`)
  }
  refresh(pid: string): Promise<RefreshResult> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/refresh`)
  }
  changes(pid: string, o?: { refresh?: boolean }): Promise<Changes> {
    const qs = o?.refresh === false ? '?refresh=false' : ''
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/changes${qs}`)
  }
  getJob(id: string): Promise<Job> {
    return this.request('GET', `/v1/jobs/${encodeURIComponent(id)}`, undefined, AbortSignal.timeout(5_000))
  }
  cancelJob(id: string): Promise<{ cancelled: boolean }> {
    return this.request('DELETE', `/v1/jobs/${encodeURIComponent(id)}`, undefined, AbortSignal.timeout(5_000))
  }
  stats(pid: string): Promise<GraphStats> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/stats`, undefined, AbortSignal.timeout(20_000))
  }
  getNode(pid: string, id: string): Promise<GraphNode> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/nodes/${encodeURIComponent(id)}`)
  }
  neighbors(pid: string, q: NeighborQuery): Promise<Neighborhood> {
    const p = new URLSearchParams({ node: q.node })
    if (q.types?.length) p.set('types', q.types.join(','))
    if (q.direction) p.set('direction', q.direction)
    if (q.depth !== undefined) p.set('depth', String(q.depth))
    if (q.limit !== undefined) p.set('limit', String(q.limit))
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/neighbors?${p}`)
  }
  code(pid: string, file: string, start?: number, end?: number): Promise<CodeSlice> {
    const p = new URLSearchParams({ file })
    if (start !== undefined) p.set('start', String(start))
    if (end !== undefined) p.set('end', String(end))
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/code?${p}`)
  }
  explain(pid: string, nodeId: string): Promise<NodeExplain> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/explain?${new URLSearchParams({ node: nodeId })}`)
  }
  section(pid: string, nodeId: string): Promise<DocSection> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/section?${new URLSearchParams({ node: nodeId })}`)
  }
  /** Công cụ ngoài có trên máy (ffmpeg, faster-whisper, git, gh, yt-dlp). */
  tools(): Promise<Record<string, boolean>> {
    return this.request('GET', '/v1/tools')
  }
  report(pid: string, lang?: 'vi' | 'en'): Promise<GraphReport> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/report${langQuery(lang)}`)
  }
  paths(pid: string, nodeIds: string[], o?: { maxHops?: number; directed?: boolean }): Promise<PathResult> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/paths`, {
      node_ids: nodeIds,
      ...(o?.maxHops !== undefined ? { max_hops: o.maxHops } : {}),
      ...(o?.directed !== undefined ? { directed: o.directed } : {})
    })
  }
  impactOf(pid: string, nodeId: string): Promise<NodeImpact> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/impact?${new URLSearchParams({ node: nodeId })}`)
  }
  ask(pid: string, question: string, o?: { depth?: number; budget?: number; mode?: 'bfs' | 'dfs' }): Promise<AskResult> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/ask`, { question, ...o })
  }
  recluster(pid: string): Promise<{ communities: number }> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/communities`)
  }
  flows(pid: string, opts?: FlowQuery): Promise<FlowList> {
    const params = new URLSearchParams()
    if (opts?.q) params.set('q', opts.q)
    if (opts?.kind) params.set('kind', opts.kind)
    if (opts?.node) params.set('node', opts.node)
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    if (opts?.offset != null) params.set('offset', String(opts.offset))
    const q = params.toString()
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/flows${q ? `?${q}` : ''}`)
  }
  flow(pid: string, flowId: number): Promise<FlowDetail> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/flows/${flowId}`)
  }
  tour(pid: string, lang?: 'vi' | 'en'): Promise<{ steps: TourStep[] }> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/tour${langQuery(lang)}`)
  }
  locate(pid: string, file: string, line: number): Promise<{ node: GraphNode }> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/locate?${new URLSearchParams({ file, line: String(line) })}`)
  }
  context(pid: string, question: string, budget?: number): Promise<ContextPack> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/context`, { question, ...(budget != null ? { budget } : {}) })
  }
  map(pid: string, o?: { parent?: string; detail?: number }): Promise<ProjectMap> {
    const params = new URLSearchParams()
    if (o?.parent) params.set('parent', o.parent)
    if (o?.detail != null) params.set('detail', String(o.detail))
    const q = params.toString()
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/map${q ? `?${q}` : ''}`)
  }
  cycles(pid: string, limit?: number): Promise<ImportCycles> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/cycles${limit != null ? `?limit=${limit}` : ''}`)
  }
  exportGraph(pid: string, format: ExportFormat, scope: ExportScope, outDir: string, lang?: 'vi' | 'en'): Promise<ExportResult> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/export`,
      { format, scope, out_dir: outDir, ...(lang ? { lang } : {}) })
  }
  pushGraph(pid: string, req: PushRequest): Promise<PushResult> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/export/push`, req)
  }
  cloneProject(url: string): Promise<{ job_id: string }> {
    return this.request('POST', '/v1/projects/clone', { url }, AbortSignal.timeout(15_000))
  }
  listSources(pid: string): Promise<SourceItem[]> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/sources`, undefined, AbortSignal.timeout(15_000))
  }
  addSource(pid: string, url: string): Promise<{ job_id: string }> {
    // Route kiểm URL (có phân giải DNS) trước khi tạo job.
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/sources`, { url }, AbortSignal.timeout(20_000))
  }
  async removeSource(pid: string, name: string): Promise<void> {
    await this.request('DELETE', `/v1/projects/${encodeURIComponent(pid)}/sources?${new URLSearchParams({ name })}`)
  }
  recallMemory(pid: string, q: { node?: string; q?: string }): Promise<MemoryRecall> {
    const params = new URLSearchParams()
    if (q.node) params.set('node', q.node)
    if (q.q) params.set('q', q.q)
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/memory?${params}`)
  }
  addMemory(pid: string, kind: MemoryKind, text: string, nodeIds: string[]): Promise<{ id: number; created: boolean }> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/memory`, { kind, text, node_ids: nodeIds })
  }
  rateAnswer(pid: string, r: AnswerRating): Promise<{ id: number; node_ids: string[] }> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/memory/ratings`, r)
  }
  lessons(pid: string): Promise<Lessons> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/lessons`)
  }
  // Graph chung nhiều repo (W8)
  globalList(): Promise<GlobalMember[]> {
    return this.request('GET', '/v1/global/projects')
  }
  globalAdd(pid: string): Promise<{ project_id: string; job_id: string }> {
    return this.request('POST', '/v1/global/projects', { project_id: pid })
  }
  async globalRemove(pid: string): Promise<void> {
    await this.request('DELETE', `/v1/global/projects/${encodeURIComponent(pid)}`)
  }
  globalSearch(q: string, limit?: number, pids?: string[]): Promise<GlobalSearchHit[]> {
    const params = new URLSearchParams({ q })
    if (limit != null) params.set('limit', String(limit))
    if (pids?.length) params.set('projects', pids.join(','))
    return this.request('GET', `/v1/global/search?${params}`)
  }
  globalGraph(pids: string[], limit?: number): Promise<GlobalGraph> {
    const params = new URLSearchParams({ projects: pids.join(',') })
    if (limit != null) params.set('limit', String(limit))
    return this.request('GET', `/v1/global/graph?${params}`, undefined, AbortSignal.timeout(60_000))
  }
  globalExport(pids: string[], outDir: string): Promise<GlobalExportResult> {
    return this.request('POST', '/v1/global/export', { out_dir: outDir, projects: pids }, AbortSignal.timeout(120_000))
  }
  // Mỗi lời gọi `gh` trong engine có timeout 30 s; danh sách gồm `repo view` + `pr list`, chi tiết thêm `pr view` + `pr diff`.
  prStatus(pid: string): Promise<PrAvailability> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/prs/status`, undefined, AbortSignal.timeout(40_000))
  }
  listPrs(pid: string): Promise<PrList> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/prs`, undefined, AbortSignal.timeout(75_000))
  }
  async prDetail(pid: string, n: number): Promise<PrDetail> {
    if (!Number.isSafeInteger(n) || n < 1) throw new EngineApiError(400, 'bad_param', 'Số pull request không hợp lệ')
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/prs/${n}`, undefined, AbortSignal.timeout(100_000))
  }
  // ----- Phân tích ngữ nghĩa (W9) -----
  aiSettings(pid: string): Promise<ProjectAiSettings> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/ai`, undefined, AbortSignal.timeout(15_000))
  }
  setAiSettings(pid: string, s: ProjectAiSettings): Promise<ProjectAiSettings> {
    return this.request('PUT', `/v1/projects/${encodeURIComponent(pid)}/ai`, s, AbortSignal.timeout(15_000))
  }
  semanticEstimate(pid: string, target: SemanticTarget, noCache = false): Promise<SemanticEstimate> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/semantic/estimate`, { targets: target, no_cache: noCache }, AbortSignal.timeout(60_000))
  }
  /** `transport.api_key` (đường B) chỉ do main đọc từ kho khoá; renderer không bao giờ thấy nó. */
  startSemantic(pid: string, body: { targets: SemanticTarget; transport: { kind: 'app'; model_label: string } | { kind: 'direct'; base_url: string; api_key: string; model: string }; max_tokens_budget?: number; prs?: unknown[]; no_cache?: boolean }): Promise<{ job_id: string }> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/semantic`, body, AbortSignal.timeout(15_000))
  }
  async llmNext(jobId: string): Promise<LlmChunk | null> {
    const res = await fetch(`${this.h.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}/llm/next`, {
      headers: { Authorization: `Bearer ${this.h.token}` }, signal: AbortSignal.timeout(15_000)
    })
    if (res.status === 204) return null
    if (!res.ok) throw new EngineApiError(res.status, 'http_error', `Engine trả về ${res.status} khi lấy khối AI`)
    return (await res.json()) as LlmChunk
  }
  async llmAnswer(jobId: string, chunkId: string, body: { text: string } | { error: string }): Promise<void> {
    await this.request('POST', `/v1/jobs/${encodeURIComponent(jobId)}/llm/${encodeURIComponent(chunkId)}`, body, AbortSignal.timeout(30_000))
  }
}
