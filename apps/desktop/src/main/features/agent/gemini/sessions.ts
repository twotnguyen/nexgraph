import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentContextUsage, AgentSessionInfo, AgentTask, AgentTranscriptMessage, AgentUsage } from '../../../../shared/agent-types'
import { writeJson } from '../../../platform/settings'

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
/** Native ACP identifiers are opaque; only local NexGraph record IDs are UUIDs. */
export const validNativeSessionId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
const fail = (message: string) => Object.assign(new Error(message), { code: 'session_corrupt' })
export type GeminiSessionScope = { projectId: string; root: string; connectionId: string }
export type GeminiStoredSession = {
  version: 1
  scope: string
  info: AgentSessionInfo
  forkParentNativeId?: string
  nativeId: string | null
  messages: AgentTranscriptMessage[]
  forkMessageCount?: number
  task: AgentTask | null
  usage: AgentUsage
  /** Số context cuối cùng CLI báo qua usage_update; giữ lại để vòng context còn khi mở lại hội thoại. */
  context?: AgentContextUsage
}
type Index = { version: 1; scope: string; activeId: string | null; sessions: AgentSessionInfo[] }
const emptyUsage = (): AgentUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null })
const validTask = (task: AgentTask | null, sessionId: string) => task === null || !!task && UUID.test(task.id) && task.sessionId === sessionId &&
  ['running', 'waiting_approval', 'completed', 'failed', 'cancelled'].includes(task.status) && Number.isFinite(task.startedAt) &&
  Number.isSafeInteger(task.turns) && task.turns >= 0 && !!task.limits && [task.limits.maxTurns, task.limits.maxDurationMs, task.limits.maxTokens].every((value) => Number.isSafeInteger(value) && value > 0) &&
  (!task.checkpointIds || Array.isArray(task.checkpointIds) && task.checkpointIds.every((id) => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id)))

