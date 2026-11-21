import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, posix } from 'node:path'
// Chỉ import kiểu: pi là ESM, main là CJS nên giá trị phải nạp bằng loadPi() (docs/spikes/2026-11-pi-monaco-electron.md mục a).
import type { AgentSession, AgentSessionEvent, ExtensionAPI, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import {
  normalizeConsentTarget, sameConsentTarget, type AgentEvent, type AgentMode, type AiConsentTarget,
  type AgentExecutionSettings, type AgentExecutionPolicy, type AgentRunLimits, type AgentUsage, type AgentToolRun,
  type AgentTask, type AgentSessionInfo, type AgentSessionSnapshot, type AgentPromptOptions,
  type AgentCheckpointInfo, type AgentRollbackResult, type PiConsentTarget
} from '../../shared/agent-types'
import { verifyCitations } from '../ai/citations'
import type { EngineApi } from '../engine/api'
import { createApprovalGate, type ApprovalGate } from './approval'
import { createNexgraphExtension, previewWrite, toolsFor } from './extension'
import { NEXGRAPH_RULES } from './skill'
import { SessionStore, type SessionScope, type StoredSession } from './session-store'
import { addUsage, emptyUsage, messageText, transcript, transcriptUsage, usageFromMessage } from './session-transcript'
import { TaskExecution } from './process-tools'
import { CheckpointStore } from './checkpoints'
import { prepareAgentContext } from './context'

/** Module bọc duy nhất nạp pi. */
export const loadPi = () => import('@earendil-works/pi-coding-agent')

// Các adapter này nhận fetch theo request. Google dùng transport SDK riêng.
const GUARDED_HTTP_APIS = new Set([
  'openai-completions', 'openai-responses', 'openai-codex-responses', 'azure-openai-responses',
  'anthropic-messages', 'mistral-conversations', 'pi-messages'
])
const SYSTEM_PROMPT = 'Bạn là trợ lý mã nguồn NexGraph. Hỏi và Lập kế hoạch chỉ đọc. Chế độ Sửa dùng quyền thực thi do người dùng chọn cho tác vụ. Tra đồ thị, nêu ảnh hưởng, sửa mã và chạy kiểm thử khi được cấp công cụ. Khi công cụ báo xung đột hoặc bị từ chối, hãy báo rõ và điều chỉnh kế hoạch.'
const TOOL_EXTENSION = 'nexgraph'

/** Lỗi có mã mà toIpcResult chuyển nguyên về renderer. */
export class AgentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'AgentError'
  }
}

type Model = Parameters<AgentSession['setModel']>[0]
export type PiSession = Pick<AgentSession, 'subscribe' | 'prompt' | 'abort' | 'dispose' | 'setActiveToolsByName' | 'getActiveToolNames' | 'setModel' | 'model' | 'messages'>
export type SessionSpec = {
  cwd: string
  agentDir: string
  tools: string[]
  extension: (pi: ExtensionAPI) => void
  modelRuntime: ModelRuntime
  model: Model
  sessionManager?: SessionManager
  beforeModelTurn?(): void
  remainingTokens?(): number
  assertDispatch(model: Model, resolvedEndpoint?: boolean): void
  assertRequest(url: URL): void
}

export type AgentAccounts = {
  readonly modelRuntime: ModelRuntime
  getSelectedModel(): { provider: string; id: string } | null
  hasConsent(projectId: string, target: AiConsentTarget): Promise<boolean>
  getConsentTarget?(): Promise<AiConsentTarget | null>
  sessionIdentity?(): string
  selectedModelPricing?(): 'known' | 'unknown' | 'free' | 'subscription' | 'local' | undefined
}

export type AgentDeps = {
  api: EngineApi
  dataDir: string
  accounts(): Promise<AgentAccounts>
  rootOf(projectId: string): Promise<string>
  emit(projectId: string, e: AgentEvent): void
  createSession?: (spec: SessionSpec) => Promise<PiSession>
  editorState?(projectId: string): { file: string; dirty: boolean }[]
}

