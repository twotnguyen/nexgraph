export type AgentId = 'claude' | 'cursor' | 'vscode' | 'opencode' | 'codex' | 'skill-claude' | 'agents-md'
/** Mục tiêu cài skill: SKILL.md của Claude Code hay khối trong AGENTS.md. */
export type SkillTarget = 'claude' | 'agents-md'
export interface IntegrationPlan {
  agent: AgentId
  path: string
  exists: boolean
  status: 'new' | 'add' | 'update' | 'up_to_date' | 'invalid'
  /** Toàn văn tệp sau khi ghi ('' khi invalid). */
  after: string
  /** Mục cấu hình để dán thủ công. */
  snippet: string
}
