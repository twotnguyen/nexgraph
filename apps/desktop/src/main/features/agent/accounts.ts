import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { CredentialSynchronizationError, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { normalizeConsentTarget, sameConsentTarget, type AiConsentTarget, type AuthEventView, type AuthPromptView, type CustomProvider, type LocalModelInfo, type ModelInfo, type ProviderInfo } from '@nexgraph/contracts/agent-types'
import { readJson, writeJson, type SecretStore } from '../../platform/settings'
import { AgentError, classifyProviderError, loadPi, rememberSecret, scrub } from './session'
import { createOpenAiOAuth, revokeOpenAiSession, type OpenAiRegistration } from './openai-auth'
import { contextTooSmall } from './context-window'
import type { NexProvider } from './nex/config'

// pi-coding-agent không tái xuất các kiểu auth; suy ra từ chữ ký login() công khai.
type AuthInteraction = Parameters<ModelRuntime['login']>[2]
type AuthEvent = Parameters<AuthInteraction['notify']>[0]
type AuthPrompt = Parameters<AuthInteraction['prompt']>[0]
type Credential = Awaited<ReturnType<ModelRuntime['login']>>
type CredentialInfo = Awaited<ReturnType<ModelRuntime['listCredentials']>>[number]

const VAULT_KEY = 'credentials'

function credentialMap(raw: string): Record<string, Credential> {
  const data: unknown = JSON.parse(raw)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid credential storage')
  for (const c of Object.values(data)) {
    if (!c || (c.type !== 'oauth' && c.type !== 'api_key')) throw new Error('invalid credential entry')
  }
  return data as Record<string, Credential>
}

function storageError(e: unknown): AgentError {
  return (e as { code?: string })?.code === 'no_keychain'
    ? new AgentError('no_keychain', 'Kho khoá an toàn của hệ điều hành không khả dụng. Không thể sử dụng đăng nhập OAuth.')
    : new AgentError('oauth_storage', 'Không mở được kho đăng nhập OAuth hoặc chưa di trú xong thông tin đăng nhập cũ.')
}

function rememberCredential(c?: Credential): Credential | undefined {
  if (c?.type === 'oauth') {
    rememberSecret(c.access)
    rememberSecret(c.refresh)
  } else if (c?.type === 'api_key') rememberSecret(c.key)
  return c
}

/** Pi dùng chung kho mã hoá cho đăng nhập lẫn làm mới OAuth. Mọi cập nhật được xếp hàng. */
class SecureCredentialStore {
  private chain: Promise<unknown> = Promise.resolve()
  private migrated = false

  constructor(private readonly secrets: SecretStore, private readonly legacyFile: string) {}

  private readVault(): Record<string, Credential> {
    const raw = this.secrets.readStrict(VAULT_KEY)
    return raw === null ? {} : credentialMap(raw)
  }

  private all(): Record<string, Credential> {
    try {
      const existing = this.readVault()
      if (this.migrated) return existing
      let raw: string
      try {
        raw = readFileSync(this.legacyFile, 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        this.migrated = true
        return existing
      }
      // Nếu đã ghi bản mã nhưng chưa xoá được bản cũ, giữ phiên bản mã hoá khi thử lại.
      const combined = { ...credentialMap(raw), ...existing }
      const payload = JSON.stringify(combined)
      this.secrets.set(VAULT_KEY, payload)
      if (this.secrets.readStrict(VAULT_KEY) !== payload) throw new Error('credential migration verification failed')
      unlinkSync(this.legacyFile)
      this.migrated = true
      return combined
    } catch (e) {
      throw storageError(e)
    }
  }

  private write(all: Record<string, Credential>): void {
    try { this.secrets.set(VAULT_KEY, JSON.stringify(all)) } catch (e) { throw storageError(e) }
  }

  requireReady(): void {
    this.all()
  }

  issue(): string | undefined {
    try { this.requireReady() } catch (e) { return (e as Error).message }
  }

  async read(providerId: string): Promise<Credential | undefined> {
    try {
      const all = this.all()
      return Object.hasOwn(all, providerId) ? rememberCredential(all[providerId]) : undefined
    } catch { return undefined }
  }

  async list(): Promise<readonly CredentialInfo[]> {
    try { return Object.entries(this.all()).map(([providerId, c]) => ({ providerId, type: c.type })) } catch { return [] }
  }

  async modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    return this.enqueue(async () => {
      const all = this.all()
      const next = await fn(Object.hasOwn(all, providerId) ? rememberCredential(all[providerId]) : undefined)
      if (next === undefined) return undefined // hợp đồng CredentialStore: undefined = giữ nguyên mục
      this.write({ ...all, [providerId]: next })
      return rememberCredential(next)
    })
  }

  async delete(providerId: string): Promise<void> {
    await this.enqueue(async () => {
      const all = this.all()
      if (!Object.hasOwn(all, providerId)) return
      delete all[providerId]
      this.write(all)
    })
  }

  restore(providerId: string, written: Credential, before?: Credential): Promise<void> {
    return this.enqueue(async () => {
      const all = this.all()
      if (JSON.stringify(all[providerId]) !== JSON.stringify(written)) return
      if (before) this.write({ ...all, [providerId]: before })
      else {
        delete all[providerId]
        this.write(all)
      }
    })
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.catch(() => {})
    return run
  }
}

export type AccountDevHooks = {
  /** Giả lập `setRuntimeApiKey` lỗi khi Đăng xuất để kiểm nhánh G2. Chỉ được nối khi app chưa đóng gói. */
  failRestoreKey?: boolean
}

export type AccountDeps = {
  dataDir: string
  prefsFile: string
  secrets: SecretStore
  openExternal(url: string): void
  /** Sự kiện đăng nhập (auth_url, device_code…) gửi xuống renderer. */
  notify(event: AuthEventView): void
  /** Thông báo không thuộc luồng đăng nhập (sau Đăng xuất): không đi kèm sự kiện đăng nhập. */
  notice(message: string): void
  /** Catalog model đổi ở main (refresh nền sau khi lưu key): renderer tải lại danh sách. */
  modelsChanged(providerId: string): void
  /** Câu hỏi đăng nhập hiện ở renderer; trả về chuỗi nhập, `null` khi renderer huỷ. */
  ask(prompt: AuthPromptView): Promise<string | null>
  /** Hook kiểm thử do lớp khởi tạo truyền vào; vắng ở bản đóng gói. */
  devHooks?: AccountDevHooks
}

/** Mặc định cho provider OpenAI-compatible chưa khai báo: cửa sổ 128k (đủ cho system prompt + schema tool của NexGraph),
 *  đầu ra 4096. Trước đây 4096/1024 khiến SDK kẹp `max_completion_tokens` còn 1 và mọi lượt chat bị provider từ chối. */
export const CUSTOM_CONTEXT_WINDOW = 128_000
export const CUSTOM_MAX_TOKENS = 4096
export const CUSTOM_MODEL_SPEC = (id: string, metadata?: CustomProvider) => ({
  id, name: id, reasoning: false, input: ['text'] as ('text' | 'image')[],
  // Pi yêu cầu số cho chi phí và giới hạn. View giữ null/undefined khi người dùng chưa xác nhận metadata.
  cost: { input: metadata?.cost?.input ?? 0, output: metadata?.cost?.output ?? 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: metadata?.contextWindow ?? CUSTOM_CONTEXT_WINDOW, maxTokens: metadata?.maxTokens ?? CUSTOM_MAX_TOKENS
})

const OLLAMA_ID = 'ollama-local'
/** Câu thử kết nối chỉ có 1 message + 1 tool: cửa sổ 32k là đủ, không phụ thuộc context window người dùng khai. */
const PROBE_CONTEXT_WINDOW = 32_768
const PROBE_MAX_TOKENS = 256
const OLLAMA_DEFAULT = 'http://127.0.0.1:11434/v1'
const BLOCKED_OAUTH = new Set(['anthropic'])
/**
 * Provider có catalog pi.dev: pi phủ catalog mới qua mạng cho provider built-in. OpenCode Go/Zen đổi model
 * thường xuyên nên làm mới ngay khi lưu key; provider khác để pi tự làm mới theo nhịp của nó.
 */
const CATALOG_REFRESH = new Set(['opencode-go', 'opencode'])
const finitePositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

/** Local provider chỉ dùng địa chỉ loopback tường minh, không đọc URL do mô hình cung cấp. */
export function localBaseUrl(raw = OLLAMA_DEFAULT): string {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw badUrl('Địa chỉ Ollama không hợp lệ') }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !['http:', 'https:'].includes(url.protocol) ||
      url.username || url.password || url.search || url.hash || !['/', '/v1', '/v1/'].includes(url.pathname)) {
    throw badUrl('Ollama local cần địa chỉ localhost, 127.0.0.1 hoặc ::1 và đường dẫn /v1')
  }
  return `${url.origin}/v1`
}

