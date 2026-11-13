import type {
  IndexOptions,
  ArchEvidence, ArchView, AskResult, Changes, CodeSlice, ExportFormat, ExportResult, ExportScope, GraphNode, GraphReport, GraphStats, Job,
  NeighborQuery, Neighborhood, NodeImpact, PathResult, ProjectSummary, PushRequest, PushResult, RefreshResult, ScanInfo, SearchHit
} from '../../shared/graph-types'
import type { EngineHandle } from './launcher'

export class EngineApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'EngineApiError'
  }
}

type Target = Pick<EngineHandle, 'baseUrl' | 'token'>

export class EngineApi {
  constructor(private readonly h: Target) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.h.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.h.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (!res.ok) {
      let code = 'http_error'
      let message = `Engine trả về ${res.status} cho ${path}`
      try {
        const e = (await res.json()) as { error?: { code?: string; message?: string } }
        code = e.error?.code ?? code
        message = e.error?.message ?? message
      } catch {
        /* thân không phải JSON */
      }
      throw new EngineApiError(res.status, code, message)
    }
    return (await res.json()) as T
  }

  openProject(path: string): Promise<ProjectSummary> {
    return this.request('POST', '/v1/projects', { path })
  }
  listProjects(): Promise<ProjectSummary[]> {
    return this.request('GET', '/v1/projects')
  }
  startIndex(pid: string, o?: IndexOptions): Promise<{ job_id: string }> {
    const body = {
      ...(o?.subdir ? { subdir: o.subdir } : {}), ...(o?.exclude?.length ? { exclude: o.exclude } : {}),
      ...(o?.includeDocs ? { include_docs: true } : {}), ...(o?.includeMedia ? { include_media: true } : {})
    }
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/index`, Object.keys(body).length ? body : undefined)
  }
  scan(pid: string): Promise<ScanInfo> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/scan`)
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
    return this.request('GET', `/v1/jobs/${encodeURIComponent(id)}`)
  }
  cancelJob(id: string): Promise<{ cancelled: boolean }> {
    return this.request('DELETE', `/v1/jobs/${encodeURIComponent(id)}`)
  }
  stats(pid: string): Promise<GraphStats> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/stats`)
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
  /** Công cụ ngoài có trên máy (ffmpeg, faster-whisper, git, gh, yt-dlp). */
  tools(): Promise<Record<string, boolean>> {
    return this.request('GET', '/v1/tools')
  }
  report(pid: string): Promise<GraphReport> {
    return this.request('GET', `/v1/projects/${encodeURIComponent(pid)}/report`)
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
  exportGraph(pid: string, format: ExportFormat, scope: ExportScope, outDir: string): Promise<ExportResult> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/export`, { format, scope, out_dir: outDir })
  }
  pushGraph(pid: string, req: PushRequest): Promise<PushResult> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/export/push`, req)
  }
}
