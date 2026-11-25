import { readJson, writeJson } from '../../ai/settings'
import {
  NexClient, type NexAttemptState, type NexIntegration, type NexIntegrationMethod
} from './client'
import type {
  NexAccountConnection, NexAccountMethod, NexAccountProvider, NexAccountsView, NexAuthStartView, NexAuthStatusView
} from '../../../shared/agent-types'

/**
 * Nhà cung cấp hiện trong khối "Tài khoản AI cho Nex". Chỉ những integration có đăng nhập gói
 * hoặc API key phổ biến (brief N2-A2); thứ tự này là thứ tự hiển thị.
 * `ollama` không có integration riêng — Ollama local đi qua nhà cung cấp tuỳ chỉnh của app.
 */
export const NEX_ACCOUNT_INTEGRATIONS = [
  'openai', 'anthropic', 'claude-agent', 'github-copilot', 'opencode', 'google', 'xai', 'openrouter', 'lmstudio'
] as const

/**
 * Host được phép mở bằng trình duyệt hệ thống khi đăng nhập. Chỉ https; so khớp chính xác hoặc
 * tên miền con của host trong danh sách (không nhận `github.com.evil`).
 */
export const NEX_AUTH_HOSTS = [
  'auth.openai.com', 'chatgpt.com', 'github.com', 'gitlab.com', 'opencode.ai',
  'accounts.google.com', 'console.anthropic.com', 'claude.ai', 'x.ai', 'accounts.x.ai', 'openrouter.ai'
] as const

const coded = (code: string, message: string): Error => Object.assign(new Error(message), { name: 'AgentError', code })

export type NexAuthUrlCheck =
  | { ok: true; url: string }
  | { ok: false; reason: 'invalid_url' | 'host_not_allowed' }

/** Kiểm URL đăng nhập trước khi gọi `shell.openExternal`. */
export function checkNexAuthUrl(raw: unknown): NexAuthUrlCheck {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'invalid_url' }
  let url: URL
  try { url = new URL(raw) } catch { return { ok: false, reason: 'invalid_url' } }
  if (url.protocol !== 'https:' || url.username || url.password) return { ok: false, reason: 'invalid_url' }
  const host = url.hostname.toLowerCase()
  const allowed = NEX_AUTH_HOSTS.some((item) => host === item || host.endsWith(`.${item}`))
  return allowed ? { ok: true, url: url.href } : { ok: false, reason: 'host_not_allowed' }
}

/** Mã device flow nằm trong `instructions` của sidecar: "Enter code: 520C-1E7F". */
export function deviceCodeFromInstructions(instructions: string | undefined): string | undefined {
  if (!instructions) return undefined
  return /(?:code|mã)\s*[:]\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i.exec(instructions)?.[1]
}

const methodView = (method: NexIntegrationMethod): NexAccountMethod => ({
  id: method.id ?? method.type,
  type: method.type === 'env' ? 'key' : method.type,
  label: method.label ?? method.type,
  ...(method.form?.length
    ? {
        form: method.form.flatMap((field) => typeof field.key === 'string'
          ? [{
              key: field.key,
              title: field.title ?? field.key,
              required: field.required !== false,
              ...(field.options?.length ? { options: field.options } : {})
            }]
          : [])
      }
    : {})
})

const connectionView = (connection: NexIntegration['connections'][number]): NexAccountConnection => ({
  id: String(connection.id ?? connection.name ?? ''),
  label: String(connection.label ?? connection.name ?? ''),
  method: connection.method ?? 'key',
  ...(connection.status ? { problem: { message: connection.status.message, ...(connection.status.url ? { url: connection.status.url } : {}) } } : {})
})

const isCredential = (connection: NexIntegration['connections'][number]): boolean =>
  connection.type === 'credential' && !!connection.id

/** Nhà cung cấp OpenAI-compatible tuỳ chỉnh của app (kho bí mật + env như N1-A1). */
export type NexCustomProviderInput = {
  id: string
  label: string
  hasKey: boolean
  models: { id: string; label: string }[]
}

/** Gộp nhà cung cấp tuỳ chỉnh của app vào cuối danh sách integration của sidecar. */
export function withCustomProviders(view: NexAccountsView, customs: NexCustomProviderInput[]): NexAccountsView {
  const providers = customs.map((custom): NexAccountProvider => ({
    id: custom.id,
    name: custom.label,
    connected: custom.hasKey,
    connections: custom.hasKey ? [{ id: custom.id, label: 'API key', method: 'key' }] : [],
    methods: [{ id: 'key', type: 'key', label: 'API key' }],
    models: custom.models
  }))
  return { ...view, providers: [...view.providers, ...providers] }
}

