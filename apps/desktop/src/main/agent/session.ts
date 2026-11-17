import { realpathSync } from 'node:fs'
import { join } from 'node:path'
// Chỉ import kiểu: pi là ESM, main là CJS nên giá trị phải nạp bằng loadPi() (docs/spikes/2026-11-pi-monaco-electron.md mục a).
import type { AgentSession, AgentSessionEvent, ExtensionAPI, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { AgentEvent, AgentMode } from '../../shared/agent-types'
import { verifyCitations } from '../ai/citations'
import { TOOL_DEFS } from '../ai/tools'
import type { EngineApi } from '../engine/api'
import { createApprovalGate, type ApprovalGate } from './approval'
import { createNexgraphExtension, previewWrite } from './extension'
import { NEXGRAPH_RULES } from './skill'

/** Module bọc duy nhất nạp pi. */
export const loadPi = () => import('@earendil-works/pi-coding-agent')

const GRAPH_TOOLS = TOOL_DEFS.map((t) => t.function.name)
export const ASK_TOOLS = ['read', 'grep', 'find', 'ls']
export const EDIT_TOOLS = [...ASK_TOOLS, 'edit', 'write', 'bash']
const toolsFor = (mode: AgentMode): string[] => [...(mode === 'edit' ? EDIT_TOOLS : ASK_TOOLS), ...GRAPH_TOOLS]

/** Lỗi có mã mà toIpcResult chuyển nguyên về renderer. */
export class AgentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'AgentError'
  }
}

type Model = Parameters<AgentSession['setModel']>[0]
export type PiSession = Pick<AgentSession, 'subscribe' | 'prompt' | 'abort' | 'dispose' | 'setActiveToolsByName' | 'getActiveToolNames' | 'setModel' | 'model' | 'messages'>
export type SessionSpec = { cwd: string; agentDir: string; tools: string[]; extension: (pi: ExtensionAPI) => void; modelRuntime: ModelRuntime; model: Model }
export type ModelChoice = { modelRuntime: ModelRuntime; selected: { provider: string; id: string } | null }

export type AgentDeps = {
  api: EngineApi
  dataDir: string
  models(): Promise<ModelChoice>
  hasConsent(projectId: string): Promise<boolean>
  rootOf(projectId: string): Promise<string>
  emit(projectId: string, e: AgentEvent): void
  createSession?: (spec: SessionSpec) => Promise<PiSession>
}

/** Phiên pi thật: không đọc ~/.pi, không nạp extension/skill/cài đặt của dự án (mở repo lạ không được chạy mã của nó). */
export async function createPiSession(spec: SessionSpec): Promise<PiSession> {
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await loadPi()
  const settingsManager = SettingsManager.inMemory({}, { projectTrusted: false })
  const resourceLoader = new DefaultResourceLoader({
    cwd: spec.cwd, agentDir: spec.agentDir, settingsManager,
    // noContextFiles: pi đọc AGENTS.md/CLAUDE.md từ gốc dự án lên tận / và agentDir; tệp ngoài dự án không được gửi đi.
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [spec.extension],
    appendSystemPromptOverride: (base) => [...base, NEXGRAPH_RULES]
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: spec.cwd, agentDir: spec.agentDir, settingsManager, resourceLoader,
    sessionManager: SessionManager.inMemory(spec.cwd),
    modelRuntime: spec.modelRuntime, model: spec.model, tools: spec.tools
  })
  return session
}

// stopped: đang dừng/đã đóng, yêu cầu duyệt mới bị từ chối ngay; lượt mới bỏ cờ.
type Entry = { gate: ApprovalGate; session: Promise<PiSession>; busy: boolean; text: string; stopped: boolean }

const STATUS = /\b([45]\d\d)\b/
const NETWORK = /fetch failed|connection error|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? ?out|network|socket|terminated/i

/** Khoá đang active (do AccountService đăng ký) để che cả giá trị không theo mẫu `sk-*`. */
const activeSecrets = new Set<string>()
export const rememberSecret = (key?: string | null): void => {
  if (!key || key.length < 6) return
  activeSecrets.add(key)
  if (activeSecrets.size > 32) activeSecrets.delete(activeSecrets.values().next().value!)
}

/**
 * Gỡ mọi dạng khoá biết được (giá trị key đang active, `sk-`, `gsk_`, `AIza`, OAuth JWT, Bearer)
 * rồi cắt ngắn: chi tiết lỗi nhà cung cấp không đi nguyên văn ra renderer.
 */
export const scrub = (raw: string): string => {
  let s = raw
  for (const secret of activeSecrets) s = s.split(secret).join('***')
  return s
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '***')
    .replace(/\b(sk-|gsk_|AIza|xoxb-|ghp_)[A-Za-z0-9_\-]{6,}/gi, '$1***')
    .replace(/\bBearer\s+\S+/gi, 'Bearer ***')
    .slice(0, 200)
}

