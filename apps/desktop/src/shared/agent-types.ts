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

export type AiConsentTarget = { provider: string; baseUrl: string; accountId?: string }

export function normalizeConsentTarget(provider: string, baseUrl: string, accountId?: string): AiConsentTarget | null {
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
  return !!left && !!right && left.provider === right.provider && left.baseUrl === right.baseUrl
    && left.accountId === right.accountId
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
  provider: string; id: string; label: string
  contextWindow?: number
  maxTokens?: number
  supportsTools?: boolean
  cost?: { input: number | null; output: number | null }
  pricing?: 'known' | 'unknown' | 'free' | 'subscription' | 'local'
}
export type LocalModelInfo = { id: string; label: string; contextWindow?: number; supportsTools?: boolean; sizeBytes?: number }

export type AgentContextItem =
  | { kind: 'file'; file: string; start?: number; end?: number; text?: string; version?: string; dirty?: boolean }
  | { kind: 'node'; nodeId: string; label?: string }
  | { kind: 'flow'; flowId: number; label?: string }
  | { kind: 'architecture'; blockId: string; label?: string }

export type AgentPromptOptions = { context?: AgentContextItem[] }
export type AgentEditorState = { file: string; dirty: boolean; version?: string }
export type AgentRunLimits = { maxTurns: number; maxDurationMs: number; maxTokens: number }
export type AgentUsage = {
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number | null
}
export type AgentToolRun = {
  id: string; name: string; input: string; output: string
  status: 'running' | 'completed' | 'failed'
  startedAt: number; durationMs?: number
}
export type AgentTask = {
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
  session: AgentSessionInfo | null; messages: AgentTranscriptMessage[]; task: AgentTask | null
  mode: AgentMode; policy: AgentExecutionPolicy; execution: AgentExecutionSettings; limits: AgentRunLimits; usage: AgentUsage
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
  | { type: 'error'; code: string; message: string }
  | { type: 'task'; task: AgentTask }
  | { type: 'tool_detail'; tool: AgentToolRun }
  | { type: 'usage'; usage: AgentUsage }
  | { type: 'thinking'; delta: string }
  | { type: 'retry'; attempt: number; maxAttempts: number; delayMs: number; message: string }
  | { type: 'compaction'; active: boolean }
  | { type: 'session'; sessionId: string }
  | { type: 'command_output'; id: string; stream: 'stdout' | 'stderr'; delta: string }
