import { join } from 'node:path'
import type { EngineCommand } from '../../../platform/engine/launcher'
import { PYTHON_ENV_GUARD } from '../../../platform/engine/python-env'
import { NEX_INSTRUCTIONS_FILE, nexInstructions } from './instructions'

/** Mã provider bên trong tiến trình Nex; không dùng id nhà cung cấp của app để không lộ cấu hình nội bộ. */
export const NEX_PROVIDER_ID = 'nexgraph'
/** Biến môi trường của tiến trình con chứa thông tin provider. Key KHÔNG BAO GIỜ ghi vào tệp cấu hình. */
export const NEX_PROVIDER_ENV = {
  baseUrl: 'NEXGRAPH_NEX_PROVIDER_BASE_URL',
  apiKey: 'NEXGRAPH_NEX_PROVIDER_API_KEY'
} as const

/** Tài khoản AI đang chọn, đủ để dựng provider OpenAI-compatible trong cấu hình Nex. */
export type NexProvider = {
  id: string
  label: string
  baseUrl: string
  /** Chỉ nằm trong env của tiến trình con; hàm trả cấu hình không nhận/không trả khoá này. */
  apiKey: string
  model: string
  contextWindow?: number
  maxTokens?: number
  supportsTools?: boolean
}

export type NexConfigInput = {
  root: string
  engine: EngineCommand
  dataDir: string
  /** Thư mục cấu hình OpenCode của dự án (`OPENCODE_CONFIG_DIR`), nơi sidecar ghi `nexConfigFiles()`. */
  configDir: string
  provider: Pick<NexProvider, 'label' | 'model' | 'contextWindow' | 'maxTokens' | 'supportsTools'>
}

/** Env riêng của tiến trình con: giá trị thật của `{env:…}` trong cấu hình. */
export function nexProviderEnv(provider: NexProvider): Record<string, string> {
  return {
    [NEX_PROVIDER_ENV.baseUrl]: provider.baseUrl,
    [NEX_PROVIDER_ENV.apiKey]: provider.apiKey
  }
}

/**
 * Cấu hình OpenCode định dạng v2 (spike A2 §3.3): `providers`, `mcp.servers`, `permissions`.
 * Chỉ chứa tham chiếu `{env:…}` cho base URL và key; không bao giờ chứa giá trị key.
 */
export function nexConfig(input: NexConfigInput): Record<string, unknown> {
  const model = input.provider.model
  const context = input.provider.contextWindow && input.provider.contextWindow > 0 ? input.provider.contextWindow : 128_000
  const output = input.provider.maxTokens && input.provider.maxTokens > 0 ? input.provider.maxTokens : 8_192
  return {
    $schema: 'https://opencode.ai/config.json',
    model: `${NEX_PROVIDER_ID}/${model}`,
    providers: {
      [NEX_PROVIDER_ID]: {
        name: input.provider.label || 'NexGraph',
        package: '@opencode/ai/providers/openai-compatible',
        settings: {
          baseURL: `{env:${NEX_PROVIDER_ENV.baseUrl}}`,
          apiKey: `{env:${NEX_PROVIDER_ENV.apiKey}}`
        },
        models: {
          [model]: {
            name: model,
            capabilities: {
              tools: input.provider.supportsTools !== false,
              input: ['text'],
              output: ['text'],
              temperature: true
            },
            limit: { context, output }
          }
        }
      }
    },
    ...nexBaseConfig(input)
  }
}

/** Tool có sẵn của OpenCode mà Nex được dùng (tệp chỉ dẫn giới thiệu đúng các tool này). */
export const NEX_ENABLED_TOOLS = ['read', 'glob', 'grep', 'edit', 'write', 'shell'] as const

/**
 * Tool có sẵn của OpenCode 2.4.1 mà app không phục vụ được: `onPermission` (nex/session.ts) chỉ dựng
 * hộp duyệt cho `edit`/`shell` và từ chối mọi quyền khác, giao diện không hiện câu hỏi, phiên con
 * hay lịch chạy. Luật `deny` trên `*` làm OpenCode bỏ tool khỏi danh sách gửi model
 * (`tool.ts` whollyDisabled). Đây là lớp dự phòng cho `NEX_REMOVED_PLUGINS` (bản OpenCode sau đổi
 * id plugin thì tool vẫn bị ẩn). `execute` là Code Mode.
 */