/** Phiên pi thật: không đọc ~/.pi, không nạp extension/skill/cài đặt của dự án (mở repo lạ không được chạy mã của nó). */
export async function createPiSession(spec: SessionSpec): Promise<AgentSession> {
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await loadPi()
  const settingsManager = SettingsManager.inMemory({
    cacheWarming: 'off', retry: { enabled: true, maxRetries: 2, baseDelayMs: 1000, maxAgentDelayMs: 15_000, provider: { maxRetries: 0 } }
  }, { projectTrusted: false })
  const resourceLoader = new DefaultResourceLoader({
    cwd: spec.cwd, agentDir: spec.agentDir, settingsManager,
    // noContextFiles: pi đọc AGENTS.md/CLAUDE.md từ gốc dự án lên tận / và agentDir; tệp ngoài dự án không được gửi đi.
    noExtensions: true, disabledBuiltinExtensions: ['mcp', 'codemode'],
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [{ name: TOOL_EXTENSION, factory: spec.extension }],
    systemPrompt: SYSTEM_PROMPT,
    appendSystemPrompt: [NEXGRAPH_RULES]
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: spec.cwd, agentDir: spec.agentDir, settingsManager, resourceLoader,
    sessionManager: spec.sessionManager ?? SessionManager.inMemory(spec.cwd),
    modelRuntime: spec.modelRuntime, model: spec.model,
    noTools: 'all', tools: spec.tools, excludeTools: ['mcp__*']
  })
  // Nếu extension tải thiếu, Pi có thể thay bằng công cụ dựng sẵn cùng tên.
  const registered = session.getAllTools()
  if (registered.length !== spec.tools.length ||
      registered.some((tool) => !spec.tools.includes(tool.name) || tool.sourceInfo.path !== `<inline:${TOOL_EXTENSION}>`)) {
    await session.dispose()
    throw new AgentError('ai_error', 'Không nạp được bộ công cụ an toàn của NexGraph')
  }
  const stream = session.agent.streamFunction
  session.agent.streamFunction = (model, context, options) => {
    spec.beforeModelTurn?.()
    spec.assertDispatch(model)
    const fetch: typeof globalThis.fetch = (input, init) => {
      spec.assertDispatch(model)
      spec.assertRequest(new URL(typeof input === 'string' || input instanceof URL ? input : input.url))
      return (options?.fetch ?? globalThis.fetch)(input, { ...init, redirect: 'manual' })
    }
    return stream(model, context, {
      ...options,
      ...(spec.remainingTokens ? { maxTokens: Math.min(options?.maxTokens ?? model.maxTokens, Math.max(1, spec.remainingTokens())) } : {}),
      ...(GUARDED_HTTP_APIS.has(model.api) ? { fetch } : {}),
      ...(model.api === 'openai-codex-responses' ? { transport: 'sse' as const } : {}),
      onPayload: (payload, requestModel) => {
        // SDK có thể đổi endpoint theo OAuth sau khi nhận model. Kiểm tra model thật ngay trước khi gửi payload.
        spec.assertDispatch(requestModel, true)
        return options?.onPayload?.(payload, requestModel)
      }
    })
  }
  return session
}

type Recipient = {
  target: PiConsentTarget
  model: Model
  modelRuntime: ModelRuntime
  isCurrent(): boolean
  account: string
  pricing: 'known' | 'unknown' | 'free' | 'subscription' | 'local'
}

// stopped: đang dừng/đã đóng, yêu cầu duyệt mới bị từ chối ngay; lượt mới bỏ cờ.
type Entry = {
  gate: ApprovalGate
  session: Promise<PiSession>
  target: PiConsentTarget
  isCurrent(): boolean
  busy: boolean
  text: string
  stopped: boolean
  dispatchBlocked: boolean
  stored: StoredSession
  task?: AgentTask
  execution?: TaskExecution
  controller?: AbortController
  taskUsage: AgentUsage
  tools: Map<string, AgentToolRun>
  limitError?: string
  pricing: Recipient['pricing']
  failed?: boolean
}

function selectedModel(accounts: AgentAccounts): Model | undefined {
  const selected = accounts.getSelectedModel()
  return selected ? accounts.modelRuntime.getModel(selected.provider, selected.id) : undefined
}

const targetFor = (model: Model | undefined): AiConsentTarget | null =>
  model ? normalizeConsentTarget(model.provider, model.baseUrl) : null

function inConsentBase(base: URL, request: URL): boolean {
  const path = base.pathname.replace(/\/+$/, '')
  if (request.origin !== base.origin || (request.pathname !== path && !request.pathname.startsWith(path + '/'))) return false
  for (const [name, value] of base.searchParams) {
    if (!request.searchParams.getAll(name).includes(value)) return false
  }
  return true
}

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
export const cleanAgentText = (raw: string, limit = 32_000): string => {
  let s = raw
  for (const secret of activeSecrets) s = s.split(secret).join('***')
  return s
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '***')
    .replace(/\b(sk-|gsk_|AIza|xoxb-|ghp_)[A-Za-z0-9_\-]{6,}/gi, '$1***')
    .replace(/\bBearer\s+\S+/gi, 'Bearer ***')
    .slice(0, limit)
}
export const scrub = (raw: string): string => cleanAgentText(raw, 200)

/** Ánh xạ lỗi nhà cung cấp sang mã/câu tiếng Việt, dùng lại mã của chat.ts cũ. */
function providerError(raw: string): AgentEvent {
  const status = STATUS.exec(raw)?.[1]
  if (status === '401' || status === '403') return { type: 'error', code: 'ai_unauthorized', message: 'API key bị từ chối' }
  if (status === '429') return { type: 'error', code: 'ai_rate_limited', message: 'Đã chạm hạn mức hoặc giới hạn tốc độ của nhà cung cấp. Kiểm tra hạn mức rồi thử lại.' }
  if (status) return { type: 'error', code: 'ai_unreachable', message: `Nhà cung cấp AI trả về ${status}` }
  if (NETWORK.test(raw)) return { type: 'error', code: 'ai_unreachable', message: 'Không kết nối được tới nhà cung cấp AI' }
  // Không đưa err.message thô (dù đã scrub) vào AgentEvent.error.message.
  return { type: 'error', code: 'ai_error', message: 'Trợ lý AI gặp lỗi' }
}
const CANCELLED: AgentEvent = { type: 'error', code: 'ai_cancelled', message: 'Đã dừng' }
const PROVIDER_CHANGED = { type: 'error', code: 'ai_provider_changed', message: 'Nhà cung cấp AI đã thay đổi. Hãy kiểm tra đích nhận và gửi lại câu hỏi.' } as const
const providerChanged = () => new AgentError(PROVIDER_CHANGED.code, PROVIDER_CHANGED.message)

