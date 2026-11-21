import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join, posix } from 'node:path'
import { Type } from 'typebox'
import type { AgentCheckpointInfo, AgentEvent, AgentExecutionSettings, AgentMode, AgentPromptOptions, AgentRunLimits, AgentSessionInfo, AgentSessionSnapshot, AgentTask, AgentToolRun, AgentUsage, AiConsentTarget, GeminiConsentTarget } from '../../shared/agent-types'
import { sameConsentTarget } from '../../shared/agent-types'
import type { GeminiConnectionTest } from '../../shared/gemini-types'
import { verifyCitations } from '../ai/citations'
import { createApprovalGate, type ApprovalGate } from '../agent/approval'
import { CheckpointStore } from '../agent/checkpoints'
import { prepareAgentContext } from '../agent/context'
import { previewWrite, toolsFor } from '../agent/extension'
import { TaskExecution } from '../agent/process-tools'
import { AgentError, DEFAULT_RUN_LIMITS } from '../agent/session'
import { NEXGRAPH_RULES } from '../agent/skill'
import type { EngineApi } from '../engine/api'
import { brokerPermission, GeminiMcpBroker, nexgraphBrokerTools, type BrokerTool } from './broker'
import { GeminiSessions, validNativeSessionId, type GeminiSessionScope, type GeminiStoredSession } from './sessions'