/** Ánh xạ lỗi nhà cung cấp sang mã/câu tiếng Việt, dùng lại mã của chat.ts cũ. */
function providerError(raw: string): AgentEvent {
  const status = STATUS.exec(raw)?.[1]
  if (status === '401' || status === '403') return { type: 'error', code: 'ai_unauthorized', message: 'API key bị từ chối' }
  if (status) return { type: 'error', code: 'ai_unreachable', message: `Nhà cung cấp AI trả về ${status}` }
  if (NETWORK.test(raw)) return { type: 'error', code: 'ai_unreachable', message: 'Không kết nối được tới nhà cung cấp AI' }
  // Không đưa err.message thô (dù đã scrub) vào AgentEvent.error.message.
  return { type: 'error', code: 'ai_error', message: 'Trợ lý AI gặp lỗi' }
}
const CANCELLED: AgentEvent = { type: 'error', code: 'ai_cancelled', message: 'Đã dừng' }

/** Mỗi dự án một phiên agent pi trong bộ nhớ; chế độ Hỏi chỉ đọc, chế độ Sửa hỏi duyệt từng edit/write/bash. */
export class AgentService {
  private readonly entries = new Map<string, Entry>()
  private readonly modes = new Map<string, AgentMode>()
  /** Prompt đang nạp model/consent/root nhưng chưa có Entry để abort()/close() thấy. */
  private readonly starting = new Map<string, number>()
  private readonly generations = new Map<string, number>()

  constructor(private readonly deps: AgentDeps) {}

  private active(projectId: string, generation: number): boolean {
    return (this.generations.get(projectId) ?? 0) === generation
  }

  private invalidate(projectId: string): void {
    this.generations.set(projectId, (this.generations.get(projectId) ?? 0) + 1)
    this.starting.delete(projectId)
  }

  getMode(projectId: string): AgentMode {
    return this.modes.get(projectId) ?? 'ask'
  }

  setMode(projectId: string, mode: AgentMode): void {
    const e = this.entries.get(projectId)
    e?.gate.denyAll('Đã đổi chế độ')
    this.modes.set(projectId, mode)
    // Đổi tool tại chỗ, giữ hội thoại (AgentSession.setActiveToolsByName, có hiệu lực từ lượt gọi mô hình kế tiếp).
    void e?.session.then((s) => s.setActiveToolsByName(toolsFor(this.getMode(projectId)))).catch(() => {})
  }

  approve(projectId: string, id: string, allow: boolean): void {
    this.entries.get(projectId)?.gate.resolve(id, allow)
  }

  pending(projectId: string): number {
    return this.entries.get(projectId)?.gate.pending() ?? 0
  }

  async prompt(projectId: string, text: string): Promise<void> {
    if (this.entries.get(projectId)?.busy || this.starting.has(projectId)) {
      throw new AgentError('agent_busy', 'Trợ lý đang trả lời, hãy đợi hoặc bấm Dừng')
    }
    const generation = this.generations.get(projectId) ?? 0
    const active = (): boolean => this.active(projectId, generation)
    this.starting.set(projectId, generation)
    try {
      const { modelRuntime, selected } = await this.deps.models()
      if (!active()) return
      const model = selected && modelRuntime.getModel(selected.provider, selected.id)
      if (!model) throw new AgentError('ai_not_configured', 'Chưa cấu hình trợ lý AI')
      const consent = await this.deps.hasConsent(projectId)
      if (!active()) return
      if (!consent) throw new AgentError('consent_required', 'Chưa đồng ý gửi dữ liệu tới nhà cung cấp AI')
      const entry = this.entries.get(projectId) ?? await this.open(projectId, modelRuntime, model, active)
      if (!active() || !entry) return
      if (entry.busy) throw new AgentError('agent_busy', 'Trợ lý đang trả lời, hãy đợi hoặc bấm Dừng')
      entry.busy = true
      entry.stopped = false
      entry.text = ''
      try {
        const result = await this.run(projectId, entry, model, text, active)
        if (active()) this.deps.emit(projectId, result)
      } finally {
        entry.busy = false
      }
    } finally {
      if (this.starting.get(projectId) === generation) this.starting.delete(projectId)
    }
  }