export const DEFAULT_RUN_LIMITS: AgentRunLimits = { maxTurns: 30, maxDurationMs: 600_000, maxTokens: 120_000 }

/** A project has one live run, with durable Pi sessions isolated by account and destination. */
export class AgentService {
  private readonly entries = new Map<string, Entry>()
  private readonly opening = new Map<string, Promise<Entry | undefined>>()
  private readonly modes = new Map<string, AgentMode>()
  private readonly executionSettings = new Map<string, AgentExecutionSettings>()
  private readonly runLimits = new Map<string, AgentRunLimits>()
  private readonly starting = new Map<string, number>()
  private readonly generations = new Map<string, number>()
  private readonly rollbacks = new Set<string>()
  private readonly store: SessionStore

  constructor(private readonly deps: AgentDeps) {
    this.store = new SessionStore(deps.dataDir, loadPi)
  }

  private active(projectId: string, generation: number): boolean {
    return (this.generations.get(projectId) ?? 0) === generation
  }

  private invalidate(projectId: string): void {
    this.generations.set(projectId, (this.generations.get(projectId) ?? 0) + 1)
    this.starting.delete(projectId)
  }

  getMode(projectId: string): AgentMode { return this.modes.get(projectId) ?? 'ask' }
  getExecution(projectId: string): AgentExecutionSettings {
    return { ...(this.executionSettings.get(projectId) ?? { policy: 'review', allowCommands: false }) }
  }
  getPolicy(projectId: string): AgentExecutionPolicy { return this.getExecution(projectId).policy }
  setPolicy(projectId: string, policy: AgentExecutionPolicy): void {
    this.setExecution(projectId, { ...this.getExecution(projectId), policy })
  }
  setExecution(projectId: string, settings: AgentExecutionSettings): void {
    if (!settings || (settings.policy !== 'review' && settings.policy !== 'auto') || typeof settings.allowCommands !== 'boolean') {
      throw new AgentError('bad_param', 'Quyền thực thi không hợp lệ')
    }
    this.assertIdle(projectId)
    this.executionSettings.set(projectId, { ...settings })
  }

  getLimits(projectId: string): AgentRunLimits { return { ...(this.runLimits.get(projectId) ?? DEFAULT_RUN_LIMITS) } }
  setLimits(projectId: string, limits: AgentRunLimits): void {
    if (!limits || !Number.isSafeInteger(limits.maxTurns) || limits.maxTurns < 1 ||
      !Number.isSafeInteger(limits.maxTokens) || limits.maxTokens < 1 ||
      !Number.isSafeInteger(limits.maxDurationMs) || limits.maxDurationMs < 1 || limits.maxDurationMs > 2_147_483_647) {
      throw new AgentError('bad_param', 'Ngân sách phải là số nguyên dương và thời gian phải nằm trong giới hạn bộ đếm của hệ thống')
    }
    this.assertIdle(projectId)
    this.runLimits.set(projectId, { ...limits })
  }

  setMode(projectId: string, mode: AgentMode): void {
    if (!['ask', 'plan', 'edit'].includes(mode)) throw new AgentError('bad_param', 'Chế độ trợ lý không hợp lệ')
    const entry = this.entries.get(projectId)
    entry?.gate.denyAll('Đã đổi chế độ')
    this.modes.set(projectId, mode)
    void entry?.session.then((session) => session.setActiveToolsByName(toolsFor(this.getMode(projectId), projectId))).catch(() => {})
    if (mode !== 'edit' && entry?.busy && entry.execution?.allowCommands) void this.abort(projectId)
  }

  approve(projectId: string, id: string, allow: boolean): void {
    const entry = this.entries.get(projectId)
    if (entry && !this.discardIfStale(projectId, entry)) entry.gate.resolve(id, allow)
  }
  pending(projectId: string): number { return this.entries.get(projectId)?.gate.pending() ?? 0 }

  private assertIdle(projectId: string): void {
    if (this.rollbacks.has(projectId) || this.starting.has(projectId) || this.entries.get(projectId)?.busy) {
      throw new AgentError('agent_busy', 'Trợ lý đang chạy tác vụ. Bấm Dừng trước khi đổi hội thoại hoặc quyền thực thi.')
    }
  }

  private async recipient(): Promise<Recipient | undefined> {
    const accounts = await this.deps.accounts()
    const model = selectedModel(accounts)
    if (!model) return
    const target = accounts.getConsentTarget ? await accounts.getConsentTarget() : targetFor(model)
    if (!target || target.runtime === 'antigravity-cli') return
    const identity = accounts.sessionIdentity?.() ?? 'legacy-local-account'
    // The sync identity detects save/login/logout while a run is active. The
    // resolved consent account also covers keys supplied by the provider runtime.
    const account = JSON.stringify([identity, target.accountId ?? null])
    const originalEndpoint = model.baseUrl
    const isCurrent = () => {
      const selected = selectedModel(accounts)
      return !!selected && selected.provider === model.provider && selected.baseUrl === originalEndpoint &&
        (accounts.sessionIdentity?.() ?? 'legacy-local-account') === identity
    }
    return { target, model, modelRuntime: accounts.modelRuntime, isCurrent, account, pricing: accounts.selectedModelPricing?.() ?? 'unknown' }
  }