async function ollamaRequest(baseUrl: string, path: string, body?: object): Promise<Record<string, unknown>> {
  const response = await fetch(`${new URL(baseUrl).origin}/api/${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(12_000),
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  })
  if (!response.ok) throw new AgentError('ai_unreachable', `Ollama trả về HTTP ${response.status}`)
  const text = await response.text()
  if (text.length > 2_000_000) throw new AgentError('too_large', 'Danh sách Ollama vượt giới hạn')
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badUrl('Ollama trả về dữ liệu không hợp lệ')
  return value as Record<string, unknown>
}

/**
 * `context_length` từ `GET {baseUrl}/models` (OpenRouter, vLLM, LM Studio…) khi người dùng để trống ô context window.
 * Best-effort: mạng lỗi/không có trường thì dùng mặc định. Không gọi host công khai khi chưa có key —
 * tránh gửi request không xác thực ra ngoài chỉ vì lưu nhà cung cấp.
 */
export async function discoverContextWindow(baseUrl: string, model: string, apiKey?: string): Promise<number | undefined> {
  let url: URL
  try { url = new URL('models', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`) } catch { return undefined }
  const local = isLocalHost(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && devHttpAllowed())) return undefined
  if (!apiKey && !local) return undefined
  try {
    const response = await fetch(url, {
      redirect: 'error', signal: AbortSignal.timeout(2500),
      ...(apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : {})
    })
    if (!response.ok) return undefined
    const text = (await response.text()).slice(0, 2_000_000)
    const value: unknown = JSON.parse(text)
    const data = value && typeof value === 'object' ? (value as { data?: unknown }).data : undefined
    if (!Array.isArray(data)) return undefined
    const entry = data.find((item) => !!item && typeof item === 'object' && (item as { id?: unknown }).id === model) as Record<string, unknown> | undefined
    for (const field of ['context_length', 'context_window'] as const) {
      const found = entry?.[field]
      if (finitePositive(found) && Number.isInteger(found) && found <= 10_000_000) return found
    }
    return undefined
  } catch { return undefined }
}

const isCustom = (v: unknown): v is CustomProvider =>
  !!v && typeof v === 'object' && typeof (v as CustomProvider).id === 'string' &&
  typeof (v as CustomProvider).label === 'string' && typeof (v as CustomProvider).baseUrl === 'string' &&
  typeof (v as CustomProvider).model === 'string'

// Mặc định CHỈ HTTPS. HTTP chỉ cho localhost/127.0.0.1 khi bật cờ dev tường minh.
const BASE_URL = /^https:\/\/[^\s/]+/i
const PROVIDER_ID = /^[\w.-]{1,64}$/
const devHttpAllowed = (): boolean => /^(1|true)$/i.test(process.env.NEXGRAPH_ALLOW_HTTP_PROVIDER ?? '')

const badUrl = (message: string): AgentError => new AgentError('bad_param', message)

const isLocalHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1'
}

/** Chặn loopback/private/link-local (IPv4 và IPv6, kể cả dạng IPv4-mapped) trước khi đăng ký provider. */
function isBlockedIp(address: string): boolean {
  const a = address.toLowerCase().split('%')[0]
  if (a.startsWith('::ffff:')) return isBlockedIp(a.slice(7))
  if (a.includes(':')) {
    if (a === '::' || a === '::1') return true
    if (/^f[cd][0-9a-f]{2}:/.test(a)) return true // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(a)) return true // fe80::/10
    return false
  }
  const v4 = a.split('.').map(Number)
  if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [x, y] = v4
  return x === 0 || x === 10 || x === 127 || x === 169 && y === 254 || x === 172 && y >= 16 && y <= 31 || x === 192 && y === 168 || x === 100 && y >= 64 && y <= 127
}

/**
 * Kiểm tra Base URL trước mọi `registerProvider`: HTTPS (hoặc HTTP localhost khi bật cờ dev),
 * không trỏ tới IP riêng/link-local sau khi phân giải DNS. Trả origin đã chuẩn hoá.
 */
