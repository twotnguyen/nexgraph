export type AgentId = 'claude' | 'cursor' | 'vscode' | 'opencode'
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
