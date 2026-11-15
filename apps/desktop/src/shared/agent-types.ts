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

/** Sự kiện của một lượt agent, main gửi xuống renderer qua kênh `agent:event` kèm projectId. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'start' | 'end'; error?: boolean }
  | { type: 'approval'; request: ApprovalRequest }
  | { type: 'approval_closed'; id: string }
  | { type: 'done'; text: string; citations: Citation[] }
  | { type: 'error'; code: string; message: string }
