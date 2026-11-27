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

/**
 * Tool có sẵn của OpenCode mà Nex được dùng (tệp chỉ dẫn giới thiệu đúng các tool này). Hai tool
 * `opencode_*_mcp_resource(s)` đọc resource của MCP `nexgraph` (báo cáo, god nodes, kết nối bất ngờ,
 * câu hỏi gợi ý, audit), thứ Graphify cấp cho agent kết nối vào qua `graphify://…`. `webfetch` và
 * `websearch` luôn hỏi duyệt (hộp duyệt hiện URL hoặc câu tìm), ở mọi chế độ.
 *
 * Không có `read`/`glob`/`grep` của OpenCode: chúng đọc thẳng đĩa, bỏ qua chính sách nguồn của NexGraph
 * (`.env`, khoá, `.gitignore`, mẫu loại trừ AI, che secret). Nex đọc và tìm tệp bằng `nexgraph_read_file`,
 * `nexgraph_grep`, `nexgraph_glob` của engine (`analysis/query/project_files.py`).
 */
export const NEX_ENABLED_TOOLS = [
  'edit', 'write', 'shell', 'webfetch', 'websearch',
  'opencode_list_mcp_resources', 'opencode_read_mcp_resource'
] as const

/**
 * Nhà cung cấp tìm web chọn sẵn. Không chọn thì lần tìm đầu OpenCode mở form chọn nhà cung cấp mà app
 * không vẽ được, tool treo 1 phút rồi báo huỷ. Exa (`mcp.exa.ai`) chạy không cần key; người dùng có
 * `EXA_API_KEY` thì OpenCode dùng key đó.
 */
export const NEX_WEBSEARCH_PROVIDER = 'exa'

/**
 * Tool có sẵn của OpenCode 2.4.1 mà app không phục vụ được: `onPermission` (nex/session.ts) chỉ dựng
 * hộp duyệt cho sửa tệp, lệnh và web, từ chối mọi quyền khác; giao diện không hiện câu hỏi, phiên con
 * hay lịch chạy. Luật `deny` trên `*` làm OpenCode bỏ tool khỏi danh sách gửi model
 * (`tool.ts` whollyDisabled). Đây là lớp dự phòng cho `NEX_REMOVED_PLUGINS` (bản OpenCode sau đổi
 * id plugin thì tool vẫn bị ẩn). `execute` là Code Mode.
 */
export const NEX_DISABLED_TOOLS = [
  'generate_image', 'generate_video', 'question', 'subagent', 'execute', 'skill', 'read', 'glob', 'grep'
] as const

/**
 * Plugin tool có sẵn của OpenCode 2.4.1 bị gỡ hẳn (`plugins: ["-<id>"]`). Chỉ `deny` thì chưa đủ:
 * tắt `execute` làm các tool Code Mode (`automation_*`, `opencode_*`) thành tool gọi thẳng, và
 * `opencode_worktree_remove` xin quyền `edit` nên luật quyền không ẩn được. Đo trên binary thật:
 * còn đúng `NEX_ENABLED_TOOLS` + tool `nexgraph_*` (script `scripts/nex/probe_system_prompt.ts`).
 * Giữ `opencode.tools.mcp-resources` (đọc resource `nexgraph://…`).
 */
export const NEX_REMOVED_PLUGINS = [
  'opencode.tool.automation', 'opencode.tools', 'opencode.tools.mcp-events',
  'opencode.tool.skill', 'opencode.tool.question',
  'opencode.tool.subagent', 'opencode.tool.image-generate', 'opencode.tool.video-generate',
  'opencode.tool.read', 'opencode.tool.grep', 'opencode.tool.glob'
] as const

/** Chế độ chốt "tra đồ thị trước" của tool tệp MCP cho Nex (`nexgraph-engine mcp --file-guard`). */
export const NEX_FILE_GUARD = 'strict'

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
    websearch: { provider: NEX_WEBSEARCH_PROVIDER },
    mcp: {
      servers: {
        nexgraph: {
          type: 'local',
          // `--file-guard strict`: lần đầu Nex đọc/tìm tệp thô khi chưa tra đồ thị (và đồ thị còn mới) bị từ chối
          // một lần kèm lời nhắc, như `graphify hook-guard --strict` với agent ngoài.
          command: [input.engine.command, ...input.engine.args, 'mcp', '--project', input.root, '--data-dir', input.dataDir,
            '--file-guard', NEX_FILE_GUARD],
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
      { action: 'nexgraph_*', resource: '*', effect: 'allow' },
      // Chỉ server `nexgraph`; resource của server khác rơi vào hỏi quyền, onPermission từ chối.
      { action: 'opencode_list_mcp_resources', resource: 'nexgraph', effect: 'allow' },
      { action: 'opencode_read_mcp_resource', resource: 'nexgraph:*', effect: 'allow' },
      { action: 'edit', resource: '*', effect: 'ask' },
      { action: 'shell', resource: '*', effect: 'ask' },
      // Hỏi từng lần: URL hay câu tìm có thể mang dữ liệu dự án ra ngoài.
      { action: 'webfetch', resource: '*', effect: 'ask' },
      { action: 'websearch', resource: '*', effect: 'ask' },
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
