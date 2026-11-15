import { vi } from 'vitest'
import type { NexGraphApi } from '@shared/api'
import type { Changes, EngineEvent, ProjectSummary } from '@shared/graph-types'
import type { AgentEvent } from '@shared/agent-types'

export const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  project_id: 'p1', path: '/Đồ án/demo', name: 'demo', storage: 'in_project', ...over
})

export const emptyChanges = (over: Partial<Changes> = {}): Changes => ({
  base: 'git_head', base_commit: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', note: null, changed_files: [], changed_nodes: [],
  impacted: [], tests: [], test_gaps: [], truncated: false, ...over
})

/** Dựng `window.nexgraph` giả; `emit` bắn sự kiện engine, `emitAgent` bắn sự kiện agent tới mọi người đăng ký. */
export function installNexgraph(over: { [K in keyof NexGraphApi]?: Partial<NexGraphApi[K]> } = {}) {
  const handlers = new Set<(e: EngineEvent) => void>()
  const agentHandlers = new Set<(pid: string, e: AgentEvent) => void>()
  const api = {
    engine: { status: vi.fn(async () => ({ state: 'ready' as const, engineVersion: '0.1.0', vendorCommit: 'x' })),
      restart: vi.fn(async () => {}),
      tools: vi.fn(async () => ({ ffmpeg: true, faster_whisper: true, git: true, gh: true, yt_dlp: true })), onStatus: vi.fn(() => () => {}), ...over.engine },
    project: { pickFolder: vi.fn(async () => '/Đồ án/demo'), open: vi.fn(async () => project()),
      list: vi.fn(async () => []), ...over.project },
    index: {
      scan: vi.fn(async () => ({ files: 10, by_language: {}, large: false, threshold: 5000, top_dirs: [] })),
      start: vi.fn(async () => ({ jobId: 'j1' })), cancel: vi.fn(async () => {}),
      refresh: vi.fn(async () => ({ status: 'ok' as const, reason: null, added: 0, changed: 0, removed: 0, seconds: 0 })),
      onEvent: vi.fn((cb: (e: EngineEvent) => void) => { handlers.add(cb); return () => handlers.delete(cb) }),
      ...over.index
    },
    graph: { stats: vi.fn(async () => ({ files: 0, nodes_by_kind: {}, edges_by_type: {}, languages: {}, unresolved: 0 })), neighbors: vi.fn(), node: vi.fn(async (_p: string, id: string) => ({ id, kind: 'file' as const, label: id, qualified_name: id,
      language: null, file: null, line_start: null, line_end: null, is_test: false, origin: 'ast', signature: null, community: null })), code: vi.fn(), search: vi.fn(async () => []),
      architecture: vi.fn(async () => ({ parent: null, blocks: [], links: [] })), archEvidence: vi.fn(async () => []),
      changes: vi.fn(async () => emptyChanges()), report: vi.fn(), paths: vi.fn(), impactOf: vi.fn(), ask: vi.fn(),
      recluster: vi.fn(async () => ({ communities: 3 })),
      flows: vi.fn(async () => ({ flows: [], total: 0, truncated: false })), flow: vi.fn(),
      tour: vi.fn(async () => ({ steps: [] })), locate: vi.fn(), context: vi.fn(),
      map: vi.fn(async () => ({ parent: null, nodes: [], edges: [], truncated: false, totals: { files: 0, nodes: 0 } })),
      cycles: vi.fn(async () => ({ cycles: [], total: 0 })),
      ...over.graph },
    fs: { read: vi.fn(async () => ({ text: '', eol: '\n' as const, bom: false, mtimeMs: 1, readOnly: false })),
      write: vi.fn(async () => ({ mtimeMs: 2 })), ...over.fs },
    exporter: { pickDir: vi.fn(async () => '/Đồ án/xuất'), run: vi.fn(async () => ({ files: [], truncated: false })),
      push: vi.fn(async () => ({ nodes: 0, edges: 0, truncated: false })), png: vi.fn(async () => null),
      reveal: vi.fn(async () => {}), ...over.exporter },
    hook: { status: vi.fn(async () => 'off' as const), preview: vi.fn(async () => '# >>> nexgraph >>>'), install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}), ...over.hook },
    ai: { getSettings: vi.fn(async () => ({ baseUrl: '', model: '', hasKey: false })), hasConsent: vi.fn(async () => false), grantConsent: vi.fn(async () => {}), ...over.ai },
    auth: {
      list: vi.fn(async () => []), setKey: vi.fn(async () => {}), removeKey: vi.fn(async () => {}),
      saveCustom: vi.fn(async () => {}), removeCustom: vi.fn(async () => {}), login: vi.fn(async () => {}),
      loginCancel: vi.fn(async () => {}), promptReply: vi.fn(async () => {}), logout: vi.fn(async () => {}),
      models: vi.fn(async () => []), selectModel: vi.fn(async () => {}), test: vi.fn(async () => ({ ok: true, message: '' })),
      onEvent: vi.fn(() => () => {}), onPrompt: vi.fn(() => () => {}), ...over.auth
    },
    agent: { prompt: vi.fn(async () => {}), abort: vi.fn(async () => {}), setMode: vi.fn(async () => {}), getMode: vi.fn(async () => 'ask' as const),
      approve: vi.fn(async () => {}), close: vi.fn(async () => {}),
      onEvent: vi.fn((cb: (pid: string, e: AgentEvent) => void) => { agentHandlers.add(cb); return () => agentHandlers.delete(cb) }), ...over.agent },
    mcp: { config: vi.fn(async () => ({ stdio: '{}' })), plan: vi.fn(), apply: vi.fn(), startHttp: vi.fn(async () => ({ url: 'http://127.0.0.1:1/mcp', key: 'k' })),
      stopHttp: vi.fn(async () => {}), httpStatus: vi.fn(async () => null), ...over.mcp },
    watch: { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), ...over.watch }
  }
  ;(window as unknown as { nexgraph: unknown }).nexgraph = api
  return { api, emit: (e: EngineEvent) => handlers.forEach((h) => h(e)), emitAgent: (pid: string, e: AgentEvent) => agentHandlers.forEach((h) => h(pid, e)) }
}

export const progress = (state: string, done: number, total: number, extra: object = {}): EngineEvent =>
  ({ type: 'job_progress', job_id: 'j1', project_id: 'p1', state, files_done: done, files_total: total, message: null, ...extra }) as EngineEvent
