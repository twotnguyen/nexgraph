import type { Citation } from './graph-types'

export type AgentMode = 'ask' | 'plan' | 'edit'
export type AgentExecutionPolicy = 'review' | 'auto'
export type AgentExecutionSettings = { policy: AgentExecutionPolicy; allowCommands: boolean }

export type FileApprovalRequest = {
  id: string
  tool: 'edit' | 'write'
  path: string
  before: string
  after: string
}

export type CommandApprovalRequest = {
  id: string
  tool: 'command'
  executable: string
  args: string[]
  cwd: string
  timeoutMs: number
}
export type ApprovalRequest = FileApprovalRequest | CommandApprovalRequest

export type ApprovalDecision = { allow: true } | { allow: false; reason: string }

/** Nhà cung cấp AI trong màn Tài khoản; renderer không bao giờ nhận key, chỉ `hasKey`. */
export type ProviderInfo = {
  id: string; label: string; hasKey: boolean; oauth: boolean; loggedIn: boolean; custom: boolean
  oauthStorageIssue?: string
  authMethods?: ('api_key' | 'oauth' | 'none')[]
  kind?: 'api' | 'subscription' | 'local'
  description?: string
}

/** Một nhà cung cấp trong khối "Tài khoản AI cho Nex" (integration của sidecar). */
export type NexAccountMethod = {
  id: string
  type: 'oauth' | 'command' | 'key' | 'external'
  label: string
  form?: { key: string; title: string; required: boolean; hidden?: boolean; options?: { value: string; label: string }[]; when?: { key: string; op: string; value: string }[] }[]
}
export type NexAccountConnection = {
  id: string
  label: string
  method: 'key' | 'oauth' | 'external'
  problem?: { message: string; url?: string }
}
export type NexAccountProvider = {
  id: string
  name: string
  connected: boolean
  connections: NexAccountConnection[]
  methods: NexAccountMethod[]
  models: { id: string; label: string }[]
}
export type NexAccountsView = {
  /** Có runtime Nex trên máy và sidecar trả lời được. */
  available: boolean
  /** Lý do khi chưa dùng được (thiếu binary, sidecar lỗi) — câu đã dịch ở renderer bằng mã. */
  reason?: 'no_runtime' | 'sidecar_error'
  providers: NexAccountProvider[]
  selected: { provider: string; id: string } | null
}
/** Kết quả bắt đầu một luồng đăng nhập qua sidecar. */
export type NexAuthStartView = {
  kind: 'oauth' | 'command' | 'external' | 'key'
  integrationId: string
  attemptId?: string
  url?: string
  instructions?: string
  userCode?: string
  /** URL đã được kiểm và mở bằng trình duyệt hệ thống. */
  opened?: boolean
  /** URL không mở vì không qua kiểm https + host cho phép. */
  blockedReason?: 'invalid_url' | 'host_not_allowed'
}
export type NexAuthStatusView = { status: 'pending' | 'complete' | 'failed' | 'expired'; message?: string }


export type PiConsentTarget = { runtime?: 'pi'; provider: string; baseUrl: string; accountId?: string }
export type GeminiConsentTarget = { runtime: 'antigravity-cli'; provider: 'google-antigravity'; connectionId: string; accountId?: string; baseUrl?: never }
/** Điểm đến của phiên Nex theo khối tài khoản Nex (#72): `baseUrl` là URL nhà cung cấp, hoặc `nex-account:<id>` cho tài khoản đăng nhập trong sidecar. */
export type NexConsentTarget = { runtime: 'nex'; provider: string; baseUrl: string; accountId?: string }
export type AiConsentTarget = PiConsentTarget | GeminiConsentTarget | NexConsentTarget