  private scope(projectId: string, root: string, recipient: Recipient): SessionScope {
    return { projectId, root, provider: recipient.target.provider, baseUrl: recipient.target.baseUrl, account: recipient.account }
  }

  async listSessions(projectId: string): Promise<AgentSessionInfo[]> {
    const recipient = await this.recipient()
    const root = realpathSync.native(await this.deps.rootOf(projectId))
    if (!recipient) return []
    if (!recipient.isCurrent()) throw providerChanged()
    return this.store.list(this.scope(projectId, root, recipient))
  }

  async snapshot(projectId: string): Promise<AgentSessionSnapshot> {
    const recipient = await this.recipient()
    const defaults = {
      mode: this.getMode(projectId), policy: this.getPolicy(projectId), execution: this.getExecution(projectId),
      limits: this.getLimits(projectId)
    }
    if (!recipient) return { ...defaults, session: null, messages: [], task: null, usage: emptyUsage() }
    const generation = this.generations.get(projectId) ?? 0
    const entry = await this.ensureEntry(projectId, recipient, () => this.active(projectId, generation))
    if (!entry || !recipient.isCurrent()) throw providerChanged()
    const { file: _file, task: _task, ...info } = entry.stored.record
    return {
      ...defaults, session: info, messages: transcript(entry.stored, cleanAgentText), task: entry.task ?? entry.stored.record.task ?? null,
      usage: transcriptUsage(entry.stored)
    }
  }

  async newSession(projectId: string): Promise<AgentSessionSnapshot> {
    this.assertIdle(projectId)
    const recipient = await this.recipient()
    if (!recipient) throw new AgentError('ai_not_configured', 'Chọn mô hình trước khi tạo hội thoại')
    await this.release(projectId)
    const generation = this.generations.get(projectId) ?? 0
    await this.ensureEntry(projectId, recipient, () => this.active(projectId, generation), undefined, true)
    return this.snapshot(projectId)
  }

  async switchSession(projectId: string, id: string): Promise<AgentSessionSnapshot> {
    this.assertIdle(projectId)
    const recipient = await this.recipient()
    if (!recipient) throw new AgentError('ai_not_configured', 'Chọn mô hình trước khi mở hội thoại')
    const root = realpathSync.native(await this.deps.rootOf(projectId))
    if (!this.store.list(this.scope(projectId, root, recipient)).some((item) => item.id === id)) {
      throw new AgentError('session_not_found', 'Hội thoại không thuộc tài khoản và dự án đang chọn')
    }
    await this.release(projectId)
    const generation = this.generations.get(projectId) ?? 0
    await this.ensureEntry(projectId, recipient, () => this.active(projectId, generation), id)
    return this.snapshot(projectId)
  }

  async renameSession(projectId: string, id: string, title: string): Promise<void> {
    this.assertIdle(projectId)
    const recipient = await this.recipient()
    if (!recipient) throw new AgentError('ai_not_configured', 'Chưa chọn mô hình')
    const root = realpathSync.native(await this.deps.rootOf(projectId))
    if (!recipient.isCurrent()) throw providerChanged()
    this.store.rename(this.scope(projectId, root, recipient), id, title)
    const entry = this.entries.get(projectId)
    if (entry?.stored.record.id === id) {
      entry.stored.record.title = title.trim()
      entry.stored.manager.appendSessionInfo(title.trim())
    }
  }

  async deleteSession(projectId: string, id: string): Promise<void> {
    this.assertIdle(projectId)
    const recipient = await this.recipient()
    if (!recipient) throw new AgentError('ai_not_configured', 'Chưa chọn mô hình')
    const root = realpathSync.native(await this.deps.rootOf(projectId))
    if (!recipient.isCurrent()) throw providerChanged()
    if (this.entries.get(projectId)?.stored.record.id === id) await this.release(projectId)
    this.store.remove(this.scope(projectId, root, recipient), id)
  }

  private assertEditable(projectId: string, file: string): void {
    const canonical = (value: string) => {
      const normalized = posix.normalize(value.replace(/\\/g, '/'))
      return process.platform === 'win32' ? normalized.toLowerCase() : normalized
    }
    if (this.deps.editorState?.(projectId).some((state) => state.dirty && canonical(state.file) === canonical(file))) {
      throw new AgentError('conflict', 'Tệp đang có bản nháp chưa lưu trong trình soạn thảo. Lưu hoặc đóng bản nháp trước khi trợ lý sửa.')
    }
  }

  private async checkpointStore(projectId: string, taskId: string): Promise<{ store: CheckpointStore; scope: SessionScope }> {
    if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new AgentError('bad_param', 'Mã tác vụ không hợp lệ')
    const recipient = await this.recipient()
    if (!recipient) throw new AgentError('ai_not_configured', 'Chưa chọn mô hình')
    const root = realpathSync.native(await this.deps.rootOf(projectId))
    const scope = this.scope(projectId, root, recipient)
    const directory = this.store.directory(scope)
    const manifest = join(directory, 'tasks', taskId + '.json')
    if (!existsSync(manifest)) throw new AgentError('task_not_found', 'Tác vụ không thuộc hội thoại của tài khoản và dự án hiện tại')
    const task = JSON.parse(readFileSync(manifest, 'utf8')) as AgentTask
    if (task.id !== taskId || !this.store.list(this.scope(projectId, root, recipient)).some((item) => item.id === task.sessionId)) {
      throw new AgentError('task_not_found', 'Không tìm thấy hội thoại của tác vụ')
    }
    if (!recipient.isCurrent()) throw providerChanged()
    return { scope, store: new CheckpointStore(root, join(directory, 'checkpoints'), taskId, (file) => this.assertEditable(projectId, file)) }
  }

