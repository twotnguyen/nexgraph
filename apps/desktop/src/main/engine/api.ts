import type {
  CodeSlice, GraphNode, GraphStats, Job, NeighborQuery, Neighborhood, ProjectSummary
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
  startIndex(pid: string): Promise<{ job_id: string }> {
    return this.request('POST', `/v1/projects/${encodeURIComponent(pid)}/index`)
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
}
