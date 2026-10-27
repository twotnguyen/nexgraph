import { vi } from 'vitest'
import type { NexGraphApi } from '@shared/api'
import type { EngineEvent, ProjectSummary } from '@shared/graph-types'

export const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  project_id: 'p1', path: '/Đồ án/demo', name: 'demo', storage: 'in_project', ...over
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
      start: vi.fn(async () => ({ jobId: 'j1' })), cancel: vi.fn(async () => {}),
      onEvent: vi.fn((cb: (e: EngineEvent) => void) => { handlers.add(cb); return () => handlers.delete(cb) }),
      ...over.index
    },
    graph: { stats: vi.fn(), neighbors: vi.fn(), node: vi.fn(), code: vi.fn(), ...over.graph }
  }
  ;(window as unknown as { nexgraph: unknown }).nexgraph = api
  return { api, emit: (e: EngineEvent) => handlers.forEach((h) => h(e)) }
}

export const progress = (state: string, done: number, total: number, extra: object = {}): EngineEvent =>
  ({ type: 'job_progress', job_id: 'j1', project_id: 'p1', state, files_done: done, files_total: total, message: null, ...extra }) as EngineEvent