export function normalizeConsentTarget(provider: string, baseUrl: string, accountId?: string): PiConsentTarget | null {
  try {
    const url = new URL(baseUrl)
    if (!provider || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null
    url.hash = ''
    return { provider, baseUrl: url.href, ...(accountId ? { accountId } : {}) }
  } catch {
    return null
  }
}

export function sameConsentTarget(left: AiConsentTarget | null | undefined, right: AiConsentTarget | null | undefined): boolean {
  if (!left || !right || left.provider !== right.provider || left.accountId !== right.accountId) return false
  if (left.runtime === 'antigravity-cli' || right.runtime === 'antigravity-cli')
    return left.runtime === 'antigravity-cli' && right.runtime === 'antigravity-cli' && !!left.connectionId && left.connectionId === right.connectionId
  // Điểm đến Nex và điểm đến Pi cùng nhà cung cấp/URL vẫn là hai consent khác nhau.
  if ((left.runtime === 'nex') !== (right.runtime === 'nex')) return false
  return left.baseUrl === right.baseUrl
}

export function consentTargetForSettings(settings: { runtime?: 'nex' | 'pi' | 'antigravity-cli'; provider?: string; baseUrl?: string; model?: string; accountId?: string; connectionId?: string; nexDestination?: boolean }): AiConsentTarget | null {
  if (!settings.model) return null
  if (settings.runtime === 'nex' && settings.nexDestination) return settings.provider && settings.baseUrl ? {
    runtime: 'nex', provider: settings.provider, baseUrl: settings.baseUrl, ...(settings.accountId ? { accountId: settings.accountId } : {})
  } : null
  if (settings.runtime === 'antigravity-cli') return settings.connectionId ? {
    runtime: 'antigravity-cli', provider: 'google-antigravity', connectionId: settings.connectionId,
    ...(settings.accountId ? { accountId: settings.accountId } : {})
  } : null
  // Preserve the exact canonical destination supplied by the main process.
  return settings.provider && settings.baseUrl ? { provider: settings.provider, baseUrl: settings.baseUrl, ...(settings.accountId ? { accountId: settings.accountId } : {}) } : null
}

export type CustomProvider = {
  id: string; label: string; baseUrl: string; model: string
  kind?: 'compatible' | 'ollama'
  contextWindow?: number
  maxTokens?: number
  supportsTools?: boolean
  cost?: { input: number; output: number }
}

export type ModelInfo = {
  runtime?: 'pi' | 'antigravity-cli'
  provider: string; id: string; label: string
  contextWindow?: number
  maxTokens?: number
  supportsTools?: boolean
  supportsImages?: boolean
  cost?: { input: number | null; output: number | null }
  pricing?: 'known' | 'unknown' | 'free' | 'subscription' | 'local'
}
export type LocalModelInfo = { id: string; label: string; contextWindow?: number; supportsTools?: boolean; sizeBytes?: number }

export type AgentContextItem =
  | { kind: 'file'; file: string; start?: number; end?: number; text?: string; version?: string; dirty?: boolean }
  | { kind: 'node'; nodeId: string; label?: string }
  | { kind: 'flow'; flowId: number; label?: string }
  | { kind: 'architecture'; blockId: string; label?: string }

export type AgentPromptOptions = { context?: AgentContextItem[]; images?: { mimeType: string; data: string }[] }
export type AgentEditorState = { file: string; dirty: boolean; version?: string }
export type AgentRunLimits = { maxTurns: number; maxDurationMs: number; maxTokens: number }
export type AgentUsage = {
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number | null
}
/** Ngữ cảnh phiên đang dùng: token đang nằm trong ngữ cảnh / cỡ cửa sổ của model. Backend chưa báo số tin cậy thì không có giá trị (không đoán). */
export type AgentContextUsage = { tokens: number; window: number }
export type AgentToolRun = {
  id: string; name: string; input: string; output: string
  status: 'running' | 'completed' | 'failed'
  startedAt: number; durationMs?: number
}
export type AgentTask = {
  runtime?: 'pi' | 'antigravity-cli'
  turnsKnown?: boolean
  id: string; sessionId: string
  status: 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled'
  startedAt: number; finishedAt?: number; turns: number; limits: AgentRunLimits; error?: string; checkpointIds?: string[]
}
export type AgentSessionInfo = {
  id: string; title: string; createdAt: number; updatedAt: number
  provider: string; baseUrl: string; model: string; messageCount: number
}
export type AgentTranscriptMessage = {
  id: string; role: 'user' | 'assistant'; text: string; timestamp: number; citations: Citation[]; tools: AgentToolRun[]
}
export type AgentSessionSnapshot = {
  runtime?: 'pi' | 'antigravity-cli'
  session: AgentSessionInfo | null; messages: AgentTranscriptMessage[]; task: AgentTask | null
  mode: AgentMode; policy: AgentExecutionPolicy; execution: AgentExecutionSettings; limits: AgentRunLimits; usage: AgentUsage
  context?: AgentContextUsage
}
export type AgentCommandSuggestion = { id: string; label: string; executable: string; args: string[]; cwd: string; timeoutMs: number }
export type ProjectCommands = { commands: AgentCommandSuggestion[]; packageManager?: string; warnings: string[] }
export type AgentCheckpointInfo = { id: string; path: string; before: string; after: string; createdAt: number; restored?: boolean }
export type AgentRollbackResult = { restored: string[]; conflicts: { path: string; reason: string }[] }

/** Sự kiện đăng nhập OAuth, main gửi qua `auth:login-event`. */
export type AuthEventView =
  | { type: 'info'; message: string; links?: readonly { url: string; label?: string }[] }
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'device_code'; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: 'progress'; message: string }

/** Câu hỏi đăng nhập OAuth cần người dùng trả lời; renderer trả lời qua `auth:prompt-reply` (giá trị `null` = huỷ). */
export type AuthPromptView = {
  id: string
  kind: 'text' | 'secret' | 'select' | 'manual_code'
  message: string
  placeholder?: string
  options?: readonly { id: string; label: string; description?: string }[]
}

/** Sự kiện của một lượt agent, main gửi xuống renderer qua kênh `agent:event` kèm projectId. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'start' | 'end'; error?: boolean }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'approval_closed'; id: string }
  | { type: 'write_conflict'; message: string }
  | { type: 'done'; text: string; citations: Citation[] }
  | { type: 'error'; code: string; message: string; /** Thông điệp ngắn của provider (đã che khoá), hiện sau câu theo mã. */ detail?: string }
  | { type: 'task'; task: AgentTask }
  | { type: 'tool_detail'; tool: AgentToolRun }
  | { type: 'usage'; usage: AgentUsage }
  | { type: 'context'; context: AgentContextUsage | null }
  | { type: 'thinking'; delta: string }
  | { type: 'retry'; attempt: number; maxAttempts: number; delayMs: number; message: string }
  | { type: 'compaction'; active: boolean }
  | { type: 'session'; sessionId: string }
  | { type: 'command_output'; id: string; stream: 'stdout' | 'stderr'; delta: string }
