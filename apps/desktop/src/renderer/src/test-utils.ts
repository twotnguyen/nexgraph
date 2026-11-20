import { vi } from 'vitest'
import type { NexGraphApi } from '@shared/api'
import type { Changes, EngineEvent, Job, JobState, ProjectSummary } from '@shared/graph-types'
import type { AgentEvent, AgentSessionSnapshot } from '@shared/agent-types'
import type { GeminiCliEvent, GeminiCliStatus } from '@shared/gemini-types'

export const emptyGeminiStatus = (over: Partial<GeminiCliStatus> = {}): GeminiCliStatus => ({
  state: 'not_installed', version: '1.5.11', installed: false, platformSupported: true, authenticated: false,
  model: 'auto', connectionId: 'gemini-test-connection', ...over
})

export const emptyAgentSnapshot = (): AgentSessionSnapshot => ({
  session: null, messages: [], task: null, mode: 'ask', policy: 'review',
  execution: { policy: 'review', allowCommands: false },
  limits: { maxTurns: 20, maxDurationMs: 600000, maxTokens: 100000 },
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null }
})

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
  const geminiHandlers = new Set<(event: GeminiCliEvent) => void>()
  const api = {
    engine: { status: vi.fn(async () => ({ state: 'ready' as const, engineVersion: '0.1.0', vendorCommit: 'x' })),
      restart: vi.fn(async () => {}),
      tools: vi.fn(async () => ({ ffmpeg: true, faster_whisper: true, git: true, gh: true, yt_dlp: true })), onStatus: vi.fn(() => () => {}), ...over.engine },
    project: { pickFolder: vi.fn(async () => '/Đồ án/demo'), open: vi.fn(async () => project()),
      list: vi.fn(async () => []), remove: vi.fn(async () => {}), ...over.project },
    index: {
      scan: vi.fn(async () => ({ files: 10, by_language: {}, large: false, threshold: 5000, top_dirs: [] })),
      start: vi.fn(async () => ({ jobId: 'j1' })), status: vi.fn(async () => progress('queued', 0, 0)), cancel: vi.fn(async () => {}),
      refresh: vi.fn(async () => ({ status: 'ok' as const, reason: null, added: 0, changed: 0, removed: 0, seconds: 0 })),
      onEvent: vi.fn((cb: (e: EngineEvent) => void) => { handlers.add(cb); return () => handlers.delete(cb) }),
      ...over.index
    },
    graph: { stats: vi.fn(async () => ({ files: 0, nodes_by_kind: {}, edges_by_type: {}, languages: {}, unresolved: 0 })),
      neighbors: vi.fn(async () => ({ nodes: [], edges: [], truncated: false })),
      explain: vi.fn(async () => ({ node: null, degree: 0, community: null, groups: [] })), section: vi.fn(), node: vi.fn(async (_p: string, id: string) => ({ id, kind: 'file' as const, label: id, qualified_name: id,
      language: null, file: null, line_start: null, line_end: null, is_test: false, origin: 'ast', signature: null, community: null })), code: vi.fn(), search: vi.fn(async () => []),
      architecture: vi.fn(async () => ({ parent: null, blocks: [], links: [] })), archEvidence: vi.fn(async () => []),
      changes: vi.fn(async () => emptyChanges()), report: vi.fn(), paths: vi.fn(), impactOf: vi.fn(), ask: vi.fn(),
      recluster: vi.fn(async () => ({ communities: 3 })),
      flows: vi.fn(async () => ({ flows: [], total: 0, truncated: false })), flow: vi.fn(),
      tour: vi.fn(async () => ({ steps: [] })), locate: vi.fn(), context: vi.fn(),
      map: vi.fn(async () => ({ parent: null, nodes: [], edges: [], truncated: false, totals: { files: 0, nodes: 0 } })),
      cycles: vi.fn(async () => ({ cycles: [], total: 0 })),
      ...over.graph },
    fs: { read: vi.fn(async () => ({ text: '', eol: '\n' as const, bom: false, mtimeMs: 1, version: 'initial', readOnly: false })),
      write: vi.fn(async () => ({ mtimeMs: 2, version: 'saved' })), ...over.fs },
    exporter: { pickDir: vi.fn(async () => '/Đồ án/xuất'), run: vi.fn(async () => ({ files: [], truncated: false })),
      push: vi.fn(async () => ({ nodes: 0, edges: 0, truncated: false })), png: vi.fn(async () => null),
      reveal: vi.fn(async () => {}), ...over.exporter },
    hook: { status: vi.fn(async () => 'off' as const), preview: vi.fn(async () => '# >>> nexgraph >>>'), install: vi.fn(async () => {}), uninstall: vi.fn(async () => {}), ...over.hook },
    ai: { getSettings: vi.fn(async () => ({ baseUrl: '', model: '', hasKey: false })), hasConsent: vi.fn(async () => false), grantConsent: vi.fn(async () => {}), ...over.ai },
    auth: {
      list: vi.fn(async () => []), setKey: vi.fn(async () => {}), removeKey: vi.fn(async () => {}),
      saveCustom: vi.fn(async () => {}), removeCustom: vi.fn(async () => {}), login: vi.fn(async () => {}),
      forgetRegistration: vi.fn(async () => {}), loginCancel: vi.fn(async () => {}), promptReply: vi.fn(async () => {}), logout: vi.fn(async () => {}),
      models: vi.fn(async () => []), selectModel: vi.fn(async () => {}), test: vi.fn(async () => ({ ok: true, message: '' })),
      discoverLocal: vi.fn(async () => []), connectLocal: vi.fn(async () => {}),
      onEvent: vi.fn(() => () => {}), onPrompt: vi.fn(() => () => {}), ...over.auth
    },
    gemini: {
      status: vi.fn(async () => emptyGeminiStatus()), setup: vi.fn(async () => emptyGeminiStatus({ state: 'signed_out', installed: true })),
      login: vi.fn(async () => emptyGeminiStatus({ state: 'connected', installed: true, authenticated: true })),
      loginCancel: vi.fn(async () => {}), disconnect: vi.fn(async () => {}), forget: vi.fn(async () => {}), activate: vi.fn(async () => {}),
      models: vi.fn(async () => []), selectModel: vi.fn(async () => {}),
      test: vi.fn(async () => ({ ok: true, message: 'Kết nối Gemini đã sẵn sàng', capabilities: { streaming: true, tools: true } })),
      onEvent: vi.fn((cb: (event: GeminiCliEvent) => void) => { geminiHandlers.add(cb); return () => geminiHandlers.delete(cb) }), ...over.gemini
    },
    agent: { prompt: vi.fn(async () => {}), abort: vi.fn(async () => {}), setMode: vi.fn(async () => {}), getMode: vi.fn(async () => 'ask' as const),
      approve: vi.fn(async () => {}), close: vi.fn(async () => {}),
      snapshot: vi.fn(async () => emptyAgentSnapshot()), listSessions: vi.fn(async () => []),
      newSession: vi.fn(async () => emptyAgentSnapshot()), switchSession: vi.fn(async () => emptyAgentSnapshot()),
      renameSession: vi.fn(async () => {}), deleteSession: vi.fn(async () => {}),
      setExecution: vi.fn(async () => {}), getExecution: vi.fn(async () => ({ policy: 'review' as const, allowCommands: false })),
      setLimits: vi.fn(async () => {}), getLimits: vi.fn(async () => ({ maxTurns: 20, maxDurationMs: 600000, maxTokens: 100000 })),
      projectCommands: vi.fn(async () => ({ commands: [], warnings: [] })),
      checkpoints: vi.fn(async () => []), rollback: vi.fn(async () => ({ restored: [], conflicts: [] })),
      editorState: vi.fn(async () => {}),
      onEvent: vi.fn((cb: (pid: string, e: AgentEvent) => void) => { agentHandlers.add(cb); return () => agentHandlers.delete(cb) }), ...over.agent },
    mcp: { config: vi.fn(async () => ({ stdio: '{}' })), plan: vi.fn(), apply: vi.fn(), planRemove: vi.fn(), remove: vi.fn(), startHttp: vi.fn(async () => ({ url: 'http://127.0.0.1:1/mcp', key: 'k' })),
      stopHttp: vi.fn(async () => {}), httpStatus: vi.fn(async () => null), ...over.mcp },
    watch: { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), ...over.watch }
  }
  ;(window as unknown as { nexgraph: unknown }).nexgraph = api
  return { api, emit: (e: EngineEvent) => handlers.forEach((h) => h(e)), emitAgent: (pid: string, e: AgentEvent) => agentHandlers.forEach((h) => h(pid, e)), emitGemini: (event: GeminiCliEvent) => geminiHandlers.forEach((handler) => handler(event)) }
}

export const progress = (state: JobState, done: number, total: number, extra: Partial<Job> = {}): Extract<EngineEvent, { type: 'job_progress' }> =>
  ({ type: 'job_progress', job_id: 'j1', project_id: 'p1', state, files_done: done, files_total: total, message: null, ...extra })
