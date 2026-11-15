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