export interface GeminiAcpClient {
  /** Empty, private transport workspace. Never pass the source root to ACP. */
  sessionCwd: string
  initializeResult?: { agentCapabilities?: { loadSession?: boolean } }
  request<T>(method: string, params: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<T>
  notify(method: string, params: unknown): void
  setHandlers(handlers: { onNotification?(method: string, params: unknown): void; onRequest?(method: string, params: unknown): Promise<unknown>; onClose?(error: Error): void }): void
  closed(): boolean
  close(): Promise<void>
}
export type GeminiAgentDeps = {
  api: EngineApi
  dataDir: string
  rootOf(projectId: string): Promise<string>
  emit(projectId: string, event: AgentEvent): void
  consentTarget(): GeminiConsentTarget | null | Promise<GeminiConsentTarget | null>
  hasConsent(projectId: string, target: GeminiConsentTarget): Promise<boolean>
  connection: {
    connectionIdentity(): string
    selectedModel(): string
    createClient(root: string, handlers?: object, options?: { maxTurns?: number; mcpTools?: string[]; signal?: AbortSignal }): Promise<GeminiAcpClient>
    rememberSession?(value: unknown): void
    configureSession(client: GeminiAcpClient, sessionId: string, response: unknown): Promise<void>
  }
  editorState?(projectId: string): { file: string; dirty: boolean }[]
}
type Entry = {
  scope: GeminiSessionScope
  target: GeminiConsentTarget
  stored: GeminiStoredSession
  gate: ApprovalGate
  busy: boolean
  stopped: boolean
  text: string
  tools: Map<string, AgentToolRun>
  task?: AgentTask
  execution?: TaskExecution
  controller?: AbortController
  client?: GeminiAcpClient
  broker?: GeminiMcpBroker
  closing?: Promise<void>
  opening?: Promise<void>
  generation: number
  error?: string
  errorCode?: string
  acceptUpdates?: boolean
  clientMaxTurns?: number
}
const emptyUsage = (): AgentUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null })
const safe = (value: string, limit = 200_000) => value.slice(0, limit).replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [ẩn]').replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[khóa đã ẩn]').replace(/([?&](?:access_token|refresh_token|id_token|token|code|code_verifier|client_secret)=)[^\s&#]*/gi, '$1[ẩn]')
const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const failed = (code: string, message: string) => new AgentError(code, message)
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

/** Official CLI owns inference and authentication. NexGraph owns tools, consent and task lifecycle. */
export class GeminiAgentService {
  private readonly store: GeminiSessions
  private readonly entries = new Map<string, Entry>()
  private readonly modes = new Map<string, AgentMode>()
  private readonly settings = new Map<string, AgentExecutionSettings>()
  private readonly limits = new Map<string, AgentRunLimits>()
  private readonly starts = new Map<string, number>()
  private readonly generations = new Map<string, number>()
  private readonly rollbacks = new Set<string>()
  private probing = false
  private probe?: { controller: AbortController; client?: GeminiAcpClient; broker: GeminiMcpBroker }

  constructor(private readonly deps: GeminiAgentDeps) { this.store = new GeminiSessions(deps.dataDir) }
  getMode(pid: string): AgentMode { return this.modes.get(pid) ?? 'ask' }
  getExecution(pid: string): AgentExecutionSettings { return { ...(this.settings.get(pid) ?? { policy: 'review', allowCommands: false }) } }
  getLimits(pid: string): AgentRunLimits { return { ...(this.limits.get(pid) ?? DEFAULT_RUN_LIMITS) } }
  private idle(pid: string): void { if (this.probing || this.starts.has(pid) || this.entries.get(pid)?.busy || this.rollbacks.has(pid)) throw failed('agent_busy', 'Trợ lý đang chạy. Bấm Dừng trước khi đổi hội thoại hoặc quyền.') }
  setExecution(pid: string, settings: AgentExecutionSettings): void {
    this.idle(pid)
    if (!settings || !['review', 'auto'].includes(settings.policy) || typeof settings.allowCommands !== 'boolean') throw failed('bad_param', 'Quyền thực thi không hợp lệ')
    this.settings.set(pid, { ...settings })
  }
  setLimits(pid: string, limits: AgentRunLimits): void {
    this.idle(pid)
    if (!limits || ![limits.maxTurns, limits.maxDurationMs, limits.maxTokens].every((value) => Number.isSafeInteger(value) && value > 0) || limits.maxDurationMs > 2_147_483_647 || limits.maxTurns > 200) throw failed('bad_param', 'Giới hạn tác vụ Gemini không hợp lệ')
    this.limits.set(pid, { ...limits })
  }
  async setMode(pid: string, mode: AgentMode): Promise<void> {
    if (!['ask', 'plan', 'edit'].includes(mode)) throw failed('bad_param', 'Chế độ trợ lý không hợp lệ')
    const entry = this.entries.get(pid)
    if (entry?.busy || this.starts.has(pid)) await this.abort(pid)
    this.modes.set(pid, mode)
    entry?.gate.denyAll('Đã đổi chế độ')
    if (entry) await this.stopClient(entry)
  }
  approve(pid: string, id: string, allow: boolean): void {
    const entry = this.entries.get(pid)
    if (entry && this.current(pid, entry)) entry.gate.resolve(id, allow)
  }
  pending(pid: string): number { return this.entries.get(pid)?.gate.pending() ?? 0 }
  private current(pid: string, entry: Entry): boolean { return this.entries.get(pid) === entry && entry.target.connectionId === this.deps.connection.connectionIdentity() && entry.generation === (this.generations.get(pid) ?? 0) }
  private assertTask(pid: string, entry: Entry): void {
    if (!this.current(pid, entry)) throw failed('ai_provider_changed', 'Kết nối Gemini đã thay đổi. Hãy gửi lại câu hỏi.')
    if (!entry.busy || entry.stopped || entry.controller?.signal.aborted) throw failed(entry.errorCode ?? 'ai_cancelled', entry.error ?? 'Đã dừng tác vụ')
  }
  private assertEditable(pid: string, file: string): void {
    const canonical = (value: string) => { const path = posix.normalize(value.replace(/\\/g, '/')); return process.platform === 'win32' ? path.toLowerCase() : path }
    if (this.deps.editorState?.(pid).some((item) => item.dirty && canonical(item.file) === canonical(file))) throw failed('conflict', 'Tệp đang có bản nháp chưa lưu. Lưu hoặc đóng bản nháp trước khi trợ lý sửa hoặc hoàn tác.')
  }
  private async scope(pid: string): Promise<{ scope: GeminiSessionScope; target: GeminiConsentTarget } | null> {
    const target = await this.deps.consentTarget()
    if (!target) return null
    if (target.runtime !== 'antigravity-cli' || target.connectionId !== this.deps.connection.connectionIdentity()) throw failed('ai_provider_changed', 'Kết nối Gemini đã thay đổi')
    const root = realpathSync.native(await this.deps.rootOf(pid))
    if (!sameConsentTarget(target, await this.deps.consentTarget()) || target.connectionId !== this.deps.connection.connectionIdentity()) throw failed('ai_provider_changed', 'Kết nối Gemini đã thay đổi')
    return { scope: { projectId: pid, root, connectionId: target.connectionId }, target: { ...target } }
  }
  private async entry(pid: string, id?: string, fresh = false, options?: { announce?: boolean }): Promise<Entry | undefined> {
    const generation = this.generations.get(pid) ?? 0
    const selected = await this.scope(pid)
    if (!selected) return
    if (generation !== (this.generations.get(pid) ?? 0) || selected.target.connectionId !== this.deps.connection.connectionIdentity()) throw failed('ai_cancelled', 'Dự án hoặc kết nối đã đổi trong khi mở hội thoại')
    const existing = this.entries.get(pid)
    if (existing && this.current(pid, existing) && existing.scope.root === selected.scope.root && existing.scope.projectId === selected.scope.projectId && existing.scope.connectionId === selected.scope.connectionId && !fresh && (!id || existing.stored.info.id === id)) return existing
    if (existing) {
      const releasedGeneration = await this.release(pid)
      const current = await this.scope(pid)
      if (releasedGeneration !== (this.generations.get(pid) ?? 0) || !current || current.scope.root !== selected.scope.root || !sameConsentTarget(current.target, selected.target)) throw failed('ai_provider_changed', 'Dự án hoặc kết nối đã đổi trong khi đóng hội thoại cũ')
    }
    const stored = this.store.open(selected.scope, this.deps.connection.selectedModel(), id, fresh)
    const entry: Entry = {
      ...selected, stored, busy: false, stopped: false, text: '', tools: new Map(), generation: this.generations.get(pid) ?? 0,
      gate: undefined as unknown as ApprovalGate
    }
    const emit = (event: AgentEvent) => { if (this.current(pid, entry)) this.deps.emit(pid, event) }
    entry.gate = createApprovalGate({
      root: entry.scope.root, getMode: () => this.getMode(pid), getPolicy: () => entry.execution?.policy ?? 'review',
      canRunCommands: () => entry.busy && !entry.stopped && !!entry.execution?.allowCommands,
      preview: (tool, input) => previewWrite(entry.scope.root, tool, input, (file) => this.assertEditable(pid, file)),
      ask: (request) => { this.assertTask(pid, entry); if (entry.task) { entry.task.status = 'waiting_approval'; this.save(pid, entry) }; emit({ type: 'approval', request }) },
      closed: (id) => { emit({ type: 'approval_closed', id }); if (entry.task?.status === 'waiting_approval') { entry.task.status = 'running'; this.save(pid, entry) } }
    })
    this.entries.set(pid, entry)
    if (options?.announce !== false) emit({ type: 'session', sessionId: stored.info.id })
    return entry
  }
  private save(pid: string, entry: Entry): void {
    if (!this.current(pid, entry)) return
    if (entry.execution && entry.task) entry.task.checkpointIds = entry.execution.checkpoints.list().filter((item) => !item.restored).map((item) => item.id)
    entry.stored.task = entry.task ?? entry.stored.task
    this.store.save(entry.scope, entry.stored)
    if (entry.task && this.current(pid, entry)) this.deps.emit(pid, { type: 'task', task: { ...entry.task } })
  }
  async snapshot(pid: string): Promise<AgentSessionSnapshot> {
    // A read must not announce a session change: the renderer uses that event
    // to invalidate older reads, including the snapshot currently being loaded.
    const entry = await this.entry(pid, undefined, false, { announce: false })
    if (entry && !this.current(pid, entry)) throw failed('ai_provider_changed', 'Kết nối đã thay đổi trong khi mở lịch sử hội thoại')
    return { runtime: 'antigravity-cli', session: entry?.stored.info ?? null, messages: entry?.stored.messages ?? [], task: entry?.task ?? entry?.stored.task ?? null,
      mode: this.getMode(pid), policy: this.getExecution(pid).policy, execution: this.getExecution(pid), limits: this.getLimits(pid), usage: entry?.stored.usage ?? emptyUsage() }
  }
  async listSessions(pid: string): Promise<AgentSessionInfo[]> { const selected = await this.scope(pid); return selected ? this.store.list(selected.scope) : [] }
  async newSession(pid: string): Promise<AgentSessionSnapshot> { this.idle(pid); await this.release(pid); await this.entry(pid, undefined, true); return this.snapshot(pid) }
  async switchSession(pid: string, id: string): Promise<AgentSessionSnapshot> { this.idle(pid); const selected = await this.scope(pid); if (!selected || !this.store.list(selected.scope).some((item) => item.id === id)) throw failed('session_not_found', 'Hội thoại không thuộc dự án và kết nối Gemini này'); await this.release(pid); await this.entry(pid, id); return this.snapshot(pid) }
  async renameSession(pid: string, id: string, title: string): Promise<void> {
    this.idle(pid); const selected = await this.scope(pid); if (!selected) throw failed('ai_not_configured', 'Chưa kết nối Gemini')
    this.store.rename(selected.scope, id, title)
    const entry = this.entries.get(pid); if (entry?.stored.info.id === id) entry.stored.info.title = title.trim()
  }
  async deleteSession(pid: string, id: string): Promise<void> {
    this.idle(pid); const selected = await this.scope(pid); if (!selected) throw failed('ai_not_configured', 'Chưa kết nối Gemini')
    if (this.entries.get(pid)?.stored.info.id === id) await this.release(pid)
    this.store.remove(selected.scope, id)
  }
  private async startClient(pid: string, entry: Entry): Promise<void> {
    await entry.closing
    this.assertTask(pid, entry)
    if (entry.client && entry.clientMaxTurns !== this.getLimits(pid).maxTurns) await this.stopClient(entry)
    if (entry.client && !entry.client.closed()) return
    if (entry.opening) return entry.opening
    entry.opening = (async () => {
      const taskId = entry.task?.id
      const assertCurrent = () => { this.assertTask(pid, entry); if (!taskId || entry.task?.id !== taskId) throw failed('ai_cancelled', 'Tác vụ công cụ đã kết thúc') }
      const belongs = () => this.current(pid, entry) && entry.task?.id === taskId && !entry.stopped
      const tools = nexgraphBrokerTools({
        api: this.deps.api, projectId: pid, root: entry.scope.root, gate: entry.gate,
        getMode: () => this.getMode(pid), getTask: () => entry.busy && !entry.stopped ? entry.execution ?? null : null,
        assertEditable: (file) => this.assertEditable(pid, file), assertCurrent, getSignal: () => entry.controller?.signal,
        onCheckpoint: () => this.save(pid, entry), onWriteConflict: (message) => { if (this.current(pid, entry)) this.deps.emit(pid, { type: 'write_conflict', message }) },
        onTool: (tool) => { if (!belongs()) return; entry.tools.set(tool.id, tool); this.deps.emit(pid, { type: 'tool', name: tool.name, status: tool.status === 'running' ? 'start' : 'end', error: tool.status === 'failed' }); this.deps.emit(pid, { type: 'tool_detail', tool }) }
      })
      const broker = new GeminiMcpBroker({ tools: () => tools.filter((tool) => toolsFor(this.getMode(pid), pid).includes(tool.name)), assertCurrent })
      entry.broker = broker
      const mcp = await broker.start()
      const client = await this.deps.connection.createClient(entry.scope.root, {}, { maxTurns: this.getLimits(pid).maxTurns, mcpTools: toolsFor(this.getMode(pid), pid), signal: entry.controller?.signal })
      try { this.assertTask(pid, entry) } catch (error) { await client.close(); throw error }
      entry.client = client
      entry.clientMaxTurns = this.getLimits(pid).maxTurns
      entry.acceptUpdates = false
      client.setHandlers({
        onNotification: (method, params) => this.onNotification(pid, entry, method, params),
        onRequest: async (method, params) => {
          // The profile permits only the NexGraph MCP tools. An unexpected direct
          // file, terminal or permission request never becomes a second write path.
          if (method === 'session/request_permission') { this.assertTask(pid, entry); return brokerPermission(params, entry.stored.nativeId, toolsFor(this.getMode(pid), pid)) }
          throw failed('protected_path', 'NexGraph chỉ cho phép công cụ qua cổng MCP được kiểm soát')
        },
        onClose: (error) => { if (entry.busy && !entry.stopped && this.current(pid, entry)) { entry.error = safe(error.message, 2000); entry.errorCode = 'ai_error'; entry.controller?.abort(); entry.gate.denyAll('Tiến trình Gemini đã dừng') } }
      })
      this.assertTask(pid, entry)
      let response: unknown
      if (entry.stored.nativeId) {
        if (!client.initializeResult?.agentCapabilities?.loadSession) throw failed('session_restore_unavailable', 'Phiên bản Antigravity CLI không hỗ trợ tiếp tục phiên đã lưu. Hãy tạo phiên mới.')
        response = await client.request('session/load', { sessionId: entry.stored.nativeId, cwd: client.sessionCwd, mcpServers: [mcp] }, { signal: entry.controller?.signal, timeoutMs: 45_000 })
      } else {
        response = await client.request('session/new', { cwd: client.sessionCwd, mcpServers: [mcp] }, { signal: entry.controller?.signal, timeoutMs: 45_000 })
        const sid = object(response).sessionId
        if (!validNativeSessionId(sid)) throw failed('ai_error', 'Antigravity CLI trả về mã hội thoại không hợp lệ')
        entry.stored.nativeId = sid
      }
      this.deps.connection.rememberSession?.(response)
      await this.deps.connection.configureSession(client, entry.stored.nativeId!, response)
      this.assertTask(pid, entry)
      const selected = this.deps.connection.selectedModel()
      const state = object(object(response).models)
      entry.stored.info.model = selected || String(state.currentModelId ?? 'auto')
      this.save(pid, entry)
    })().catch(async (error) => { await this.stopClient(entry); throw error }).finally(() => { entry.opening = undefined })
    return entry.opening
  }
  async prompt(pid: string, question: string, target: AiConsentTarget, options?: AgentPromptOptions): Promise<void> {
    this.idle(pid)
    if (typeof question !== 'string' || !question.trim() || question.length > 200_000) throw failed('bad_param', 'Câu hỏi trống hoặc vượt giới hạn')
    if (target.runtime !== 'antigravity-cli') throw failed('ai_provider_changed', 'Hãy chọn lại kết nối Gemini')
    const generation = this.generations.get(pid) ?? 0
    this.starts.set(pid, generation)
    let entry: Entry | undefined
    try {
      const active = await this.deps.consentTarget()
      if (!sameConsentTarget(active, target)) throw failed('ai_provider_changed', 'Kết nối Gemini đã thay đổi')
      if (!await this.deps.hasConsent(pid, target)) throw failed('consent_required', 'Chưa đồng ý gửi dữ liệu dự án tới Antigravity CLI/Google')
      if (generation !== (this.generations.get(pid) ?? 0)) return
      entry = await this.entry(pid)
      if (!entry || !sameConsentTarget(entry.target, target)) throw failed('ai_not_configured', 'Chưa kết nối Gemini')
      entry.busy = true; entry.stopped = false; entry.text = ''; entry.error = undefined; entry.errorCode = undefined; entry.tools.clear()
      entry.controller = new AbortController()
      entry.task = { id: randomUUID(), sessionId: entry.stored.info.id, status: 'running', startedAt: Date.now(), turns: 0, turnsKnown: false, runtime: 'antigravity-cli', limits: this.getLimits(pid), checkpointIds: [] }
      const taskId = entry.task.id
      const settings = this.getExecution(pid)
      entry.execution = new TaskExecution({ root: entry.scope.root, storageDir: join(this.store.directory(entry.scope), 'checkpoints'), taskId: entry.task.id,
        ...settings, allowCommands: settings.allowCommands && this.getMode(pid) === 'edit', signal: entry.controller.signal,
        assertCurrent: () => { this.assertTask(pid, entry!); if (entry!.task?.id !== taskId) throw failed('ai_cancelled', 'Tác vụ đã kết thúc') }, assertEditable: (file) => this.assertEditable(pid, file), gate: entry.gate,
        sourceExcludes: () => this.deps.api.aiSourceExcludes(pid), onOutput: (event) => { if (this.current(pid, entry!) && !entry!.stopped && entry!.task?.id === taskId) this.deps.emit(pid, { type: 'command_output', ...event, delta: safe(event.delta, 16_000) }) } })
      this.save(pid, entry)
      const currentEntry = entry
      const timer = setTimeout(() => { currentEntry.error = 'Đã đạt giới hạn thời gian của tác vụ'; currentEntry.errorCode = 'agent_limit'; void this.abort(pid) }, entry.task.limits.maxDurationMs)
      try {
        const context = await prepareAgentContext({ root: entry.scope.root, api: this.deps.api, projectId: pid, items: options?.context })
        this.assertTask(pid, entry)
        await this.startClient(pid, entry)
        this.assertTask(pid, entry)
        entry.stored.messages.push({ id: randomUUID(), role: 'user', text: safe(question), timestamp: Date.now(), citations: [], tools: [] })
        if (entry.stored.info.title === 'Hội thoại Gemini mới') entry.stored.info.title = safe(question.trim(), 100)
        this.save(pid, entry)
        const rules = `Bạn là trợ lý NexGraph. Chỉ dùng công cụ MCP nexgraph. Các đường dẫn dự án đều tương đối với công cụ NexGraph MCP; cwd của CLI là thư mục vận chuyển riêng, không chứa mã nguồn. Chế độ hiện tại: ${this.getMode(pid)}. Hỏi và Kế hoạch chỉ đọc; Sửa tuân thủ cổng duyệt. Khi trích dẫn dùng [[file:start-end]]. Không tự cấp quyền hoặc đổi cấu hình công cụ.\n${NEXGRAPH_RULES}\n\n`
        entry.acceptUpdates = true
        const result = await entry.client!.request<unknown>('session/prompt', { sessionId: entry.stored.nativeId, prompt: [{ type: 'text', text: rules + question + (context.prompt ? '\n\n' + context.prompt : '') }] }, { signal: entry.controller.signal, timeoutMs: entry.task.limits.maxDurationMs + 1000 })
        this.assertTask(pid, entry)
        this.recordUsage(entry, result)
        const stopReason = object(result).stopReason
        if (stopReason === 'cancelled') throw failed('ai_cancelled', 'Đã dừng tác vụ')
        if (stopReason === 'max_tokens' || stopReason === 'max_turn_requests') throw failed('agent_limit', stopReason === 'max_tokens' ? 'Gemini đã đạt giới hạn nội dung trả lời của tác vụ' : 'Gemini đã đạt giới hạn số lượt mô hình của tác vụ')
        if (stopReason === 'refusal') throw failed('ai_refused', 'Gemini từ chối thực hiện yêu cầu này')
        if (stopReason !== 'end_turn') throw failed('ai_error', `Gemini kết thúc với trạng thái không hợp lệ: ${String(stopReason)}`)
        const citations = await verifyCitations(this.deps.api, pid, entry.text)
        this.assertTask(pid, entry)
        entry.stored.messages.push({ id: randomUUID(), role: 'assistant', text: safe(entry.text), timestamp: Date.now(), citations, tools: [...entry.tools.values()] })
        entry.task.status = entry.error ? 'failed' : 'completed'; entry.task.finishedAt = Date.now(); if (entry.error) entry.task.error = entry.error
        this.save(pid, entry)
        this.deps.emit(pid, entry.error ? { type: 'error', code: 'agent_limit', message: entry.error } : { type: 'done', text: safe(entry.text), citations })
        this.deps.emit(pid, { type: 'usage', usage: { ...entry.stored.usage } })
      } catch (error) {
        if (this.current(pid, entry)) {
          const message = entry.error ?? safe(error instanceof Error ? error.message : String(error), 4000)
          entry.task.status = entry.stopped && !entry.error || (error as { code?: string }).code === 'ai_cancelled' ? 'cancelled' : 'failed'; entry.task.finishedAt = Date.now(); entry.task.error = message
          if ((entry.text || entry.tools.size) && entry.stored.messages.at(-1)?.role === 'user') entry.stored.messages.push({ id: randomUUID(), role: 'assistant', text: safe(entry.text), timestamp: Date.now(), citations: [], tools: [...entry.tools.values()] })
          this.save(pid, entry)
          if (!entry.stopped || entry.error) this.deps.emit(pid, { type: 'error', code: entry.errorCode ?? (error as { code?: string }).code ?? 'ai_error', message })
          this.deps.emit(pid, { type: 'usage', usage: { ...entry.stored.usage } })
        }
        await this.stopClient(entry)
      } finally {
        clearTimeout(timer)
        // Resume native history next task. A fresh process and broker bind tool
        // grants to this task; only the duration limit is enforceable upstream.
        await this.stopClient(entry)
        if (entry.execution?.checkpoints.list().length) await this.refresh(pid)
        entry.acceptUpdates = false; entry.busy = false; entry.execution = undefined; entry.gate.denyAll('Tác vụ đã kết thúc')
      }
    } finally { if (this.starts.get(pid) === generation) this.starts.delete(pid) }
  }
  private recordUsage(entry: Entry, result: unknown): void {
    const usage = object(object(result).usage)
    entry.stored.usage = { inputTokens: entry.stored.usage.inputTokens + finite(usage.inputTokens), outputTokens: entry.stored.usage.outputTokens + finite(usage.outputTokens),
      cacheReadTokens: entry.stored.usage.cacheReadTokens + finite(usage.cachedReadTokens), cacheWriteTokens: entry.stored.usage.cacheWriteTokens, costUsd: null }
    if (entry.task && finite(usage.inputTokens) + finite(usage.outputTokens) > entry.task.limits.maxTokens) { entry.error = 'Usage được Gemini báo vượt ngân sách token. Tác vụ đã dừng; đây không phải trần thanh toán của Google.'; entry.errorCode = 'agent_limit' }
  }
  private onNotification(pid: string, entry: Entry, method: string, params: unknown): void {
    if (!this.current(pid, entry) || !entry.busy || !entry.acceptUpdates || entry.stopped || method !== 'session/update') return
    const message = object(params)
    if (message.sessionId !== entry.stored.nativeId) return
    const update = object(message.update)
    const content = object(update.content)
    if (update.sessionUpdate === 'agent_message_chunk' && content.type === 'text' && typeof content.text === 'string') {
      const delta = safe(content.text, Math.max(0, 200_000 - entry.text.length))
      entry.text += delta
      if (delta) this.deps.emit(pid, { type: 'text', delta })
    } else if (update.sessionUpdate === 'agent_thought_chunk' && content.type === 'text' && typeof content.text === 'string') this.deps.emit(pid, { type: 'thinking', delta: safe(content.text, 8000) })
  }
  async abort(pid: string): Promise<void> {
    this.generations.set(pid, (this.generations.get(pid) ?? 0) + 1)
    const entry = this.entries.get(pid)
    const hadWork = this.starts.has(pid) || entry?.busy
    this.starts.delete(pid)
    if (!entry) { if (hadWork) this.deps.emit(pid, { type: 'error', code: 'ai_cancelled', message: 'Đã dừng' }); return }
    entry.generation = this.generations.get(pid)!
    entry.stopped = true; entry.acceptUpdates = false; entry.controller?.abort(); entry.gate.denyAll('Đã dừng')
    if (entry.task && ['running', 'waiting_approval'].includes(entry.task.status)) { entry.task.status = entry.error ? 'failed' : 'cancelled'; entry.task.finishedAt = Date.now(); if (entry.error) entry.task.error = entry.error; this.save(pid, entry) }
    try { if (entry.client && entry.stored.nativeId) entry.client.notify('session/cancel', { sessionId: entry.stored.nativeId }) } catch { /* Already closed. */ }
    await this.stopClient(entry)
    if (hadWork) this.deps.emit(pid, { type: 'error', code: entry.errorCode ?? 'ai_cancelled', message: entry.error ?? 'Đã dừng' })
  }
  private stopClient(entry: Entry): Promise<void> {
    if (entry.closing) return entry.closing
    const client = entry.client; const broker = entry.broker
    entry.client = undefined; entry.broker = undefined
    client?.setHandlers({})
    entry.closing = (async () => { await Promise.allSettled([client?.close(), broker?.close()]) })().finally(() => { entry.closing = undefined })
    return entry.closing
  }
  close(pid: string): void {
    const entry = this.entries.get(pid)
    this.generations.set(pid, (this.generations.get(pid) ?? 0) + 1); this.starts.delete(pid); this.settings.delete(pid)
    if (!entry) return
    entry.stopped = true; entry.controller?.abort(); entry.gate.denyAll('Đã đóng dự án')
    if (entry.task && ['running', 'waiting_approval'].includes(entry.task.status)) { entry.task.status = 'cancelled'; entry.task.finishedAt = Date.now(); this.store.save(entry.scope, { ...entry.stored, task: entry.task }) }
    this.entries.delete(pid); void this.stopClient(entry)
  }
  closeAll(): void {
    for (const pid of new Set([...this.entries.keys(), ...this.starts.keys()])) this.close(pid)
    if (this.probe) { this.probe.controller.abort(); void this.probe.client?.close(); void this.probe.broker.close() }
  }
  selectionChanged(): void { this.closeAll() }
  private async release(pid: string): Promise<number> {
    const entry = this.entries.get(pid); this.close(pid)
    const generation = this.generations.get(pid) ?? 0
    if (entry) await entry.closing
    return generation
  }
  private async taskStore(pid: string, taskId: string): Promise<{ entry: Entry; store: CheckpointStore; assertCurrent(): void }> {
    if (!UUID.test(taskId)) throw failed('bad_param', 'Mã tác vụ không hợp lệ')
    const entry = await this.entry(pid)
    if (!entry) throw failed('ai_not_configured', 'Chưa kết nối Gemini')
    this.store.task(entry.scope, taskId)
    const generation = entry.generation
    const assertCurrent = () => { if (!this.current(pid, entry) || entry.generation !== generation) throw failed('ai_provider_changed', 'Dự án hoặc kết nối đã thay đổi trong khi hoàn tác') }
    return { entry, assertCurrent, store: new CheckpointStore(entry.scope.root, join(this.store.directory(entry.scope), 'checkpoints'), taskId, (file) => { assertCurrent(); this.assertEditable(pid, file); assertCurrent() }) }
  }
  async checkpoints(pid: string, taskId: string): Promise<AgentCheckpointInfo[]> { return (await this.taskStore(pid, taskId)).store.list() }
  async rollback(pid: string, taskId: string) {
    this.idle(pid); this.rollbacks.add(pid)
    try {
      const { entry, store, assertCurrent } = await this.taskStore(pid, taskId)
      assertCurrent()
      const result = await store.rollback()
      assertCurrent()
      const task = this.store.task(entry.scope, taskId)
      task.checkpointIds = store.list().filter((item) => !item.restored).map((item) => item.id)
      this.store.saveTask(entry.scope, task)
      if (entry.stored.task?.id === taskId) { entry.stored.task = task; if (entry.task?.id === taskId) entry.task = task; this.save(pid, entry) }
      if (result.restored.length) await this.refresh(pid)
      return result
    } finally { this.rollbacks.delete(pid) }
  }
  private async refresh(pid: string): Promise<void> { try { await this.deps.api.refresh(pid) } catch { this.deps.emit(pid, { type: 'write_conflict', message: 'Thay đổi đã lưu. Chưa cập nhật được đồ thị; hãy lập chỉ mục lại khi engine sẵn sàng.' }) } }
  async testConnection(): Promise<GeminiConnectionTest> {
    if (this.probing || this.starts.size || [...this.entries.values()].some((entry) => entry.busy)) throw failed('agent_busy', 'Dừng tác vụ trước khi kiểm tra kết nối Gemini')
    this.probing = true
    const directory = join(this.deps.dataDir, 'antigravity', 'probes'); mkdirSync(directory, { recursive: true })
    const root = mkdtempSync(join(directory, 'probe-'))
    const nonce = randomUUID(); let called = false; let streaming = false
    const controller = new AbortController()
    const identity = this.deps.connection.connectionIdentity()
    let client: GeminiAcpClient | undefined
    const tool: BrokerTool = { name: 'nexgraph_probe', description: 'Read-only NexGraph connection check. Call once with the exact nonce provided by the user.', inputSchema: Type.Object({ nonce: Type.String() }),
      async execute(input) { if (object(input).nonce !== nonce) throw new Error('Mã kiểm tra không khớp'); called = true; return { content: [{ type: 'text', text: 'NEXGRAPH_GEMINI_TOOL_OK' }] } } }
    const assertCurrent = () => { if (!this.probing || controller.signal.aborted || identity !== this.deps.connection.connectionIdentity()) throw failed('ai_cancelled', 'Đã dừng kiểm tra') }
    const broker = new GeminiMcpBroker({ tools: () => [tool], assertCurrent })
    const probe = this.probe = { controller, broker, client: undefined as GeminiAcpClient | undefined }
    try {
      const mcp = await broker.start()
      client = await this.deps.connection.createClient(root, {}, { maxTurns: 3, mcpTools: ['nexgraph_probe'], signal: controller.signal })
      probe.client = client
      assertCurrent()
      let sid: string | null = null
      client.setHandlers({ onNotification: (method, params) => { if (method === 'session/update' && object(params).sessionId === sid && object(object(params).update).sessionUpdate === 'agent_message_chunk') streaming = true },
        onRequest: async (method, params) => { if (method === 'session/request_permission') return brokerPermission(params, sid, ['nexgraph_probe']); throw failed('protected_path', 'Chỉ cho phép công cụ kiểm tra kết nối') } })
      const created = await client.request<unknown>('session/new', { cwd: client.sessionCwd, mcpServers: [mcp] }, { timeoutMs: 45_000, signal: controller.signal })
      const createdId = object(created).sessionId
      if (typeof createdId !== 'string') throw failed('ai_error', 'Antigravity CLI chưa tạo được phiên kiểm tra')
      sid = createdId
      this.deps.connection.rememberSession?.(created)
      await this.deps.connection.configureSession(client, sid, created)
      const result = await client.request<unknown>('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: `This is a read-only connection test. Call the nexgraph_probe tool with nonce ${nonce}, then reply exactly NEXGRAPH_GEMINI_OK. Do not use other tools.` }] }, { timeoutMs: 90_000, signal: controller.signal })
      assertCurrent()
      const ok = called && streaming && object(result).stopReason === 'end_turn'
      return { ok, message: ok ? 'Gemini đã trả lời trực tiếp và gọi công cụ NexGraph thành công.' : 'Gemini chưa hoàn tất kiểm tra trả lời và công cụ. Hãy kiểm tra model, quyền tài khoản và thử lại.', capabilities: { streaming, tools: called } }
    } catch (error) { return { ok: false, message: safe(error instanceof Error ? error.message : String(error), 4000), capabilities: { streaming, tools: called } } }
    finally { controller.abort(); await Promise.allSettled([client?.close(), broker.close()]); this.probing = false; if (this.probe === probe) this.probe = undefined; rmSync(root, { recursive: true, force: true }) }
  }
}