  /** Chạy một lượt và trả sự kiện kết thúc (done hoặc error); không ném. */
  private async run(projectId: string, entry: Entry, model: Model, text: string, active: () => boolean): Promise<AgentEvent> {
    const closed = () => !active() || this.entries.get(projectId) !== entry
    try {
      const session = await entry.session
      if (closed()) return CANCELLED
      if (session.model?.provider !== model.provider || session.model?.id !== model.id) {
        await session.setModel(model)
        if (closed()) return CANCELLED
      }
      if (closed()) return CANCELLED
      await session.prompt(text)
      if (closed()) return CANCELLED
      const last = session.messages.filter((m) => m.role === 'assistant').at(-1) as { stopReason?: string; errorMessage?: string } | undefined
      if (last?.stopReason === 'aborted') return CANCELLED
      if (last?.stopReason === 'error') return providerError(last.errorMessage ?? '')
      const citations = await verifyCitations(this.deps.api, projectId, entry.text)
      return closed() ? CANCELLED : { type: 'done', text: entry.text, citations }
    } catch (err) {
      return closed() ? CANCELLED : providerError(err instanceof Error ? err.message : String(err))
    }
  }

  async abort(projectId: string): Promise<void> {
    const e = this.entries.get(projectId)
    const hadTurn = this.starting.has(projectId) || e?.busy === true
    this.invalidate(projectId)
    // Kết thúc lượt UI hiện tại ngay; kết quả cũ về sau bị generation chặn.
    if (hadTurn) this.deps.emit(projectId, CANCELLED)
    if (!e) return
    // denyAll trước: abort() đợi agent rảnh, mà agent đang đợi hook tool_call chờ duyệt.
    e.stopped = true
    e.gate.denyAll('Đã dừng')
    try {
      await (await e.session).abort()
    } catch {
      // phiên tạo thất bại: không có gì để dừng
    }
    e.gate.denyAll('Đã dừng')
  }

  close(projectId: string): void {
    this.invalidate(projectId)
    const e = this.entries.get(projectId)
    if (!e) return
    this.entries.delete(projectId)
    e.stopped = true
    e.gate.denyAll('Đã đóng dự án')
    // Dừng lượt đang chạy trước rồi mới huỷ phiên: dispose() riêng lẻ có thể chờ mãi một tool đang treo.
    void e.session.then(async (s) => {
      try { await s.abort() } catch { /* phiên chưa tạo xong hoặc đã dừng */ }
      await s.dispose()
    }).catch(() => {})
  }

  closeAll(): void {
    for (const pid of new Set([...this.entries.keys(), ...this.starting.keys()])) this.close(pid)
  }

  private async open(projectId: string, modelRuntime: ModelRuntime, model: Model, active: () => boolean): Promise<Entry | null> {
    const root = realpathSync(await this.deps.rootOf(projectId))
    if (!active()) return null // bị close/abort trong lúc chờ root: không tạo phiên
    const existing = this.entries.get(projectId) // hai prompt đồng thời cùng tạo phiên
    if (existing) return existing
    const emit = (e: AgentEvent) => this.deps.emit(projectId, e)
    const entry = { busy: false, text: '', stopped: false } as Entry
    entry.gate = createApprovalGate({
      root,
      getMode: () => this.getMode(projectId),
      ask: (request) => {
        if (entry.stopped) throw new Error('Đã dừng') // gate từ chối ngay, không phát approval
        emit({ type: 'approval', request })
      },
      closed: (id) => emit({ type: 'approval_closed', id }),
      preview: (tool, input) => previewWrite(root, tool, input)
    })
    const create = this.deps.createSession ?? createPiSession
    entry.session = create({
      cwd: root,
      agentDir: join(this.deps.dataDir, 'agent'),
      // Allowlist gồm cả tool sửa để đổi chế độ tại chỗ được; tool đang bật do chế độ quyết định, cổng duyệt vẫn chặn sửa ở chế độ Hỏi.
      tools: toolsFor('edit'),
      extension: createNexgraphExtension({
        api: this.deps.api, projectId, root, gate: entry.gate,
        onWriteConflict: (message) => {
          if (this.entries.get(projectId) === entry && !entry.stopped) emit({ type: 'write_conflict', message })
        }
      }),
      modelRuntime,
      model
    }).then((s) => {
      s.setActiveToolsByName(toolsFor(this.getMode(projectId)))
      s.subscribe((ev) => this.onEvent(projectId, entry, ev))
      return s
    })
    entry.session.catch(() => this.entries.get(projectId) === entry && this.entries.delete(projectId))
    this.entries.set(projectId, entry)
    return entry
  }

  private onEvent(projectId: string, entry: Entry, ev: AgentSessionEvent): void {
    if (this.entries.get(projectId) !== entry) return
    const emit = (e: AgentEvent) => this.deps.emit(projectId, e)
    if (ev.type === 'message_update' && ev.assistantMessageEvent.type === 'text_delta') {
      entry.text += ev.assistantMessageEvent.delta
      emit({ type: 'text', delta: ev.assistantMessageEvent.delta })
    } else if (ev.type === 'tool_execution_start') emit({ type: 'tool', name: ev.toolName, status: 'start' })
    else if (ev.type === 'tool_execution_end') emit({ type: 'tool', name: ev.toolName, status: 'end', error: ev.isError })
  }
}
