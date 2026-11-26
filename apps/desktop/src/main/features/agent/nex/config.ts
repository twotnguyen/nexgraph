import type { EngineCommand } from '../../../platform/engine/launcher'
import { PYTHON_ENV_GUARD } from '../../../platform/engine/python-env'

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

/** Phần chung của cấu hình Nex: MCP engine + quyền. */
function nexBaseConfig(input: Pick<NexConfigInput, 'root' | 'engine' | 'dataDir'>): Record<string, unknown> {
  return {
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
      { action: 'skill', resource: '*', effect: 'allow' },
      { action: 'nexgraph_*', resource: '*', effect: 'allow' },
      { action: 'edit', resource: '*', effect: 'ask' },
      { action: 'shell', resource: '*', effect: 'ask' }
    ]
  }
}

/**
 * Cấu hình cho nhà cung cấp đã đăng nhập trong sidecar (ChatGPT, Copilot, OpenCode…):
 * model trỏ thẳng `<integration>/<model>`, không khai báo `providers` và không cần key trên đĩa.
 */
export function nexAccountConfig(input: Pick<NexConfigInput, 'root' | 'engine' | 'dataDir'> & {
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
