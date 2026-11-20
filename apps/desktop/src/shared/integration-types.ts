/** 21 nền tảng trợ lý AI, theo bảng nền tảng của bản vendor (install.py `_PLATFORM_CONFIG`, cộng gemini và cursor). */
export const AGENT_IDS = [
  'claude', 'codex', 'gemini', 'cursor', 'opencode', 'kilo', 'aider', 'amp', 'vscode', 'claw', 'droid',
  'trae', 'trae-cn', 'antigravity', 'hermes', 'kiro', 'pi', 'devin', 'codebuddy', 'kimi', 'agents'
] as const
export type AgentId = (typeof AGENT_IDS)[number]
/** Một tệp NexGraph ghi cho nền tảng: cấu hình MCP, khối "hỏi graph trước", skill, hook nhắc dùng graph. */
export type IntegrationPart = 'mcp' | 'rules' | 'skill' | 'hook'
export interface IntegrationPlan {
  agent: AgentId
  part: IntegrationPart
  path: string
  exists: boolean
  /** Cài: new/add/update/up_to_date/invalid. Gỡ: remove (ghi lại phần còn lại), delete (xoá tệp), up_to_date (không có gì để gỡ), invalid. */
  status: 'new' | 'add' | 'update' | 'up_to_date' | 'invalid' | 'remove' | 'delete'
  /** Toàn văn tệp sau khi ghi ('' khi invalid hoặc delete). */
  after: string
  /** Mục cấu hình để dán (hoặc xoá) thủ công. */
  snippet: string
}
export interface IntegrationOptions {
  /** Hook chặn lần Read đầu tiên mỗi phiên khi chưa hỏi graph (Claude Code, CodeBuddy). */
  strict?: boolean
}
