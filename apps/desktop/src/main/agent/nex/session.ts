import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ApprovalDecision, ApprovalRequest, CommandApprovalRequest, FileApprovalRequest } from '../../../shared/agent-types'
import type { ApprovalGate } from '../approval'
import type { ProviderFailure } from '../session'
import { NEX_PROVIDER_ID } from './config'

/** Tối thiểu của client HTTP mà adapter cần; test truyền bản giả. */
export type NexSessionClient = {
  createSession(input: { title?: string; model: { providerID: string; id: string } }): Promise<{ id: string }>
  prompt(sessionId: string, text: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  setModel(sessionId: string, model: { providerID: string; id: string }): Promise<void>
  replyPermission(sessionId: string, requestId: string, decision: 'once' | 'reject'): Promise<void>
  subscribe(listener: (event: { type: string; data?: Record<string, unknown> }) => void): () => void
}

type SessionEvent = Record<string, unknown>
type Listener = (event: SessionEvent) => void
type StopReason = 'stop' | 'aborted' | 'error'

export type NexSessionOptions = {
  root: string
  client: NexSessionClient
  model: { provider: string; id: string }
  /** Hộp duyệt hiện có của app (ApprovalGate); vắng thì mọi yêu cầu sửa/lệnh bị từ chối. */
  gate?: Pick<ApprovalGate, 'request'>
  /** Chế độ Hỏi/Lập kế hoạch: chỉ đọc, không hỏi duyệt ghi/lệnh. */
  isEdit?: () => boolean
  readFile?: (path: string) => string
  /** Dừng tiến trình Nex khi phiên bị bỏ (chuyển phiên, đóng dự án, thoát app). */
  stopSidecar?: () => Promise<void> | void
  /** Sidecar chết/khởi động lại: phiên bỏ id cũ, lượt đang chạy kết thúc bằng lỗi rõ ràng. */
  watchSidecar?: (listener: () => void) => () => void
  /** Lỗi app phát hiện trước khi gửi (AgentService dùng để hiện mã/câu chính xác). */
  onProviderFailure?: (failure: ProviderFailure) => void
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const asString = (value: unknown): string => typeof value === 'string' ? value : ''
const errorText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (isObject(value)) return typeof value.message === 'string' ? value.message : JSON.stringify(value)
  return String(value ?? '')
}

/**
 * Áp unified diff (dạng `git diff`/`Index:` của OpenCode) lên nội dung hiện tại để dựng bản xem trước.
 * Trả null khi không áp được (không đoán bừa nội dung tệp cho hộp duyệt).
 */
export function applyUnifiedPatch(before: string, diff: string): string | null {
  const normalized = diff.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const hunks: { oldStart: number; body: { sign: string; text: string }[] }[] = []
  for (let index = 0; index < lines.length; index++) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[index])
    if (!match) continue
    const body: { sign: string; text: string }[] = []
    index++
    while (index < lines.length && !lines[index].startsWith('@@ ')) {
      const line = lines[index]
      if (line.startsWith('diff ') || line.startsWith('Index: ') || line.startsWith('===')) { index++; continue }
      const sign = line[0]
      if (sign === '+' || sign === '-' || sign === ' ') body.push({ sign, text: line.slice(1) })
      index++
    }
    index--
    hunks.push({ oldStart: Number(match[1]), body })
  }
  if (hunks.length === 0) return null
  const endsWithNewline = before.endsWith('\n')
  const beforeLines = (endsWithNewline ? before.slice(0, -1) : before).split('\n')
  if (before === '') beforeLines.length = 0
  const out: string[] = []
  let at = 0
  for (const hunk of hunks) {
    const start = Math.max(0, hunk.oldStart - 1)
    if (start < at) return null
    while (at < start && at < beforeLines.length) out.push(beforeLines[at++])
    if (at !== start) return null
    for (const entry of hunk.body) {
      if (entry.sign === ' ') {
        if (beforeLines[at] !== entry.text) return null
        out.push(beforeLines[at++])
      } else if (entry.sign === '-') {
        if (beforeLines[at] !== entry.text) return null
        at++
      } else if (entry.sign === '+') {
        out.push(entry.text)
      }
    }
  }
  while (at < beforeLines.length) out.push(beforeLines[at++])
  return out.join('\n') + (endsWithNewline ? '\n' : '')
}

