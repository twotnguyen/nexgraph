import { vi } from 'vitest'
import type { NexGraphApi } from '@shared/api'
import type { Changes, EngineEvent, ProjectSummary } from '@shared/graph-types'

export const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  project_id: 'p1', path: '/Đồ án/demo', name: 'demo', storage: 'in_project', ...over
})

export const emptyChanges = (over: Partial<Changes> = {}): Changes => ({
  base: 'git_head', base_commit: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', note: null, changed_files: [], changed_nodes: [],
  impacted: [], tests: [], test_gaps: [], truncated: false, ...over
})

/** Dựng `window.nexgraph` giả; `emit` bắn sự kiện engine tới mọi người đăng ký. */
export function installNexgraph(over: { [K in keyof NexGraphApi]?: Partial<NexGraphApi[K]> } = {}) {
  const handlers = new Set<(e: EngineEvent) => void>()
  const api = {
    engine: { status: vi.fn(async () => ({ state: 'ready' as const, engineVersion: '0.1.0', graphifyCommit: 'x' })),
      restart: vi.fn(async () => {}), onStatus: vi.fn(() => () => {}), ...over.engine },
    project: { pickFolder: vi.fn(async () => '/Đồ án/demo'), open: vi.fn(async () => project()),
      list: vi.fn(async () => []), ...over.project },
    index: {
      scan: vi.fn(async () => ({ files: 10, by_language: {}, large: false, threshold: 5000, top_dirs: [] })),
      start: vi.fn(async () => ({ jobId: 'j1' })), cancel: vi.fn(async () => {}),
      refresh: vi.fn(async () => ({ status: 'ok' as const, reason: null, added: 0, changed: 0, removed: 0, seconds: 0 })),
      onEvent: vi.fn((cb: (e: EngineEvent) => void) => { handlers.add(cb); return () => handlers.delete(cb) }),
      ...over.index
    },
    graph: { stats: vi.fn(), neighbors: vi.fn(), node: vi.fn(async (_p: string, id: string) => ({ id, kind: 'file' as const, label: id, qualified_name: id,
      language: null, file: null, line_start: null, line_end: null, is_test: false, origin: 'ast', signature: null, community: null })), code: vi.fn(), search: vi.fn(async () => []),
      architecture: vi.fn(async () => ({ parent: null, blocks: [], links: [] })), archEvidence: vi.fn(async () => []),
      changes: vi.fn(async () => emptyChanges()), ...over.graph },
    watch: { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), ...over.watch }
  }
  ;(window as unknown as { nexgraph: unknown }).nexgraph = api
  return { api, emit: (e: EngineEvent) => handlers.forEach((h) => h(e)) }
}

export const progress = (state: string, done: number, total: number, extra: object = {}): EngineEvent =>
  ({ type: 'job_progress', job_id: 'j1', project_id: 'p1', state, files_done: done, files_total: total, message: null, ...extra }) as EngineEvent