/** The CLI owns the model transcript. This stores only NexGraph-created session mappings and presentation data. */
export class GeminiSessions {
  constructor(private readonly dataDir: string) {}
  key(scope: GeminiSessionScope): string {
    return createHash('sha256').update(JSON.stringify(['antigravity-cli', scope.projectId, realpathSync.native(scope.root), scope.connectionId])).digest('hex')
  }
  directory(scope: GeminiSessionScope): string { return join(this.dataDir, 'antigravity', 'sessions', this.key(scope)) }
  private index(scope: GeminiSessionScope): Index {
    let raw: string
    try { raw = readFileSync(join(this.directory(scope), 'index.json'), 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, scope: this.key(scope), activeId: null, sessions: [] }
      throw error
    }
    try {
      if (raw.length > 2_000_000) throw fail('Danh sách hội thoại Gemini quá lớn')
      const value = JSON.parse(raw) as Index
      if (!value || value.version !== 1 || value.scope !== this.key(scope) || !Array.isArray(value.sessions) || value.sessions.length > 2000 ||
        value.sessions.some((item) => !item || !UUID.test(item.id) || item.provider !== 'google-antigravity' || typeof item.title !== 'string' || item.title.length > 200 || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt) || !Number.isSafeInteger(item.messageCount) || item.messageCount < 0) ||
        new Set(value.sessions.map((item) => item.id)).size !== value.sessions.length ||
        (value.activeId !== null && !value.sessions.some((item) => item.id === value.activeId))) throw fail('Danh sách hội thoại Gemini không hợp lệ')
      return value
    } catch { throw fail('Danh sách hội thoại Gemini bị hỏng. Dữ liệu đã lưu chưa bị thay đổi.') }
  }
  list(scope: GeminiSessionScope): AgentSessionInfo[] { return this.index(scope).sessions.map((item) => ({ ...item })).sort((a, b) => b.updatedAt - a.updatedAt) }
  open(scope: GeminiSessionScope, model: string, id?: string, fresh = false): GeminiStoredSession {
    const index = this.index(scope)
    const selected = fresh ? null : id ?? index.activeId
    if (selected) {
      if (!UUID.test(selected) || !index.sessions.some((item) => item.id === selected)) throw Object.assign(new Error('Hội thoại không thuộc kết nối Gemini và dự án đang chọn'), { code: 'session_not_found' })
      const stored = this.read(scope, selected)
      if (stored.forkMessageCount !== undefined) stored.nativeId = null
      if (stored.task && ['running', 'waiting_approval'].includes(stored.task.status)) {
        stored.task = { ...stored.task, status: 'cancelled', finishedAt: Date.now(), error: 'Tác vụ đã dừng khi kết nối trước đóng.' }
        this.save(scope, stored)
      }
      index.activeId = selected
      writeJson(join(this.directory(scope), 'index.json'), index as unknown as Record<string, unknown>)
      return stored
    }
    const now = Date.now()
    const stored: GeminiStoredSession = {
      version: 1, scope: this.key(scope), nativeId: null,
      info: { id: randomUUID(), title: 'Hội thoại Gemini mới', createdAt: now, updatedAt: now, provider: 'google-antigravity', baseUrl: '', model, messageCount: 0 },
      messages: [], task: null, usage: emptyUsage()
    }
    this.save(scope, stored)
    return stored
  }
  read(scope: GeminiSessionScope, id: string): GeminiStoredSession {
    if (!UUID.test(id) || !this.index(scope).sessions.some((item) => item.id === id)) throw Object.assign(new Error('Không tìm thấy hội thoại Gemini trong kết nối này'), { code: 'session_not_found' })
    try {
      const raw = readFileSync(join(this.directory(scope), id + '.json'), 'utf8')
      if (raw.length > 16_000_000) throw fail('Hội thoại Gemini quá lớn')
      const stored = JSON.parse(raw) as GeminiStoredSession
      if (!stored || stored.version !== 1 || stored.scope !== this.key(scope) || stored.info?.id !== id || stored.info.provider !== 'google-antigravity' ||
        (stored.nativeId !== null && !validNativeSessionId(stored.nativeId)) || !Array.isArray(stored.messages) || stored.messages.length > 20_000 ||
        (stored.forkParentNativeId !== undefined && !validNativeSessionId(stored.forkParentNativeId)) ||
        (stored.forkMessageCount !== undefined && (!Number.isSafeInteger(stored.forkMessageCount) || stored.forkMessageCount < 0 || stored.forkMessageCount > stored.messages.length)) ||
        stored.messages.some((message) => !message || typeof message.id !== 'string' || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string' || !Array.isArray(message.citations) || !Array.isArray(message.tools)) ||
        !validTask(stored.task, id) || !stored.usage || [stored.usage.inputTokens, stored.usage.outputTokens, stored.usage.cacheReadTokens, stored.usage.cacheWriteTokens].some((value) => !Number.isFinite(value) || value < 0)) throw fail('Bản ghi hội thoại Gemini không hợp lệ')
      return stored
    } catch { throw fail('Không khôi phục được hội thoại Gemini. Dữ liệu cũ được giữ để xử lý.') }
  }
  fork(scope: GeminiSessionScope, id: string): GeminiStoredSession {
    const source = this.read(scope, id)
    const parentNativeId = source.nativeId ?? source.forkParentNativeId
    const now = Date.now()
    const fork: GeminiStoredSession = {
      version: 1, scope: source.scope, nativeId: null,
      info: { ...source.info, id: randomUUID(), createdAt: now, updatedAt: now },
      ...(parentNativeId ? { forkParentNativeId: parentNativeId } : {}),
      messages: source.messages, forkMessageCount: source.messages.length, task: null, usage: emptyUsage()
    }
    this.save(scope, fork)
    return fork
  }
  save(scope: GeminiSessionScope, stored: GeminiStoredSession): void {
    if (stored.scope !== this.key(scope) || !UUID.test(stored.info.id) || JSON.stringify(stored).length > 16_000_000) throw fail('Không ghi được hội thoại Gemini không hợp lệ hoặc quá lớn')
    const index = this.index(scope)
    if (index.sessions.length >= 2000 && !index.sessions.some((item) => item.id === stored.info.id)) throw Object.assign(new Error('Đã đạt giới hạn 2.000 hội thoại Gemini của dự án. Xóa một hội thoại cũ trước khi tạo mới.'), { code: 'session_limit' })
    stored.info.messageCount = stored.messages.length
    stored.info.updatedAt = Date.now()
    writeJson(join(this.directory(scope), stored.info.id + '.json'), stored as unknown as Record<string, unknown>)
    if (stored.task) this.saveTask(scope, stored.task)
    index.sessions = [...index.sessions.filter((item) => item.id !== stored.info.id), { ...stored.info }]
    index.activeId = stored.info.id
    writeJson(join(this.directory(scope), 'index.json'), index as unknown as Record<string, unknown>)
  }
  rename(scope: GeminiSessionScope, id: string, title: string): void {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) throw Object.assign(new Error('Tên hội thoại phải từ 1 đến 200 ký tự'), { code: 'bad_param' })
    const stored = this.read(scope, id)
    stored.info.title = title.trim()
    const active = this.index(scope).activeId
    this.save(scope, stored)
    const index = this.index(scope); index.activeId = active
    writeJson(join(this.directory(scope), 'index.json'), index as unknown as Record<string, unknown>)
  }
  task(scope: GeminiSessionScope, id: string): AgentTask {
    if (!UUID.test(id)) throw Object.assign(new Error('Mã tác vụ không hợp lệ'), { code: 'bad_param' })
    try {
      const raw = readFileSync(join(this.directory(scope), 'tasks', id + '.json'), 'utf8')
      if (raw.length > 64_000) throw fail('Bản ghi tác vụ quá lớn')
      const value = JSON.parse(raw) as { scope: string; task: AgentTask }
      if (value.scope !== this.key(scope) || value.task.id !== id || !validTask(value.task, value.task.sessionId) || !this.index(scope).sessions.some((session) => session.id === value.task.sessionId)) throw fail('Tác vụ không thuộc hội thoại này')
      return value.task
    } catch { throw Object.assign(new Error('Tác vụ không thuộc dự án và kết nối Gemini đang chọn'), { code: 'task_not_found' }) }
  }
  saveTask(scope: GeminiSessionScope, task: AgentTask): void {
    if (!validTask(task, task.sessionId)) throw fail('Bản ghi tác vụ không hợp lệ')
    writeJson(join(this.directory(scope), 'tasks', task.id + '.json'), { scope: this.key(scope), task })
  }
  remove(scope: GeminiSessionScope, id: string): void {
    const index = this.index(scope)
    if (!UUID.test(id) || !index.sessions.some((item) => item.id === id)) throw Object.assign(new Error('Không tìm thấy hội thoại Gemini trong kết nối này'), { code: 'session_not_found' })
    const file = join(this.directory(scope), id + '.json')
    if (existsSync(file)) unlinkSync(file)
    index.sessions = index.sessions.filter((item) => item.id !== id)
    if (index.activeId === id) index.activeId = null
    writeJson(join(this.directory(scope), 'index.json'), index as unknown as Record<string, unknown>)
  }
}