  async checkpoints(projectId: string, taskId: string): Promise<AgentCheckpointInfo[]> {
    return (await this.checkpointStore(projectId, taskId)).store.list()
  }
  async rollback(projectId: string, taskId: string): Promise<AgentRollbackResult> {
    this.assertIdle(projectId)
    this.rollbacks.add(projectId)
    try {
      const { store, scope } = await this.checkpointStore(projectId, taskId)
      const result = await store.rollback()
      const task = this.store.recordRollback(scope, taskId, store.list().filter((item) => !item.restored).map((item) => item.id))
      const entry = this.entries.get(projectId)
      if (entry && (entry.task?.id ?? entry.stored.record.task?.id) === taskId) {
        entry.task = task
        entry.stored.record.task = task
        this.deps.emit(projectId, { type: 'task', task })
      }
      if (result.restored.length) await this.refreshGraph(projectId)
      return result
    } finally {
      this.rollbacks.delete(projectId)
    }
  }

  private async refreshGraph(projectId: string): Promise<void> {
    try { await this.deps.api.refresh(projectId) } catch {
      this.deps.emit(projectId, { type: 'write_conflict', message: 'Thay đổi tệp đã được ghi. Chưa cập nhật được đồ thị, hãy lập chỉ mục lại sau khi engine sẵn sàng.' })
    }
  }

  async prompt(projectId: string, text: string, target: AiConsentTarget, options?: AgentPromptOptions): Promise<void> {
    this.assertIdle(projectId)
    if (typeof text !== 'string' || !text.trim() || text.length > 200_000) throw new AgentError('bad_param', 'Câu hỏi trống hoặc vượt 200.000 ký tự')
    const generation = this.generations.get(projectId) ?? 0
    const active = (): boolean => this.active(projectId, generation)
    this.starting.set(projectId, generation)
    try {
      const recipient = await this.recipient()
      if (!active()) return
      if (!recipient) throw new AgentError('ai_not_configured', 'Chưa cấu hình trợ lý AI')
      const accounts = await this.deps.accounts()
      const consent = await accounts.hasConsent(projectId, target)
      if (!active()) return
      if (!recipient.isCurrent() || !sameConsentTarget(recipient.target, target)) throw providerChanged()
      if (!consent) throw new AgentError('consent_required', 'Chưa đồng ý gửi dữ liệu tới nhà cung cấp AI')
      const entry = await this.ensureEntry(projectId, recipient, active)
      if (!entry || !active()) return
      if (entry.busy) throw new AgentError('agent_busy', 'Trợ lý đang trả lời')
      entry.busy = true
      entry.stopped = false
      entry.dispatchBlocked = false
      entry.limitError = undefined
      entry.text = ''
      entry.tools.clear()
      entry.taskUsage = emptyUsage()
      entry.pricing = recipient.pricing
      entry.controller = new AbortController()
      const task: AgentTask = {
        id: randomUUID(), sessionId: entry.stored.record.id, status: 'running', startedAt: Date.now(),
        turns: 0, limits: this.getLimits(projectId), checkpointIds: []
      }
      entry.task = task
      const settings = this.getExecution(projectId)
      entry.execution = new TaskExecution({
        root: entry.stored.scope.root, taskId: task.id, storageDir: join(entry.stored.directory, 'checkpoints'),
        ...settings, allowCommands: settings.allowCommands && this.getMode(projectId) === 'edit', signal: entry.controller.signal,
        assertCurrent: () => this.assertTaskCurrent(projectId, entry), gate: entry.gate,
        assertEditable: (file) => this.assertEditable(projectId, file),
        sourceExcludes: () => this.deps.api.aiSourceExcludes(projectId),
        onOutput: (output) => {
          if (active() && !entry.stopped) this.deps.emit(projectId, { type: 'command_output', ...output, delta: cleanAgentText(output.delta, 16_000) })
        }
      })
      this.persistTask(projectId, entry)
      const timer = setTimeout(() => this.limit(projectId, entry, 'Đã đạt giới hạn thời gian của tác vụ'), task.limits.maxDurationMs)
      try {
        const context = await prepareAgentContext({ root: entry.stored.scope.root, api: this.deps.api, projectId, items: options?.context ?? [] })
        this.assertTaskCurrent(projectId, entry)
        entry.stored.manager.appendCustomEntry('nexgraph_input', { text: cleanAgentText(text, 200_000), context: context.items })
        this.store.touch(entry.stored, recipient.model.id, cleanAgentText(text, 200_000))
        const planning = this.getMode(projectId) === 'plan' ? '\n\nHãy lập kế hoạch cụ thể, nêu tệp và kiểm thử dự kiến. Chỉ đọc và phân tích trong lượt này.' : ''
        const result = await this.run(projectId, entry, recipient.model, text + planning + (context.prompt ? '\n\n' + context.prompt : ''), active)
        if (active()) {
          const completed = result.type === 'done'
          const error = result.type === 'error' ? result.message : undefined
          task.status = completed ? 'completed' : entry.stopped && !entry.limitError ? 'cancelled' : 'failed'
          task.finishedAt = Date.now()
          if (error) task.error = error
          if (completed) entry.stored.manager.appendCustomEntry('nexgraph_result', {
            text: cleanAgentText(result.text, 200_000), citations: result.citations, tools: [...entry.tools.values()]
          })
          this.persistTask(projectId, entry)
          this.deps.emit(projectId, result)
          this.deps.emit(projectId, { type: 'usage', usage: transcriptUsage(entry.stored) })
        }
      } catch (error) {
        if (active()) {
          task.status = entry.stopped && !entry.limitError ? 'cancelled' : 'failed'
          task.finishedAt = Date.now()
          task.error = entry.limitError ?? (error instanceof Error ? scrub(error.message) : 'Không khởi động được tác vụ')
          this.persistTask(projectId, entry)
          throw error
        }
      } finally {
        clearTimeout(timer)
        if (entry.execution?.checkpoints.list().length) await this.refreshGraph(projectId)
        entry.busy = false
        entry.execution = undefined
      }
    } catch (error) {
      if (active()) throw error
    } finally {
      if (this.starting.get(projectId) === generation) this.starting.delete(projectId)
    }
  }

