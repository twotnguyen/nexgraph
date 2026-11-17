import type { Citation } from './graph-types'

export type AgentMode = 'ask' | 'edit'

export type ApprovalRequest = {
  id: string
  tool: 'edit' | 'write' | 'bash'
  path?: string
  before?: string
  after?: string
  command?: string
}

export type ApprovalDecision = { allow: true } | { allow: false; reason: string }

/** Nhà cung cấp AI trong màn Tài khoản; renderer không bao giờ nhận key, chỉ `hasKey`. */
export type ProviderInfo = { id: string; label: string; hasKey: boolean; oauth: boolean; loggedIn: boolean; custom: boolean }

export type CustomProvider = { id: string; label: string; baseUrl: string; model: string }

export type ModelInfo = { provider: string; id: string; label: string }

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