export type NexAccountManagerOptions = {
  /** Khởi động (hoặc nối lại) sidecar tài khoản; ném lỗi khi máy không có runtime. */
  connect: () => Promise<{ baseUrl: string; password: string }>
  /** Mở URL sau khi đã kiểm; mặc định `shell.openExternal` do ipc.ts truyền vào. */
  openExternal: (url: string) => void | Promise<void>
  prefsFile: string
  /** Ghi log chẩn đoán — không bao giờ nhận token/key/nội dung phản hồi sidecar. */
  log?: (line: string) => void
  close?: () => Promise<void>
  clientFactory?: (options: { baseUrl: string; password: string }) => NexClient
}

/**
 * Quản lý tài khoản AI của Nex qua API integration của sidecar: liệt kê nhà cung cấp/trạng thái,
 * bắt đầu và theo dõi OAuth/device, đăng xuất. Token do sidecar lưu trong `<userData>/nex/`;
 * lớp này không đọc, không trả và không log token.
 */
export class NexAccountManager {
  private clientPromise: Promise<NexClient> | null = null

  constructor(private readonly o: NexAccountManagerOptions) {}

  private client(): Promise<NexClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.o.connect()
        .then((ready) => (this.o.clientFactory ?? ((input) => new NexClient(input)))(ready))
        .catch((error: unknown) => {
          this.clientPromise = null
          const reason = (error as { code?: string }).code === 'nex_not_available' ? 'no_runtime' : 'sidecar_error'
          throw coded(`nex_${reason}`, reason === 'no_runtime'
            ? 'Chưa tìm thấy runtime Nex trên máy này.'
            : 'Không khởi động được dịch vụ tài khoản Nex.')
        })
    }
    return this.clientPromise
  }

  /** Dùng cho IPC: báo lỗi có mã để renderer dịch câu. */
  private static noRuntime(error: unknown): boolean {
    return (error as { code?: string }).code === 'nex_no_runtime' || (error as { code?: string }).code === 'nex_not_available'
  }

  async list(): Promise<NexAccountsView> {
    let client: NexClient
    try { client = await this.client() } catch (error) {
      return {
        available: false,
        reason: NexAccountManager.noRuntime(error) ? 'no_runtime' : 'sidecar_error',
        providers: [], selected: this.selected()
      }
    }
    try {
      const [integrations, models] = await Promise.all([client.integrations(), client.models().catch(() => [])])
      const providers = NEX_ACCOUNT_INTEGRATIONS.flatMap((id): NexAccountProvider[] => {
        const integration = integrations.find((item) => item.id === id)
        if (!integration) return []
        const connections = integration.connections.map(connectionView)
        const methods = integration.methods
          .filter((method) => method.type !== 'env')
          .map(methodView)
        return [{
          id,
          name: integration.name,
          connected: integration.connections.some(isCredential),
          connections,
          methods,
          models: models.filter((model) => model.providerID === id).map((model) => ({
            id: model.id, label: model.name && model.name !== model.id ? `${model.name}` : model.id
          }))
        }]
      })
      return { available: true, providers, selected: this.selected() }
    } catch (error) {
      this.o.log?.(`nex accounts list lỗi: ${(error as Error).name}`)
      return {
        available: false,
        reason: NexAccountManager.noRuntime(error) ? 'no_runtime' : 'sidecar_error',
        providers: [], selected: this.selected()
      }
    }
  }

  selected(): { provider: string; id: string } | null {
    const value = readJson(this.o.prefsFile).nexSelectedModel
    if (!value || typeof value !== 'object') return null
    const { provider, id } = value as { provider?: unknown; id?: unknown }
    return typeof provider === 'string' && typeof id === 'string' ? { provider, id } : null
  }

  /** Lưu lựa chọn model mặc định cho Nex (cùng tệp prefs app đang dùng cho model). */
  saveSelection(selection: { provider: string; id: string } | null): void {
    const prefs = readJson(this.o.prefsFile)
    if (selection) writeJson(this.o.prefsFile, { ...prefs, nexSelectedModel: { provider: selection.provider, id: selection.id } })
    else {
      delete prefs.nexSelectedModel
      writeJson(this.o.prefsFile, prefs)
    }
  }

  /** Chọn model của một integration: phải có trong danh sách model sidecar trả về. */
  async selectModel(provider: string, id: string): Promise<void> {
    const client = await this.client()
    const models = await client.models()
    if (!models.some((model) => model.providerID === provider && model.id === id))
      throw coded('bad_param', 'Không có model này trong runtime Nex')
    this.saveSelection({ provider, id })
  }

  /**
   * Bắt đầu đăng nhập. OAuth/device: sidecar trả URL + mã; URL chỉ được mở sau khi kiểm https và
   * host. `key`: không gửi key qua sidecar — renderer nhập key vào kho bí mật của app (N1-A1).
   */
  async startAuth(integrationId: string, methodId: string, answers?: Record<string, unknown>): Promise<NexAuthStartView> {
    const client = await this.client()
    const integration = (await client.integrations()).find((item) => item.id === integrationId)
    if (!integration) throw coded('bad_param', 'Không có nhà cung cấp này trong runtime Nex')
    const method = integration.methods.find((item) => (item.id ?? item.type) === methodId)
    if (!method) throw coded('bad_param', 'Nhà cung cấp không hỗ trợ cách đăng nhập này')

    if (method.type === 'key') return { kind: 'key', integrationId }
    if (method.type === 'external') {
      await client.connectExternal(integrationId, methodId)
      return {
        kind: 'external', integrationId,
        instructions: method.label ?? 'Đăng nhập bằng công cụ chính thức của nhà cung cấp, rồi bấm Kiểm tra lại.'
      }
    }
    if (method.type === 'command') {
      const attempt = await client.connectCommand(integrationId, methodId)
      return {
        kind: 'command', integrationId, attemptId: attempt.attemptID,
        ...(method.command?.length ? { instructions: method.command.join(' ') } : {})
      }
    }

    const attempt = await client.connectOAuth(integrationId, methodId, answers)
    const check = checkNexAuthUrl(attempt.url)
    let opened = false
    if (check.ok) {
      try { await this.o.openExternal(check.url); opened = true } catch { opened = false }
    }
    return {
      kind: 'oauth', integrationId, attemptId: attempt.attemptID,
      ...(typeof attempt.url === 'string' ? { url: attempt.url } : {}),
      ...(attempt.instructions ? { instructions: attempt.instructions } : {}),
      ...(deviceCodeFromInstructions(attempt.instructions)
        ? { userCode: deviceCodeFromInstructions(attempt.instructions) } : {}),
      ...(attempt.mode ? { mode: attempt.mode } : {}),
      opened,
      ...(!check.ok ? { blockedReason: check.reason } : {})
    }
  }

  async authStatus(kind: 'oauth' | 'command', integrationId: string, attemptId: string): Promise<NexAuthStatusView> {
    const client = await this.client()
    const state: NexAttemptState = kind === 'command'
      ? await client.commandStatus(integrationId, attemptId)
      : await client.oauthStatus(integrationId, attemptId)
    const status = state.status === 'pending' || state.status === 'complete' || state.status === 'failed' || state.status === 'expired'
      ? state.status : 'failed'
    return { status, ...(state.message ? { message: state.message } : {}) }
  }

  async cancelAuth(kind: 'oauth' | 'command', integrationId: string, attemptId: string): Promise<void> {
    const client = await this.client()
    if (kind === 'command') await client.cancelCommand(integrationId, attemptId)
    else await client.cancelOAuth(integrationId, attemptId)
  }

  /** Đăng xuất: xoá mọi credential của integration trong sidecar. */
  async logout(integrationId: string): Promise<void> {
    const client = await this.client()
    const integration = (await client.integrations()).find((item) => item.id === integrationId)
    if (!integration) throw coded('bad_param', 'Không có nhà cung cấp này trong runtime Nex')
    const credentials = integration.connections.filter(isCredential)
    for (const connection of credentials) await client.removeCredential(String(connection.id))
    if (this.selected()?.provider === integrationId) this.saveSelection(null)
  }

  /** Sidecar khởi động lại (mật khẩu/cổng mới): bỏ client cũ, lần gọi sau nối lại. */
  resetClient(): void {
    this.clientPromise = null
  }

  async stop(): Promise<void> {
    this.clientPromise = null
    await this.o.close?.()
  }
}