  private assertTaskCurrent(projectId: string, entry: Entry): void {
    if (entry.limitError) throw new AgentError('agent_limit', entry.limitError)
    if (this.entries.get(projectId) !== entry || !entry.busy || entry.stopped || entry.controller?.signal.aborted) throw new AgentError('ai_cancelled', 'Đã dừng')
    if (!entry.isCurrent()) throw providerChanged()
  }

  private persistTask(projectId: string, entry: Entry): void {
    if (!entry.task) return
    if (entry.execution) entry.task.checkpointIds = entry.execution.checkpoints.list().map((item) => item.id)
    this.store.task(entry.stored, entry.task)
    if (this.entries.get(projectId) === entry && entry.isCurrent()) {
      this.deps.emit(projectId, { type: 'task', task: { ...entry.task } })
    }
  }

  private limit(projectId: string, entry: Entry, message: string): void {
    if (!entry.busy || entry.limitError || this.entries.get(projectId) !== entry) return
    entry.limitError = message
    entry.controller?.abort()
    entry.gate.denyAll(message)
    void entry.session.then((session) => session.abort()).catch(() => {})
  }

  private async run(projectId: string, entry: Entry, model: Model, text: string, active: () => boolean): Promise<AgentEvent> {
    const closed = () => !active() || this.entries.get(projectId) !== entry
    try {
      const session = await entry.session
      if (closed()) return CANCELLED
      if (!entry.isCurrent()) return PROVIDER_CHANGED
      if (session.model?.provider !== model.provider || session.model?.id !== model.id) await session.setModel(model)
      this.assertTaskCurrent(projectId, entry)
      await session.prompt(text, { expandPromptTemplates: false })
      if (closed()) return CANCELLED
      if (entry.limitError) return { type: 'error', code: 'agent_limit', message: entry.limitError }
      if (entry.dispatchBlocked || !entry.isCurrent()) return PROVIDER_CHANGED
      const last = session.messages.filter((message) => message.role === 'assistant').at(-1) as { stopReason?: string; errorMessage?: string } | undefined
      if (last?.stopReason === 'aborted') return CANCELLED
      if (last?.stopReason === 'error') return providerError(last.errorMessage ?? '')
      const citations = await verifyCitations(this.deps.api, projectId, entry.text)
      return closed() ? CANCELLED : { type: 'done', text: entry.text, citations }
    } catch (error) {
      if (closed()) return CANCELLED
      if (entry.limitError) return { type: 'error', code: 'agent_limit', message: entry.limitError }
      if (entry.dispatchBlocked || !entry.isCurrent()) return PROVIDER_CHANGED
      return providerError(error instanceof Error ? error.message : String(error))
    }
  }

  async abort(projectId: string): Promise<void> {
    const entry = this.entries.get(projectId)
    const hadTurn = this.starting.has(projectId) || entry?.busy === true
    this.invalidate(projectId)
    if (hadTurn) this.deps.emit(projectId, CANCELLED)
    if (!entry) return
    entry.stopped = true
    entry.controller?.abort()
    entry.gate.denyAll('Đã dừng')
    if (entry.task && ['running', 'waiting_approval'].includes(entry.task.status)) {
      entry.task.status = 'cancelled'
      entry.task.finishedAt = Date.now()
      this.persistTask(projectId, entry)
    }
    try { await (await entry.session).abort() } catch { /* Session creation may already have failed. */ }
    entry.gate.denyAll('Đã dừng')
  }

  close(projectId: string): void {
    this.invalidate(projectId)
    this.executionSettings.delete(projectId)
    const entry = this.entries.get(projectId)
    if (entry) this.discard(projectId, entry, 'Đã đóng dự án')
  }
  selectionChanged(): void {
    for (const [projectId, entry] of this.entries) this.discardIfStale(projectId, entry)
  }