/** Phiên Nex theo đúng giao diện `PiSession` mà AgentService dùng: sự kiện Pi, prompt chặn tới khi xong lượt. */
export class NexSession {
  private ocId: string | null = null
  private listeners = new Set<Listener>()
  private unsubscribe: (() => void) | null = null
  private busy = false
  private aborted = false
  private rejected = false
  private toolNames = new Map<string, string>()
  private unwatch: (() => void) | null = null
  private pending: { resolve: () => void; reject: (error: Error) => void; stopReason: StopReason; error?: string; settled?: boolean } | null = null
  private synthetic: { role: 'user' | 'assistant'; stopReason?: StopReason; errorMessage?: string }[] = []
  private disposed = false
  private currentModel: { provider: string; id: string }

  constructor(private readonly o: NexSessionOptions) {
    this.currentModel = { ...o.model }
    this.unwatch = o.watchSidecar?.(() => this.noticeSidecarRestarted()) ?? null
  }

  get model(): { provider: string; id: string } { return this.currentModel }
  get messages(): unknown[] { return this.synthetic }
  getActiveToolNames(): string[] { return [] }
  setActiveToolsByName(): void { /* công cụ do MCP nexgraph trong tiến trình Nex phụ trách */ }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (!this.unsubscribe) this.unsubscribe = this.o.client.subscribe((event) => this.onEvent(event))
    return () => { this.listeners.delete(listener) }
  }

  private emit(event: SessionEvent): void {
    for (const listener of [...this.listeners]) {
      try { listener(event) } catch { /* lỗi renderer không được làm hỏng luồng sự kiện */ }
    }
  }

  async prompt(text: string): Promise<void> {
    if (this.busy) throw new Error('Trợ lý đang trả lời')
    if (this.disposed) throw new Error('Phiên Nex đã đóng')
    this.busy = true
    this.aborted = false
    this.rejected = false
    this.synthetic.push({ role: 'user' })
    const done = new Promise<void>((resolve, reject) => { this.pending = { resolve, reject, stopReason: 'stop' } })
    // Sidecar chết có thể reject lượt trước khi prompt kịp `await done`: nuốt bản sao để không
    // thành unhandled rejection; kết quả vẫn đi qua `await done` bên dưới.
    done.catch(() => {})
    try {
      if (!this.ocId) {
        const created = await this.o.client.createSession({
          title: text.slice(0, 80) || 'Nex', model: { providerID: NEX_PROVIDER_ID, id: this.currentModel.id }
        })
        this.ocId = created.id
      }
      try {
        await this.o.client.prompt(this.ocId, text)
      } catch (error) {
        // Gửi prompt hỏng vì tiến trình vừa chết: kết thúc lượt bằng lỗi rõ ràng thay vì "fetch failed".
        if (this.pending && !this.pending.settled) {
          const message = 'Không gửi được câu hỏi tới runtime Nex. Tiến trình có thể đã dừng; hãy gửi lại.'
          this.ocId = null
          this.o.onProviderFailure?.({ code: 'ai_runtime_restarted', message })
          this.finish('error', message)
        }
        if (!this.pending || this.pending.stopReason === 'stop') throw error
      }
      await done
      if (this.pending?.stopReason === 'error') throw new Error(this.pending.error ?? 'Nex trả lỗi')
    } finally {
      this.busy = false
      this.pending = null
    }
  }

  async abort(): Promise<void> {
    if (!this.busy || !this.ocId) return
    this.aborted = true
    try { await this.o.client.interrupt(this.ocId) } catch { /* phiên đã kết thúc */ }
    this.finish('aborted')
  }

  async setModel(model: { provider: string; id: string }): Promise<void> {
    const changed = model.id !== this.currentModel.id
    this.currentModel = { ...model }
    if (changed && this.ocId) await this.o.client.setModel(this.ocId, { providerID: NEX_PROVIDER_ID, id: model.id })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.unwatch?.()
    this.unwatch = null
    this.unsubscribe?.()
    this.unsubscribe = null
    this.listeners.clear()
    if (this.busy) { try { await this.abort() } catch { /* đã dừng */ } }
    try { await this.o.stopSidecar?.() } catch { /* tiến trình có thể đã chết */ }
  }

  /**
   * Sidecar chết/khởi động lại: id phiên cũ không còn hiệu lực. Lượt đang chạy phải kết thúc
   * bằng lỗi rõ ràng thay vì treo chờ sự kiện không bao giờ tới; lượt sau mở phiên mới trên
   * URL/mật khẩu mới (client đọc lại qua getter).
   */
  noticeSidecarRestarted(): void {
    if (this.disposed) return
    this.ocId = null
    this.toolNames.clear()
    if (!this.pending) return
    const message = 'Runtime Nex đã khởi động lại. Hãy gửi lại câu hỏi.'
    this.o.onProviderFailure?.({ code: 'ai_runtime_restarted', message })
    this.finish('error', message)
  }

  /** Sự kiện SSE của OpenCode → sự kiện phiên mà AgentService/renderer đang dùng. */
  private onEvent(event: { type: string; data?: Record<string, unknown> }): void {
    if (this.disposed) return
    const data = isObject(event.data) ? event.data : {}
    if (event.type === 'permission.asked') { void this.onPermission(data); return }
    const sessionId = asString(data.sessionID)
    if (!this.ocId || sessionId !== this.ocId) return
    switch (event.type) {
      case 'session.text.delta':
        this.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: asString(data.delta) } })
        break
      case 'session.reasoning.ended':
        if (asString(data.text)) this.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: asString(data.text) } })
        break
      case 'session.tool.input.started':
        this.toolNames.set(asString(data.id), asString(data.name))
        break
      case 'session.tool.called': {
        const id = asString(data.id)
        this.emit({ type: 'tool_execution_start', toolCallId: id, toolName: this.toolNames.get(id) ?? 'tool', args: data.input ?? {} })
        break
      }
      case 'session.tool.success': {
        const id = asString(data.id)
        this.emit({
          type: 'tool_execution_end', toolCallId: id, toolName: this.toolNames.get(id) ?? 'tool', isError: false,
          result: { content: Array.isArray(data.content) ? data.content : [] }
        })
        break
      }
      case 'session.tool.failed': {
        const id = asString(data.id)
        this.emit({
          type: 'tool_execution_end', toolCallId: id, toolName: this.toolNames.get(id) ?? 'tool', isError: true,
          result: { content: Array.isArray(data.content) ? data.content : [{ type: 'text', text: errorText(data.error) }] }
        })
        break
      }
      case 'session.step.ended': {
        const tokens = isObject(data.tokens) ? data.tokens : {}
        const cache = isObject(tokens.cache) ? tokens.cache : {}
        this.emit({
          type: 'message_end',
          message: {
            role: 'assistant',
            usage: {
              input: Number(tokens.input ?? 0), output: Number(tokens.output ?? 0),
              cacheRead: Number(cache.read ?? 0), cacheWrite: Number(cache.write ?? 0),
              cost: { total: Number(data.cost ?? 0) }
            }
          }
        })
        this.emit({ type: 'turn_end' })
        break
      }
      case 'session.execution.succeeded':
        this.finish('stop')
        break
      case 'session.execution.failed':
        this.finish('error', errorText(data.error) || 'Nex trả lỗi')
        break
      case 'session.execution.interrupted':
        // Người dùng bấm Từ chối: nói rõ thao tác bị từ chối, không phải lượt bị huỷ.
        this.finish(this.rejected ? 'error' : 'aborted', this.rejected ? 'Đã từ chối thao tác.' : undefined)
        break
    }
  }

  private finish(stopReason: StopReason, error?: string): void {
    if (!this.pending || this.pending.settled) return
    const pending = this.pending
    pending.settled = true
    this.pending = { ...pending, stopReason, error }
    this.synthetic.push({ role: 'assistant', stopReason, ...(error ? { errorMessage: error } : {}) })
    if (stopReason === 'error') pending.reject(new Error(error ?? 'Nex trả lỗi'))
    else pending.resolve()
  }

  /** Yêu cầu duyệt của Nex đi qua đúng hộp duyệt (ApprovalCard) của app. */
  private async onPermission(data: Record<string, unknown>): Promise<void> {
    const sessionId = asString(data.sessionID)
    if (!this.ocId || sessionId !== this.ocId) return
    const requestId = asString(data.id)
    const action = asString(data.action)
    const resources = Array.isArray(data.resources) ? data.resources.map(asString) : []
    const metadata = isObject(data.metadata) ? data.metadata : {}
    let request: ApprovalRequest | null = null
    if (action === 'edit' && this.o.isEdit?.() !== false) {
      const target = asString(metadata.filepath) || resources[0] || ''
      const path = this.projectRelative(target)
      if (path) {
        const before = this.readProjectFile(path)
        // Không đọc được an toàn (symlink ra ngoài, lỗi quyền, đường dẫn lạ) → từ chối thao tác,
        // không coi là tệp rỗng để dựng diff giả.
        if (before !== null) {
          const after = applyUnifiedPatch(before, asString(metadata.diff))
          if (after !== null) request = { id: requestId, tool: 'write', path, before, after } satisfies FileApprovalRequest
        }
      }
    } else if (action === 'shell' && this.o.isEdit?.() !== false) {
      const command = asString(metadata.command) || resources[0] || ''
      if (command) request = { id: requestId, tool: 'command', executable: '/bin/sh', args: ['-c', command], cwd: this.o.root, timeoutMs: 120_000 } satisfies CommandApprovalRequest
    }
    let decision: ApprovalDecision = { allow: false, reason: 'Không hiển thị được yêu cầu duyệt' }
    if (request && this.o.gate) {
      try { decision = await this.o.gate.request(request) } catch { decision = { allow: false, reason: 'Không gửi được yêu cầu duyệt' } }
      if (!decision.allow && decision.reason === 'Người dùng từ chối thao tác này') {
        this.rejected = true
        this.o.onProviderFailure?.({ code: 'ai_tool_rejected', message: 'Đã từ chối thao tác.' })
      }
    }
    try { await this.o.client.replyPermission(sessionId, requestId, decision.allow ? 'once' : 'reject') } catch { /* phiên đã đóng */ }
  }

  private projectRelative(path: string): string | null {
    if (!path) return null
    const absolute = isAbsolute(path) ? path : resolve(this.o.root, path)
    const rel = relative(this.o.root, absolute)
    if (!rel || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) return null
    return rel.split(sep).join('/')
  }

  /** realpath gốc dự án, tính một lần; lỗi đọc thì giữ nguyên đường dẫn cấu hình. */
  private realRoot(): string {
    try { return realpathSync.native(this.o.root) } catch { return this.o.root }
  }

  private insideRoot(root: string, target: string): boolean {
    const rel = relative(root, target)
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))
  }

  /**
   * Đường dẫn tuyệt đối an toàn để đọc trong dự án: kiểm `..`/tuyệt đối trước, rồi realpath của
   * tổ tiên gần nhất đang tồn tại (tệp mới chưa có) và của chính tệp nếu đã có — chặn symlink
   * trỏ ra ngoài. Trả null khi không xác định được.
   */
  private resolveProjectFile(path: string): string | null {
    const root = this.realRoot()
    const absolute = isAbsolute(path) ? path : resolve(this.o.root, path)
    if (!this.insideRoot(this.o.root, absolute)) return null
    let probe = absolute
    while (!existsSync(probe)) {
      const parent = dirname(probe)
      if (parent === probe) return null
      probe = parent
    }
    try {
      if (!this.insideRoot(root, realpathSync.native(probe))) return null
      if (existsSync(absolute) && !this.insideRoot(root, realpathSync.native(absolute))) return null
    } catch {
      return null
    }
    return absolute
  }

  /** null khi không đọc được an toàn; tệp chưa có (ENOENT) trả '' cho bản xem trước tệp mới. */
  private readProjectFile(path: string): string | null {
    const absolute = this.resolveProjectFile(path)
    if (!absolute) return null
    try {
      return (this.o.readFile ?? ((file: string) => readFileSync(file, 'utf8')))(absolute)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      return null
    }
  }
}