export async function validateBaseUrl(raw: string): Promise<string> {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw badUrl('Base URL không hợp lệ') }
  if (url.username || url.password) throw badUrl('Base URL không được chứa thông tin đăng nhập')
  const local = isLocalHost(url.hostname)
  if (url.protocol === 'http:') {
    if (!devHttpAllowed() || !local) throw badUrl('Base URL phải dùng HTTPS (HTTP chỉ cho localhost khi bật cờ dev)')
  } else if (url.protocol !== 'https:') throw badUrl('Base URL phải bắt đầu bằng https://')
  if (local && devHttpAllowed()) return url.origin // endpoint dev cục bộ: cố tình cho loopback
  let addresses: { address: string }[]
  try { addresses = await lookup(url.hostname, { all: true }) } catch { throw badUrl('Không phân giải được tên máy chủ của Base URL') }
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address)))
    throw badUrl('Base URL trỏ tới địa chỉ IP riêng hoặc link-local nên bị từ chối')
  return url.origin
}

const cancelled = (): AgentError => new AgentError('ai_cancelled', 'Đã huỷ đăng nhập')

const toAgentError = (e: unknown): AgentError => {
  if (e instanceof AgentError) return e
  const msg = e instanceof Error ? e.message : String(e)
  if (/\babort|cancel|huỷ/i.test(msg)) return cancelled()
  return new AgentError('ai_error', `Đăng nhập thất bại (${scrub(msg)})`)
}

/**
 * Tài khoản AI: nhà cung cấp có sẵn + tuỳ chỉnh, key mã hoá safeStorage (chỉ runtime),
 * OAuth qua `modelRuntime.login` với kho mã hoá, và consent theo dự án + điểm đến của model.
 */
export class AccountService {
  private loginAbort: AbortController | null = null
  private loginProvider: string | null = null

  private constructor(
    readonly modelRuntime: ModelRuntime,
    private readonly deps: AccountDeps,
    private readonly credentials: SecureCredentialStore,
    private readonly registrations: SecretStore
  ) {}

  static async create(deps: AccountDeps): Promise<AccountService> {
    let rt: ModelRuntime
    const credentials = new SecureCredentialStore(deps.secrets.withFile(join(deps.dataDir, 'agent', 'oauth-secrets.json')),
      join(deps.dataDir, 'agent', 'auth.json'))
    try {
      const { ModelRuntime } = await loadPi()
      rt = await ModelRuntime.create({
        credentials,
        modelsPath: join(deps.dataDir, 'agent', 'models.json')
      })
    } catch (e) {
      throw new AgentError('ai_error', `Không nạp được bộ mô hình AI (${scrub(e instanceof Error ? e.message : String(e))})`)
    }
    const registrations = deps.secrets.withFile(join(deps.dataDir, 'agent', 'oauth-registrations.json'))
    const svc = new AccountService(rt, deps, credentials, registrations)
    const openai = rt.getProvider('openai')
    if (openai?.auth.oauth) rt.registerNativeProvider({
      ...openai,
      auth: { ...openai.auth, oauth: createOpenAiOAuth(openai.auth.oauth, {
        readStored: () => svc.openAiRegistration(),
        saveRegistration: (registration) => registrations.set('openai', JSON.stringify({ clientId: registration.clientId, sub: registration.sub }))
      }) }
    })
    svc.migrate()
    svc.installationId()
    // Cấu hình cũ từng lưu http công khai/IP riêng: bỏ qua, không đăng ký và không gắn key.
    for (const c of svc.customs()) {
      try {
        if (c.kind === 'ollama') localBaseUrl(c.baseUrl)
        else await validateBaseUrl(c.baseUrl)
        svc.registerCustom(c)
      } catch { /* provider không an toàn */ }
    }
    // Key chỉ vào runtime (bộ nhớ); không bao giờ ghi vào auth.json/models.json.
    for (const id of deps.secrets.ids()) {
      const key = deps.secrets.get(id)
      try {
        // Credential OAuth trong vault sở hữu provider: key cũ đã lưu không được che khuất nó.
        if (key && rt.getProvider(id) && (await credentials.read(id))?.type !== 'oauth') {
          rememberSecret(key)
          await rt.setRuntimeApiKey(id, key)
        }
      } catch { /* key của provider không còn: bỏ qua, có thể xoá trong Cài đặt */ }
    }
    return svc
  }

  // ----- nhà cung cấp tuỳ chỉnh (prefs.json, không bí mật) -----

  private customs(): CustomProvider[] {
    const list = readJson(this.deps.prefsFile).aiCustomProviders
    return Array.isArray(list) ? list.filter(isCustom) : []
  }

  private saveCustoms(list: CustomProvider[]): void {
    writeJson(this.deps.prefsFile, { ...readJson(this.deps.prefsFile), aiCustomProviders: list })
  }

  private installationId(): string {
    const prefs = readJson(this.deps.prefsFile)
    if (typeof prefs.aiInstallationId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(prefs.aiInstallationId))
      return prefs.aiInstallationId
    const id = randomUUID()
    writeJson(this.deps.prefsFile, { ...prefs, aiInstallationId: id })
    return id
  }

  private async openAiRegistration(): Promise<OpenAiRegistration | undefined> {
    const active = await this.credentials.read('openai')
    if (active?.type === 'oauth' && typeof active.clientId === 'string') return {
      clientId: active.clientId, ...(typeof active.sub === 'string' ? { sub: active.sub } : {}),
      ...(typeof active.idToken === 'string' ? { idToken: active.idToken } : {})
    }
    const raw = this.registrations.readStrict('openai')
    if (!raw) return undefined
    try {
      const value = JSON.parse(raw) as OpenAiRegistration
      if (typeof value.clientId !== 'string' || typeof value.sub !== 'string') throw new Error('invalid registration')
      return { clientId: value.clientId, sub: value.sub }
    } catch { throw storageError(new Error('invalid registration')) }
  }

  async forgetOpenAiRegistration(): Promise<void> {
    if (this.loginAbort) throw new AgentError('bad_param', 'Hãy hủy đăng nhập đang chờ trước')
    const active = await this.credentials.read('openai')
    if (active?.type === 'oauth') throw new AgentError('bad_param', 'Hãy đăng xuất ChatGPT trước khi chọn tài khoản hoặc workspace khác')
    this.registrations.remove('openai')
    this.accountGeneration('openai', true)
  }