  private discardIfStale(projectId: string, entry: Entry): boolean {
    if (entry.isCurrent()) return false
    const hadTurn = entry.busy || this.starting.has(projectId)
    this.invalidate(projectId)
    this.discard(projectId, entry, PROVIDER_CHANGED.message)
    if (hadTurn) this.deps.emit(projectId, PROVIDER_CHANGED)
    return true
  }

  private discard(projectId: string, entry: Entry, reason: string): void {
    this.entries.delete(projectId)
    entry.stopped = true
    entry.controller?.abort()
    entry.gate.denyAll(reason)
    if (entry.task && ['running', 'waiting_approval'].includes(entry.task.status)) {
      entry.task.status = 'cancelled'
      entry.task.finishedAt = Date.now()
      entry.task.error = reason
      this.persistTask(projectId, entry)
    }
    void entry.session.then(async (session) => {
      try { await session.abort() } catch { /* Failed sessions still need disposal. */ }
      session.dispose()
    }).catch(() => {})
  }

  private async release(projectId: string): Promise<void> {
    this.invalidate(projectId)
    const entry = this.entries.get(projectId)
    if (!entry) return
    this.discard(projectId, entry, 'Đã đổi hội thoại')
    try { (await entry.session).dispose() } catch { /* Creation failure has already been reported. */ }
  }

  closeAll(): void {
    for (const projectId of new Set([...this.entries.keys(), ...this.starting.keys()])) this.close(projectId)
  }

  private ensureEntry(projectId: string, recipient: Recipient, active: () => boolean, id?: string, fresh = false): Promise<Entry | undefined> {
    const existing = this.entries.get(projectId)
    if (existing && !existing.failed && existing.isCurrent() && sameConsentTarget(existing.target, recipient.target) && !fresh && (!id || id === existing.stored.record.id)) return Promise.resolve(existing)
    const pending = this.opening.get(projectId)
    if (pending) return pending.then(() => this.ensureEntry(projectId, recipient, active, id, fresh))
    if (existing) this.discard(projectId, existing, PROVIDER_CHANGED.message)
    const opening = this.open(projectId, recipient, active, id, fresh)
    this.opening.set(projectId, opening)
    void opening.finally(() => { if (this.opening.get(projectId) === opening) this.opening.delete(projectId) }).catch(() => {})
    return opening
  }

  private async open(projectId: string, recipient: Recipient, active: () => boolean, id?: string, fresh = false): Promise<Entry | undefined> {
    const root = realpathSync.native(await this.deps.rootOf(projectId))
    if (!active()) return
    if (!recipient.isCurrent()) throw providerChanged()
    const stored = await this.store.open(this.scope(projectId, root, recipient), recipient.model.id, id, fresh)
    if (!active()) return
    if (!recipient.isCurrent()) throw providerChanged()
    const emit = (event: AgentEvent) => this.deps.emit(projectId, event)
    const entry = {
      target: recipient.target, isCurrent: recipient.isCurrent, busy: false, text: '', stopped: false,
      dispatchBlocked: false, stored, taskUsage: emptyUsage(), tools: new Map(), pricing: recipient.pricing
    } as Entry
    const consentBase = new URL(entry.target.baseUrl)
    entry.gate = createApprovalGate({
      root, getMode: () => this.getMode(projectId),
      getPolicy: () => entry.execution?.policy ?? 'review', canRunCommands: () => !!entry.execution?.allowCommands && !entry.stopped,
      ask: (request) => {
        this.assertTaskCurrent(projectId, entry)
        if (entry.task) { entry.task.status = 'waiting_approval'; this.persistTask(projectId, entry) }
        emit({ type: 'approval', request })
      },
      closed: (approvalId) => {
        emit({ type: 'approval_closed', id: approvalId })
        if (entry.task?.status === 'waiting_approval') { entry.task.status = 'running'; this.persistTask(projectId, entry) }
      },
      preview: (tool, input) => previewWrite(root, tool, input, (file) => this.assertEditable(projectId, file))
    })
    const create = this.deps.createSession ?? createPiSession
    entry.session = create({
      cwd: root, agentDir: join(this.deps.dataDir, 'agent'), tools: toolsFor('edit'),
      sessionManager: stored.manager,
      extension: createNexgraphExtension({
        api: this.deps.api, projectId, root, gate: entry.gate,
        getMode: () => this.getMode(projectId), getTask: () => !entry.stopped && entry.busy ? entry.execution ?? null : null,
        assertEditable: (file) => this.assertEditable(projectId, file),
        onCheckpoint: () => this.persistTask(projectId, entry),
        onWriteConflict: (message) => {
          if (this.entries.get(projectId) === entry && !entry.stopped) emit({ type: 'write_conflict', message })
        }
      }),
      modelRuntime: recipient.modelRuntime, model: recipient.model,
      beforeModelTurn: () => {
        this.assertTaskCurrent(projectId, entry)
        const task = entry.task!
        const tokens = entry.taskUsage.inputTokens + entry.taskUsage.outputTokens + entry.taskUsage.cacheReadTokens + entry.taskUsage.cacheWriteTokens
        if (tokens >= task.limits.maxTokens) {
          this.limit(projectId, entry, 'Đã đạt ngân sách token của tác vụ')
          throw new AgentError('agent_limit', entry.limitError!)
        }
        if (task.turns >= task.limits.maxTurns) {
          this.limit(projectId, entry, 'Đã đạt giới hạn số lượt gọi mô hình của tác vụ')
          throw new AgentError('agent_limit', entry.limitError!)
        }
        task.turns++
        this.persistTask(projectId, entry)
      },
      remainingTokens: () => {
        const used = entry.taskUsage.inputTokens + entry.taskUsage.outputTokens + entry.taskUsage.cacheReadTokens + entry.taskUsage.cacheWriteTokens
        return Math.max(0, (entry.task?.limits.maxTokens ?? DEFAULT_RUN_LIMITS.maxTokens) - used)
      },
      assertDispatch: (requestModel, resolvedEndpoint) => {
        this.assertTaskCurrent(projectId, entry)
        if (!entry.isCurrent() || requestModel.provider !== entry.target.provider ||
            (resolvedEndpoint && !sameConsentTarget(entry.target, normalizeConsentTarget(requestModel.provider, requestModel.baseUrl, entry.target.accountId)))) {
          entry.dispatchBlocked = true
          throw providerChanged()
        }
      },
      assertRequest: (url) => {
        if (!inConsentBase(consentBase, url)) { entry.dispatchBlocked = true; throw providerChanged() }
      }
    }).then((session) => {
      session.setActiveToolsByName(toolsFor(this.getMode(projectId), projectId))
      session.subscribe((event) => this.onEvent(projectId, entry, event))
      return session
    })
    entry.session.catch(() => { entry.failed = true })
    this.entries.set(projectId, entry)
    emit({ type: 'session', sessionId: stored.record.id })
    return entry
  }