export const NEX_DISABLED_TOOLS = [
  'webfetch', 'websearch', 'generate_image', 'generate_video', 'question', 'subagent', 'execute', 'skill'
] as const

/**
 * Plugin tool có sẵn của OpenCode 2.4.1 bị gỡ hẳn (`plugins: ["-<id>"]`). Chỉ `deny` thì chưa đủ:
 * tắt `execute` làm các tool Code Mode (`automation_*`, `opencode_*`) thành tool gọi thẳng, và
 * `opencode_worktree_remove` xin quyền `edit` nên luật quyền không ẩn được. Đo trên binary thật:
 * còn đúng `NEX_ENABLED_TOOLS` + tool `nexgraph_*` (script `scripts/nex/probe_system_prompt.ts`).
 */
export const NEX_REMOVED_PLUGINS = [
  'opencode.tool.automation', 'opencode.tools', 'opencode.tools.mcp-resources', 'opencode.tools.mcp-events',
  'opencode.tool.skill', 'opencode.tool.webfetch', 'opencode.tool.websearch', 'opencode.tool.question',
  'opencode.tool.subagent', 'opencode.tool.image-generate', 'opencode.tool.video-generate'
] as const

/** Các tệp sidecar ghi vào thư mục cấu hình cạnh `opencode.json`. */
export function nexConfigFiles(): Record<string, string> {
  return { [NEX_INSTRUCTIONS_FILE]: nexInstructions() }
}

/** Phần chung của cấu hình Nex: MCP engine, chỉ dẫn hệ thống, quyền. */
function nexBaseConfig(input: Pick<NexConfigInput, 'root' | 'engine' | 'dataDir' | 'configDir'>): Record<string, unknown> {
  return {
    // Đường dẫn tuyệt đối: OpenCode nạp mục `instructions` đã khai kể cả khi tắt khám phá cấu hình dự án.
    instructions: [join(input.configDir, NEX_INSTRUCTIONS_FILE)],
    plugins: NEX_REMOVED_PLUGINS.map((id) => `-${id}`),
    mcp: {
      servers: {
        nexgraph: {
          type: 'local',
          command: [input.engine.command, ...input.engine.args, 'mcp', '--project', input.root, '--data-dir', input.dataDir],
          cwd: input.root,
          codemode: false,
          environment: { ...PYTHON_ENV_GUARD },
          timeout: { startup: 60_000, catalog: 30_000 }
        }
      }
    },
    // Mặc định của OpenCode khi không khớp rule là `ask` (spike A2 §3.3): vẫn khai báo rõ để không
    // phụ thuộc mặc định của bản cài. Chế độ Hỏi/Lập kế hoạch do lớp duyệt của app chặn thêm.
    permissions: [
      { action: 'read', resource: '*', effect: 'allow' },
      { action: 'glob', resource: '*', effect: 'allow' },
      { action: 'grep', resource: '*', effect: 'allow' },
      { action: 'list', resource: '*', effect: 'allow' },
      { action: 'nexgraph_*', resource: '*', effect: 'allow' },
      { action: 'edit', resource: '*', effect: 'ask' },
      { action: 'shell', resource: '*', effect: 'ask' },
      ...NEX_DISABLED_TOOLS.map((action) => ({ action, resource: '*', effect: 'deny' }))
    ]
  }
}

/**
 * Cấu hình cho nhà cung cấp đã đăng nhập trong sidecar (ChatGPT, Copilot, OpenCode…):
 * model trỏ thẳng `<integration>/<model>`, không khai báo `providers` và không cần key trên đĩa.
 */
export function nexAccountConfig(input: Pick<NexConfigInput, 'root' | 'engine' | 'dataDir' | 'configDir'> & {
  providerID: string
  model: string
}): Record<string, unknown> {
  return {
    $schema: 'https://opencode.ai/config.json',
    model: `${input.providerID}/${input.model}`,
    ...nexBaseConfig(input)
  }
}

/** Tên thư mục cấu hình/dữ liệu của một dự án trong `<userData>/nex`; chỉ ký tự an toàn. */
export function nexProjectKey(projectId: string): string {
  const safe = projectId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80)
  return safe || 'project'
}