  private accountGeneration(provider: string, rotate = false): string {
    const prefs = readJson(this.deps.prefsFile)
    const ids = prefs.aiAccountIds && typeof prefs.aiAccountIds === 'object' && !Array.isArray(prefs.aiAccountIds)
      ? prefs.aiAccountIds as Record<string, unknown> : {}
    if (!rotate && typeof ids[provider] === 'string') return ids[provider] as string
    const id = randomUUID()
    writeJson(this.deps.prefsFile, { ...prefs, aiAccountIds: { ...ids, [provider]: id } })
    return id
  }

  /** Đổi tài khoản/key làm consent cũ hết hiệu lực. Token refresh giữ nguyên generation. */
  private accountId(provider: string, key?: string): string {
    return createHash('sha256').update(this.accountGeneration(provider)).update('\0').update(key ?? '').digest('hex')
  }

  sessionIdentity(): string {
    const selected = this.getSelectedModel()
    return selected ? JSON.stringify([selected.provider,
      this.accountId(selected.provider, this.deps.secrets.get(selected.provider) ?? undefined),
      this.modelRuntime.isUsingOAuth(selected.provider)]) : ''
  }

  selectedModelPricing(): NonNullable<ModelInfo['pricing']> {
    const selected = this.getSelectedModel()
    if (!selected) return 'unknown'
    const custom = this.customs().find((p) => p.id === selected.provider)
    if (custom?.kind === 'ollama') return 'local'
    if (this.modelRuntime.isUsingSubscription(selected.provider)) return 'subscription'
    const model = this.modelRuntime.getModel(selected.provider, selected.id)
    const cost = custom ? custom.cost : model?.cost
    return !cost ? 'unknown' : cost.input === 0 && cost.output === 0 ? 'free' : 'known'
  }

  /** Cùng quy tắc với listProviders: model tuỳ chỉnh chưa khai báo contextWindow thì cửa sổ chỉ là mặc định 128000, không phải số thật. */
  selectedModelWindowKnown(): boolean {
    const selected = this.getSelectedModel()
    const custom = selected && this.customs().find((p) => p.id === selected.provider)
    return !custom || !!custom.contextWindow
  }

  /**
   * Provider OpenAI-compatible đang chọn cho runtime Nex. Đợt N1-A1 chỉ hỗ trợ provider tuỳ chỉnh
   * (base URL + key); OAuth/built-in trả null để renderer giữ runtime Pi.
   * Key chỉ đi vào env của tiến trình con, không vào cấu hình trên đĩa và không trả về renderer.
   */
  nexProvider(): NexProvider | null {
    const selected = this.getSelectedModel()
    if (!selected) return null
    const custom = this.customs().find((p) => p.id === selected.provider)
    if (!custom || custom.id !== selected.provider) return null
    const apiKey = this.deps.secrets.get(custom.id) ?? ''
    return {
      id: custom.id, label: custom.label, baseUrl: custom.baseUrl, apiKey: apiKey || 'unused', model: selected.id,
      ...(custom.contextWindow ? { contextWindow: custom.contextWindow } : {}),
      ...(custom.maxTokens ? { maxTokens: custom.maxTokens } : {}),
      ...(typeof custom.supportsTools === 'boolean' ? { supportsTools: custom.supportsTools } : {})
    }
  }

  /** Model mặc định đã chọn trong khối tài khoản Nex (`prefs.nexSelectedModel`). */
  nexSelectedModel(): { provider: string; id: string } | null {
    const value = readJson(this.deps.prefsFile).nexSelectedModel
    if (!value || typeof value !== 'object') return null
    const { provider, id } = value as { provider?: unknown; id?: unknown }
    return typeof provider === 'string' && typeof id === 'string' ? { provider, id } : null
  }

  /**
   * Provider OpenAI-compatible cho một lựa chọn cụ thể: nhà cung cấp tuỳ chỉnh của app, hoặc
   * provider built-in có baseUrl + API key trong kho bí mật (key chỉ vào env tiến trình con).
   * Trả null khi lựa chọn là tài khoản đăng nhập trong sidecar (OAuth/external) hoặc thiếu key.
   */
  nexProviderFor(selected: { provider: string; id: string } | null): NexProvider | null {
    if (!selected) return null
    const custom = this.customs().find((p) => p.id === selected.provider)
    if (custom) {
      const apiKey = this.deps.secrets.get(custom.id) ?? ''
      return {
        id: custom.id, label: custom.label, baseUrl: custom.baseUrl, apiKey: apiKey || 'unused', model: selected.id,
        ...(custom.contextWindow ? { contextWindow: custom.contextWindow } : {}),
        ...(custom.maxTokens ? { maxTokens: custom.maxTokens } : {}),
        ...(typeof custom.supportsTools === 'boolean' ? { supportsTools: custom.supportsTools } : {})
      }
    }
    const provider = this.modelRuntime.getProvider(selected.provider)
    const key = this.deps.secrets.get(selected.provider)
    if (!provider?.baseUrl || !key) return null
    return {
      id: selected.provider, label: provider.name, baseUrl: provider.baseUrl, apiKey: key, model: selected.id
    }
  }

  /** shortcut: SDK OpenAI trong pi không gửi được request thiếu Authorization; khi chưa có key,
   *  endpoint nhận giá trị sentinel 'unused' của chính pi (server không cần key sẽ bỏ qua). */
  private registerCustom(p: CustomProvider): void {
    this.modelRuntime.registerProvider(p.id, {
      name: p.label, baseUrl: p.baseUrl, api: 'openai-completions', apiKey: 'unused',
      models: [CUSTOM_MODEL_SPEC(p.model, p)]
    })
  }