  private onEvent(projectId: string, entry: Entry, event: AgentSessionEvent): void {
    if (this.entries.get(projectId) !== entry || entry.stopped) return
    const emit = (value: AgentEvent) => this.deps.emit(projectId, value)
    if (event.type === 'message_update') {
      const message = event.assistantMessageEvent
      if (message.type === 'text_delta') { entry.text += message.delta; emit({ type: 'text', delta: message.delta }) }
      else if (message.type === 'thinking_delta') emit({ type: 'thinking', delta: cleanAgentText(message.delta, 8000) })
    } else if (event.type === 'tool_execution_start') {
      emit({ type: 'tool', name: event.toolName, status: 'start' })
      const tool: AgentToolRun = {
        id: event.toolCallId ?? randomUUID(), name: event.toolName, input: cleanAgentText(JSON.stringify(event.args ?? {}), 8000),
        output: '', status: 'running', startedAt: Date.now()
      }
      entry.tools.set(tool.id, tool)
      emit({ type: 'tool_detail', tool: { ...tool } })
    } else if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
      const id = event.toolCallId ?? [...entry.tools.values()].findLast((tool) => tool.name === event.toolName && tool.status === 'running')?.id
      const tool = id && entry.tools.get(id)
      if (event.type === 'tool_execution_end') emit({ type: 'tool', name: event.toolName, status: 'end', error: event.isError })
      if (!tool) return
      const output = event.type === 'tool_execution_end' ? event.result : event.partialResult
      tool.output = cleanAgentText(messageText(output?.content) || JSON.stringify(output?.details ?? {}), 32_000)
      if (event.type === 'tool_execution_end') { tool.status = event.isError ? 'failed' : 'completed'; tool.durationMs = Date.now() - tool.startedAt }
      emit({ type: 'tool_detail', tool: { ...tool } })
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      this.recordUsage(projectId, entry, event.message)
    } else if (event.type === 'auto_retry_start') {
      emit({ type: 'retry', attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs, message: scrub(event.errorMessage) })
    } else if (event.type === 'compaction_start' || event.type === 'compaction_end') {
      emit({ type: 'compaction', active: event.type === 'compaction_start' })
      if (event.type === 'compaction_end' && event.result?.usage) this.recordUsage(projectId, entry, { usage: event.result.usage })
    }
  }

  private recordUsage(projectId: string, entry: Entry, message: { usage?: unknown }): void {
    const usage = usageFromMessage(message, entry.pricing === 'known' || entry.pricing === 'free')
    if (entry.pricing === 'free') usage.costUsd = 0
    const first = entry.taskUsage.inputTokens + entry.taskUsage.outputTokens + entry.taskUsage.cacheReadTokens + entry.taskUsage.cacheWriteTokens === 0
    entry.taskUsage = first ? usage : addUsage(entry.taskUsage, usage)
    // A completed provider response may be billable even if the user then cancels,
    // closes the project or changes accounts. Latest per-task totals avoid replay duplication.
    if (entry.task) entry.stored.manager.appendCustomEntry('nexgraph_usage', { ...entry.taskUsage, taskId: entry.task.id })
    this.deps.emit(projectId, { type: 'usage', usage: transcriptUsage(entry.stored) })
    if (entry.task && entry.taskUsage.inputTokens + entry.taskUsage.outputTokens + entry.taskUsage.cacheReadTokens + entry.taskUsage.cacheWriteTokens > entry.task.limits.maxTokens) {
      this.limit(projectId, entry, 'Đã đạt ngân sách token của tác vụ')
    }
  }
}