  async saveCustomProvider(p: CustomProvider, apiKey?: string): Promise<void> {
    if (!PROVIDER_ID.test(p.id)) throw badUrl('ID nhà cung cấp không hợp lệ')
    if (!p.label.trim() || !p.model.trim()) throw badUrl('Thiếu tên hoặc model')
    if (p.kind !== undefined && p.kind !== 'compatible' && p.kind !== 'ollama') throw badUrl('Loại nhà cung cấp không hợp lệ')
    if (p.kind === 'ollama' && p.id !== OLLAMA_ID) throw badUrl('Dùng kết nối Ollama để đăng ký model local')
    for (const field of ['contextWindow', 'maxTokens'] as const) {
      if (p[field] !== undefined && (!finitePositive(p[field]) || !Number.isInteger(p[field]) || p[field]! > 10_000_000))
        throw badUrl('Giới hạn token không hợp lệ')
    }
    if (p.cost && (![p.cost.input, p.cost.output].every((v) => Number.isFinite(v) && v >= 0))) throw badUrl('Đơn giá không hợp lệ')
    const baseUrl = p.kind === 'ollama' ? localBaseUrl(p.baseUrl) : p.baseUrl.trim()
    const origin = p.kind === 'ollama' ? new URL(baseUrl).origin : await validateBaseUrl(baseUrl)
    const previous = this.customs().find((c) => c.id === p.id)
    if (!previous && this.modelRuntime.getProvider(p.id)) throw new AgentError('bad_param', 'ID đã thuộc nhà cung cấp có sẵn')
    // Key của máy chủ cũ không được tự chuyển sang origin khác.
    if (previous && new URL(previous.baseUrl).origin !== origin) await this.removeApiKey(p.id)
    // Ô context window để trống: thử lấy `context_length` thật của model từ nhà cung cấp (không chặn lưu khi lỗi).
    // `/models` lỗi hoặc không khai báo thì giữ giá trị đã lưu của CÙNG model — không xoá về mặc định 128k.
    const discovered = p.contextWindow !== undefined ? undefined
      : p.kind === 'ollama' ? undefined
        : await discoverContextWindow(baseUrl, p.model.trim(), apiKey?.trim() || (this.deps.secrets.get(p.id) ?? undefined))
    const contextWindow = p.contextWindow ?? discovered ?? (previous?.model === p.model.trim() ? previous?.contextWindow : undefined)
    const custom: CustomProvider = {
      id: p.id, label: p.label.trim(), baseUrl, model: p.model.trim(),
      ...(p.kind ? { kind: p.kind } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}),
      ...(typeof p.supportsTools === 'boolean' ? { supportsTools: p.supportsTools } : {}),
      ...(p.cost ? { cost: p.cost } : {})
    }
    this.saveCustoms([...this.customs().filter((c) => c.id !== p.id), custom])
    this.registerCustom(custom)
    if (apiKey !== undefined) {
      const key = apiKey.trim()
      if (key) {
        rememberSecret(key)
        this.deps.secrets.set(p.id, key)
        await this.modelRuntime.setRuntimeApiKey(p.id, key)
        this.accountGeneration(p.id, true)
      } else await this.removeApiKey(p.id)
    }
  }

  async removeCustomProvider(id: string): Promise<void> {
    if (!this.customs().some((c) => c.id === id)) throw new AgentError('bad_param', 'Không có nhà cung cấp tuỳ chỉnh này')
    this.saveCustoms(this.customs().filter((c) => c.id !== id))
    try {
      this.modelRuntime.unregisterProvider(id)
    } catch { /* đã unregister hoặc không còn */ }
    this.deps.secrets.remove(id)
    this.accountGeneration(id, true)
    const sel = this.getSelectedModel()
    if (sel?.provider === id) writeJson(this.deps.prefsFile, { ...readJson(this.deps.prefsFile), aiSelectedModel: null })
  }

  // ----- API key -----

  /** Có thể gọi provider này không khoá ngoài: key đã lưu hoặc đã đăng nhập OAuth. */
  hasKey(providerId: string): boolean {
    return this.deps.secrets.get(providerId) != null || this.modelRuntime.isUsingOAuth(providerId)
  }

  async setApiKey(providerId: string, key: string): Promise<void> {
    if (!this.modelRuntime.getProvider(providerId)) throw new AgentError('bad_param', 'Không có nhà cung cấp này')
    if (!key.trim()) throw new AgentError('bad_param', 'API key trống')
    rememberSecret(key.trim())
    this.deps.secrets.set(providerId, key.trim())
    await this.modelRuntime.setRuntimeApiKey(providerId, key.trim())
    // Refresh catalog chạy nền: mạng chậm không được giữ nút "Lưu key"/ô key ở trạng thái bận.
    void this.refreshModelCatalog(providerId)
    this.accountGeneration(providerId, true)
  }

  /**
   * pi phủ catalog pi.dev qua mạng cho provider built-in (`refreshModels`, tối đa 4 giờ một lần, cần mạng).
   * OpenCode Go/Zen đổi model thường xuyên: làm mới ngay khi lưu key để bộ chọn model thấy model mới.
   * Mạng lỗi không được làm hỏng việc lưu key — catalog đóng gói sẵn vẫn dùng được.
   */
  private async refreshModelCatalog(providerId: string): Promise<void> {
    if (!CATALOG_REFRESH.has(providerId) || !this.modelRuntime.getProvider(providerId)?.refreshModels) return
    const result = await this.modelRuntime.refresh({ allowNetwork: true, providers: [providerId], signal: AbortSignal.timeout(6_000) })
      .catch(() => null)
    // Chỉ báo khi catalog thật sự đổi: renderer tải lại danh sách model (lưu key vẫn không chờ refresh).
    if (result && !result.aborted && !result.errors.has(providerId)) this.deps.modelsChanged(providerId)
  }

  async removeApiKey(providerId: string): Promise<void> {
    this.deps.secrets.remove(providerId)
    if (this.modelRuntime.getProvider(providerId)) await this.modelRuntime.removeRuntimeApiKey(providerId)
    this.accountGeneration(providerId, true)
  }

  async discoverLocal(baseUrl = OLLAMA_DEFAULT): Promise<LocalModelInfo[]> {
    const url = localBaseUrl(baseUrl)
    try {
      const body = await ollamaRequest(url, 'tags')
      if (!Array.isArray(body.models)) throw badUrl('Ollama chưa trả về danh sách model')
      return body.models.slice(0, 200).flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return []
        const model = raw as Record<string, unknown>
        const id = typeof model.name === 'string' ? model.name : model.model
        if (typeof id !== 'string' || !id) return []
        return [{ id, label: id, ...(finitePositive(model.size) ? { sizeBytes: model.size } : {}) }]
      })
    } catch (error) {
      if (error instanceof AgentError) throw error
      throw new AgentError('ai_unreachable', 'Không kết nối được Ollama. Hãy mở Ollama và tải một model.')
    }
  }

  async connectLocal(baseUrl: string, modelId: string): Promise<void> {
    const url = localBaseUrl(baseUrl)
    const models = await this.discoverLocal(url)
    if (!models.some((m) => m.id === modelId)) throw badUrl('Model chưa có trong Ollama local')
    const details = await ollamaRequest(url, 'show', { model: modelId })
    const info = details.model_info && typeof details.model_info === 'object' ? details.model_info as Record<string, unknown> : {}
    const maximumContext = Object.entries(info).find(([key, value]) => key.endsWith('.context_length') && finitePositive(value))?.[1]
    const parameters = typeof details.parameters === 'string' ? details.parameters : ''
    const configuredContext = Number(/(?:^|\n)\s*num_ctx\s+(\d+)/.exec(parameters)?.[1]) || 4096
    const contextWindow = Math.min(configuredContext, finitePositive(maximumContext) ? maximumContext : configuredContext)
    const supportsTools = Array.isArray(details.capabilities) ? details.capabilities.includes('tools') : undefined
    await this.saveCustomProvider({
      id: OLLAMA_ID, label: 'Ollama local', kind: 'ollama', baseUrl: url, model: modelId,
      ...(finitePositive(contextWindow) ? { contextWindow, maxTokens: Math.min(8192, Math.floor(contextWindow / 4)) } : {}),
      ...(typeof supportsTools === 'boolean' ? { supportsTools } : {})
    })
    this.selectModel(OLLAMA_ID, modelId)
  }

  // ----- danh sách provider / model / chọn model -----

  async listProviders(): Promise<ProviderInfo[]> {
    const customProviders = this.customs()
    const customs = new Set(customProviders.map((c) => c.id))
    const oauthStorageIssue = this.credentials.issue()
    return this.modelRuntime.getProviders()
      .filter((p) => p.auth.apiKey || p.auth.oauth || customs.has(p.id))
      .map((p) => ({
        id: p.id, label: p.name,
        hasKey: this.deps.secrets.get(p.id) != null,
        oauth: !!p.auth.oauth && !BLOCKED_OAUTH.has(p.id),
        loggedIn: !!p.auth.oauth && !BLOCKED_OAUTH.has(p.id) && !oauthStorageIssue && this.modelRuntime.isUsingOAuth(p.id),
        ...(p.auth.oauth && !BLOCKED_OAUTH.has(p.id) && oauthStorageIssue ? { oauthStorageIssue } : {}),
        custom: customs.has(p.id),
        authMethods: customProviders.find((c) => c.id === p.id)?.kind === 'ollama'
          ? ['none' as const] : [...(p.auth.apiKey || customs.has(p.id) ? ['api_key' as const] : []),
            ...(p.auth.oauth && !BLOCKED_OAUTH.has(p.id) ? ['oauth' as const] : [])],
        kind: customProviders.find((c) => c.id === p.id)?.kind === 'ollama' ? 'local' as const
          : this.modelRuntime.isUsingSubscription(p.id) ? 'subscription' as const : 'api' as const,
        ...(p.id === 'anthropic' ? { description: 'Claude qua Anthropic API key' }
          : p.id === 'openai' ? { description: 'API key hoặc tài khoản ChatGPT đủ điều kiện' }
            : p.id === 'google' ? { description: 'Gemini API key từ Google AI Studio; quota theo dự án' }
              : p.id === 'openrouter' ? { description: 'Model miễn phí và trả phí theo tài khoản OpenRouter' }
                : p.id === 'opencode-go' ? { description: 'Gói OpenCode Go: dùng API key OpenCode, model lấy từ danh mục của OpenCode' }
                  : p.id === 'opencode' ? { description: 'OpenCode Zen: dùng API key OpenCode, tính phí theo lượng dùng' } : {})
      }))
  }

  async listModels(): Promise<ModelInfo[]> {
    const customs = new Map(this.customs().map((c) => [c.id, c]))
    const out: ModelInfo[] = []
    for (const p of this.modelRuntime.getProviders()) {
      // Chỉ model của provider dùng được: tuỳ chỉnh, đã có key/đăng nhập, hoặc env đã cấu hình.
      if ((!customs.has(p.id) && !this.modelRuntime.hasConfiguredAuth(p.id)) ||
          BLOCKED_OAUTH.has(p.id) && this.modelRuntime.isUsingOAuth(p.id)) continue
      const custom = customs.get(p.id)
      for (const m of this.modelRuntime.getModels(p.id)) {
        const local = custom?.kind === 'ollama'
        const subscription = this.modelRuntime.isUsingSubscription(p.id)
        const cost = custom ? custom.cost : m.cost
        out.push({
          provider: p.id, id: m.id, label: m.name,
          ...(!custom || custom.contextWindow ? { contextWindow: m.contextWindow } : {}),
          ...(!custom || custom.maxTokens ? { maxTokens: m.maxTokens } : {}),
          ...(!custom || typeof custom.supportsTools === 'boolean' ? { supportsTools: custom?.supportsTools ?? true } : {}),
          supportsImages: Array.isArray(m.input) && m.input.includes('image'),
          cost: { input: cost?.input ?? null, output: cost?.output ?? null },
          pricing: local ? 'local' : subscription ? 'subscription'
            : !cost ? 'unknown' : cost.input === 0 && cost.output === 0 ? 'free' : 'known'
        })
      }
    }
    return out
  }

  getSelectedModel(): { provider: string; id: string } | null {
    const s = readJson(this.deps.prefsFile).aiSelectedModel
    if (!s || typeof s !== 'object') return null
    const { provider, id } = s as { provider?: unknown; id?: unknown }
    return typeof provider === 'string' && typeof id === 'string' ? { provider, id } : null
  }

  selectModel(provider: string, id: string): void {
    if (!this.modelRuntime.getModel(provider, id)) throw new AgentError('bad_param', 'Không có model này')
    writeJson(this.deps.prefsFile, { ...readJson(this.deps.prefsFile), aiSelectedModel: { provider, id } })
    // Panel chat đang mở nghe auth:models-changed để đổi model ngay, không cần reload.
    this.deps.modelsChanged(provider)
  }

  // ----- OAuth -----

  async loginOAuth(providerId: string): Promise<void> {
    if (this.loginAbort) throw new AgentError('bad_param', 'Đang có đăng nhập khác đang chạy')
    const p = this.modelRuntime.getProvider(providerId)
    if (!p?.auth.oauth || BLOCKED_OAUTH.has(providerId)) throw new AgentError('bad_param', 'Nhà cung cấp này dùng API key trong NexGraph')
    this.credentials.requireReady()
    const ac = new AbortController()
    this.loginAbort = ac
    this.loginProvider = providerId
    const promptId = randomUUID()
    let seq = 0
    const interaction: AuthInteraction = {
      signal: ac.signal,
      prompt: (prompt: AuthPrompt): Promise<string> => {
        const id = `${promptId}#${++seq}`
        const view: AuthPromptView = {
          id, kind: prompt.type, message: prompt.message,
          ...(prompt.type === 'select'
            ? { options: prompt.options.map((o) => ({ id: o.id, label: o.label, description: o.description })) }
            : { placeholder: prompt.placeholder })
        }
        return this.deps.ask(view).then((value) => {
          if (ac.signal.aborted || value == null) throw cancelled()
          return value
        })
      },
      notify: (event: AuthEvent): void => {
        if (event.type === 'auth_url') {
          this.deps.openExternal(event.url)
          this.deps.notify({ type: 'auth_url', url: event.url, instructions: event.instructions })
        } else if (event.type === 'device_code') {
          // Mở trang xác nhận trước, mã hiển thị ở renderer để người dùng dán.
          this.deps.openExternal(event.verificationUri)
          this.deps.notify({ type: 'device_code', userCode: event.userCode, verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds, expiresInSeconds: event.expiresInSeconds })
        } else if (event.type === 'progress') this.deps.notify({ type: 'progress', message: event.message })
        else this.deps.notify({ type: 'info', message: event.message, links: event.links })
      }
    }
    const before = await this.credentials.read(providerId)
    try {
      await this.modelRuntime.login(providerId, 'oauth', interaction, { agentName: 'NexGraph', getDeviceId: () => this.installationId() })
      // API key đã lưu từ trước không được che khuất phiên OAuth vừa đăng nhập.
      if (this.deps.secrets.get(providerId)) await this.modelRuntime.removeRuntimeApiKey(providerId).catch(() => {})
      this.accountGeneration(providerId, true)
    } catch (e) {
      // Pi chỉ ghi khi lấy được token. Nếu đã ghi nhưng đồng bộ runtime thất bại,
      // hoàn tác đúng phiên bản vừa ghi, tránh đè token được làm mới sau đó.
      if (e instanceof Error && e.name === 'CredentialSynchronizationError') {
        const { credential } = e as CredentialSynchronizationError
        if (credential) {
          await this.credentials.restore(providerId, credential, before)
          await this.modelRuntime.refresh({ allowNetwork: false, providers: [providerId] }).catch(() => {})
        }
      }
      throw toAgentError(e)
    } finally {
      this.loginAbort = null
      this.loginProvider = null
    }
  }

  /** Huỷ đăng nhập đang chạy (renderer reload/crash/đóng cửa sổ hoặc nút Huỷ): mọi prompt đang chờ bị từ chối. */
  cancelLogin(): void {
    this.loginAbort?.abort()
  }

  async logout(providerId: string): Promise<void> {
    const p = this.modelRuntime.getProvider(providerId)
    if (!p?.auth.oauth) throw new AgentError('bad_param', 'Nhà cung cấp này không đăng nhập bằng gói đăng ký')
    if (this.loginProvider === providerId) throw new AgentError('bad_param', 'Hãy hủy đăng nhập đang chạy trước khi đăng xuất')
    this.credentials.requireReady()
    this.accountGeneration(providerId, true)
    let revoked = true
    if (providerId === 'openai') {
      await this.modelRuntime.settleCredentialWrites()
      const active = await this.credentials.read(providerId)
      if (active?.type === 'oauth' && typeof active.clientId === 'string') {
        if (typeof active.sub === 'string') this.registrations.set('openai', JSON.stringify({ clientId: active.clientId, sub: active.sub }))
        revoked = await revokeOpenAiSession(active.refresh, active.clientId)
      }
    }
    try {
      await this.modelRuntime.logout(providerId)
    } catch (e) {
      if (!(e instanceof Error) || e.name !== 'CredentialSynchronizationError') throw e
      const result = await this.modelRuntime.refresh({ allowNetwork: false, providers: [providerId] }).catch(() => null)
      if (!result || result.errors.has(providerId)) {
        // Credential đã bị xoá nhưng runtime chưa đồng bộ: nạp lại key đã lưu trước khi báo lỗi (G1).
        await this.restoreSavedKey(providerId)
        throw new AgentError('ai_error', 'Đã xóa thông tin đăng nhập. Mở lại ứng dụng để đồng bộ danh sách tài khoản.')
      }
    } finally {
      this.accountGeneration(providerId, true)
    }
    await this.restoreSavedKey(providerId)
    if (!revoked) this.deps.notice('Đã đăng xuất trên máy. Chưa xác nhận được thu hồi phiên từ xa. Bạn có thể ngắt NexGraph trong ChatGPT Settings.')
  }

  /**
   * Pi xoá cả override runtime khi logout: nạp lại key đã lưu ngay, đúng cách create() nạp lúc khởi động.
   * Lỗi đồng bộ không được nuốt im lặng: người dùng phải biết key chưa active trong phiên này (G2).
   */
  private async restoreSavedKey(providerId: string): Promise<void> {
    const savedKey = this.deps.secrets.get(providerId)
    if (!savedKey) return
    try {
      // Chỉ nối khi lớp khởi tạo cấp hook dev (app chưa đóng gói); bản cài không đọc env cho nhánh này.
      if (this.deps.devHooks?.failRestoreKey) throw new Error('dev hook: setRuntimeApiKey lỗi')
      if ((await this.credentials.read(providerId))?.type === 'oauth') return
      rememberSecret(savedKey)
      await this.modelRuntime.setRuntimeApiKey(providerId, savedKey)
    } catch {
      this.deps.notice('Đã đăng xuất nhưng chưa nạp lại được API key đã lưu. Key vẫn còn trong kho khoá; mở lại ứng dụng để dùng key.')
    }
  }

  // ----- kiểm tra kết nối: gọi provider thật với model đang chọn -----

  /**
   * "Kiểm tra kết nối" không được phụ thuộc context window người dùng khai: câu thử chỉ có một message + một tool,
   * nên dùng một bản model có cửa sổ đủ rộng và `maxTokens` nhỏ nhưng hợp lệ (>= 16). Trước đây cửa sổ 4096 làm SDK
   * kẹp `max_completion_tokens` còn 1 và provider thật trả 400 ngay ở bước kiểm tra.
   */
  async test(): Promise<{ ok: boolean; message: string; detail?: string; capabilities?: { streaming: boolean; tools: boolean }; contextWarning?: number }> {
    const sel = this.getSelectedModel()
    const model = sel && this.modelRuntime.getModel(sel.provider, sel.id)
    if (!model) return { ok: false, message: 'Chưa chọn model hoặc model không còn' }
    // Cửa sổ ngữ cảnh nhỏ hơn system prompt + công cụ: kết nối được nhưng chat sẽ luôn hỏng, phải cảnh báo ngay.
    const window = model.contextWindow
    const selection = this.consentSelection()
    try {
      if (BLOCKED_OAUTH.has(model.provider) && this.modelRuntime.isUsingOAuth(model.provider))
        throw new AgentError('ai_not_configured', 'Hãy kết nối Claude bằng Anthropic API key')
      const marker = randomUUID()
      const stream = this.modelRuntime.streamSimple({ ...model, contextWindow: Math.max(model.contextWindow, PROBE_CONTEXT_WINDOW) }, {
        messages: [{ role: 'user', content: `Call nexgraph_connection_check with value "${marker}".`, timestamp: Date.now() }],
        tools: [{ name: 'nexgraph_connection_check', description: 'A connection probe with no side effects.',
          parameters: Type.Object({ value: Type.String() }) }]
      }, { signal: AbortSignal.timeout(20_000), maxTokens: PROBE_MAX_TOKENS })
      let streaming = false
      for await (const event of stream) {
        if (event.type === 'text_delta' || event.type === 'toolcall_delta') streaming = true
      }
      const result = await stream.result()
      this.ensureSelection(selection)
      if (result.stopReason === 'error' || result.stopReason === 'aborted') throw new Error(result.errorMessage ?? 'Kiểm tra bị gián đoạn')
      const tools = result.content.some((part) => part.type === 'toolCall' && part.name === 'nexgraph_connection_check' && part.arguments.value === marker)
      return { ok: true, message: tools ? 'Kết nối được và gọi công cụ thành công' : 'Kết nối được; model chưa xác nhận gọi công cụ',
        capabilities: { streaming, tools }, ...(contextTooSmall(window) ? { contextWarning: window } : {}) }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      // Lỗi 4xx nói rõ sai key / sai model / yêu cầu không hợp lệ, kèm thông điệp ngắn của provider.
      const failure = classifyProviderError(raw)
      return failure.code === 'ai_error'
        ? { ok: false, message: scrub(raw) }
        : { ok: false, message: failure.message, ...(failure.detail ? { detail: failure.detail } : {}) }
    }
  }

  private consentModel() {
    const sel = this.getSelectedModel()
    const model = sel && this.modelRuntime.getModel(sel.provider, sel.id)
    return model && (model.type === undefined || model.type === 'chat') ? model : null
  }

  private consentSelection(): string {
    const model = this.consentModel()
    return model ? JSON.stringify([model.provider, model.id, model.baseUrl, this.sessionIdentity()]) : ''
  }

  async getConsentTarget(): Promise<AiConsentTarget | null> {
    const model = this.consentModel()
    if (!model) return null
    if (BLOCKED_OAUTH.has(model.provider) && this.modelRuntime.isUsingOAuth(model.provider))
      throw new AgentError('ai_not_configured', 'Hãy kết nối Claude bằng Anthropic API key')
    const selection = this.consentSelection()
    let baseUrl = model.baseUrl
    let accountKey: string | undefined
    if (this.modelRuntime.isUsingOAuth(model.provider)) {
      this.credentials.requireReady()
      const resolved = await this.modelRuntime.getAuth(model, { signal: AbortSignal.timeout(10_000) })
      if (!resolved) throw new AgentError('ai_not_configured', 'Không xác minh được điểm đến OAuth. Hãy kiểm tra tài khoản trong Cài đặt.')
      baseUrl = resolved.auth.baseUrl ?? baseUrl
    } else {
      const resolved = await this.modelRuntime.getAuth(model, { signal: AbortSignal.timeout(10_000) })
      accountKey = resolved?.auth.apiKey
    }
    this.ensureSelection(selection)
    return normalizeConsentTarget(model.provider, baseUrl, this.accountId(model.provider, accountKey))
  }

  private ensureSelection(selection: string): void {
    if (this.consentSelection() !== selection)
      throw new AgentError('ai_provider_changed', 'Nhà cung cấp AI đã thay đổi. Hãy kiểm tra lại trước khi gửi.')
  }

  private consentKey(projectId: string, selected: string, requested: AiConsentTarget, active: AiConsentTarget | null): string {
    this.ensureSelection(selected)
    if (!sameConsentTarget(requested, active))
      throw new AgentError('ai_provider_changed', 'Nhà cung cấp AI đã thay đổi. Hãy kiểm tra lại trước khi gửi.')
    return JSON.stringify([projectId, requested.provider, requested.baseUrl, requested.accountId])
  }

  async hasConsent(projectId: string, target: AiConsentTarget): Promise<boolean> {
    const selection = this.consentSelection()
    const entry = this.consentKey(projectId, selection, target, await this.getConsentTarget())
    const list = readJson(this.deps.prefsFile).aiConsent
    return Array.isArray(list) && list.includes(entry)
  }

  async grantConsent(projectId: string, target: AiConsentTarget): Promise<void> {
    const selection = this.consentSelection()
    const entry = this.consentKey(projectId, selection, target, await this.getConsentTarget())
    const prefs = readJson(this.deps.prefsFile)
    const list = Array.isArray(prefs.aiConsent) ? (prefs.aiConsent as string[]) : []
    if (!list.includes(entry)) writeJson(this.deps.prefsFile, { ...prefs, aiConsent: [...list, entry] })
  }

  // ----- di trú cấu hình cũ (một lần) -----

  private migrate(): void {
    const prefs = readJson(this.deps.prefsFile)
    if (prefs.aiMigrated) return
    const baseUrl = typeof prefs.aiBaseUrl === 'string' ? prefs.aiBaseUrl : ''
    const model = typeof prefs.aiModel === 'string' ? prefs.aiModel : ''
    const next: Record<string, unknown> = { ...prefs, aiMigrated: true }
    if (BASE_URL.test(baseUrl) && model) {
      const custom = { id: 'custom-1', label: 'Nhà cung cấp cũ', baseUrl, model }
      const current = Array.isArray(prefs.aiCustomProviders) ? prefs.aiCustomProviders.filter(isCustom) : []
      next.aiCustomProviders = current.some((p) => p.id === custom.id) ? current : [...current, custom]
      if (!this.getSelectedModel()) next.aiSelectedModel = { provider: custom.id, id: custom.model }
      this.deps.secrets.migrateLegacyKey(custom.id)
    }
    writeJson(this.deps.prefsFile, next)
  }
}
