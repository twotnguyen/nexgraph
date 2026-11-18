import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { CredentialSynchronizationError, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { normalizeConsentTarget, sameConsentTarget, type AiConsentTarget, type AuthEventView, type AuthPromptView, type CustomProvider, type ModelInfo, type ProviderInfo } from '../../shared/agent-types'
import { readJson, writeJson, type SecretStore } from '../ai/settings'
import { AgentError, loadPi, rememberSecret, scrub } from './session'

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

export type AccountDeps = {
  dataDir: string
  prefsFile: string
  secrets: SecretStore
  openExternal(url: string): void
  /** Sự kiện đăng nhập (auth_url, device_code…) gửi xuống renderer. */
  notify(event: AuthEventView): void
  /** Câu hỏi đăng nhập hiện ở renderer; trả về chuỗi nhập, `null` khi renderer huỷ. */
  ask(prompt: AuthPromptView): Promise<string | null>
}

export const CUSTOM_MODEL_SPEC = (id: string) => ({
  id, name: id, reasoning: false, input: ['text'] as ('text' | 'image')[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8192
})

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
    private readonly credentials: SecureCredentialStore
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
    const svc = new AccountService(rt, deps, credentials)
    svc.migrate()
    // Cấu hình cũ từng lưu http công khai/IP riêng: bỏ qua, không đăng ký và không gắn key.
    for (const c of svc.customs()) {
      try { await validateBaseUrl(c.baseUrl); svc.registerCustom(c) } catch { /* provider không an toàn */ }
    }
    // Key chỉ vào runtime (bộ nhớ); không bao giờ ghi vào auth.json/models.json.
    for (const id of deps.secrets.ids()) {
      const key = deps.secrets.get(id)
      try {
        if (key && rt.getProvider(id)) {
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

  /** shortcut: SDK OpenAI trong pi không gửi được request thiếu Authorization; khi chưa có key,
   *  endpoint nhận giá trị sentinel 'unused' của chính pi (server không cần key sẽ bỏ qua). */
  private registerCustom(p: CustomProvider): void {
    this.modelRuntime.registerProvider(p.id, {
      name: p.label, baseUrl: p.baseUrl, api: 'openai-completions', apiKey: 'unused',
      models: [CUSTOM_MODEL_SPEC(p.model)]
    })
  }

  async saveCustomProvider(p: CustomProvider, apiKey?: string): Promise<void> {
    if (!PROVIDER_ID.test(p.id)) throw badUrl('ID nhà cung cấp không hợp lệ')
    if (!p.label.trim() || !p.model.trim()) throw badUrl('Thiếu tên hoặc model')
    const origin = await validateBaseUrl(p.baseUrl) // HTTPS (hoặc localhost+cờ dev) + DNS + chặn IP riêng TRƯỚC registerProvider/gắn key
    const previous = this.customs().find((c) => c.id === p.id)
    if (!previous && this.modelRuntime.getProvider(p.id)) throw new AgentError('bad_param', 'ID đã thuộc nhà cung cấp có sẵn')
    // Key của máy chủ cũ không được tự chuyển sang origin khác.
    if (previous && new URL(previous.baseUrl).origin !== origin) await this.removeApiKey(p.id)
    const custom: CustomProvider = { id: p.id, label: p.label.trim(), baseUrl: p.baseUrl.trim(), model: p.model.trim() }
    this.saveCustoms([...this.customs().filter((c) => c.id !== p.id), custom])
    this.registerCustom(custom)
    if (apiKey !== undefined) {
      const key = apiKey.trim()
      if (key) {
        rememberSecret(key)
        this.deps.secrets.set(p.id, key)
        await this.modelRuntime.setRuntimeApiKey(p.id, key)
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
  }

  async removeApiKey(providerId: string): Promise<void> {
    this.deps.secrets.remove(providerId)
    if (this.modelRuntime.getProvider(providerId)) await this.modelRuntime.removeRuntimeApiKey(providerId)
  }

  // ----- danh sách provider / model / chọn model -----

  async listProviders(): Promise<ProviderInfo[]> {
    const customs = new Set(this.customs().map((c) => c.id))
    const oauthStorageIssue = this.credentials.issue()
    return this.modelRuntime.getProviders()
      .filter((p) => p.auth.apiKey || p.auth.oauth || customs.has(p.id))
      .map((p) => ({
        id: p.id, label: p.name,
        hasKey: this.hasKey(p.id),
        oauth: !!p.auth.oauth,
        loggedIn: !!p.auth.oauth && !oauthStorageIssue && this.modelRuntime.isUsingOAuth(p.id),
        ...(p.auth.oauth && oauthStorageIssue ? { oauthStorageIssue } : {}),
        custom: customs.has(p.id)
      }))
  }

  async listModels(): Promise<ModelInfo[]> {
    const customs = new Set(this.customs().map((c) => c.id))
    const out: ModelInfo[] = []
    for (const p of this.modelRuntime.getProviders()) {
      // Chỉ model của provider dùng được: tuỳ chỉnh, đã có key/đăng nhập, hoặc env đã cấu hình.
      if (!customs.has(p.id) && !this.modelRuntime.hasConfiguredAuth(p.id)) continue
      for (const m of this.modelRuntime.getModels(p.id)) out.push({ provider: p.id, id: m.id, label: m.name })
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
  }

  // ----- OAuth -----

  async loginOAuth(providerId: string): Promise<void> {
    if (this.loginAbort) throw new AgentError('bad_param', 'Đang có đăng nhập khác đang chạy')
    const p = this.modelRuntime.getProvider(providerId)
    if (!p?.auth.oauth) throw new AgentError('bad_param', 'Nhà cung cấp này không hỗ trợ đăng nhập bằng gói đăng ký')
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
      await this.modelRuntime.login(providerId, 'oauth', interaction, { agentName: 'NexGraph' })
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
    try {
      await this.modelRuntime.logout(providerId)
    } catch (e) {
      if (!(e instanceof Error) || e.name !== 'CredentialSynchronizationError') throw e
      const result = await this.modelRuntime.refresh({ allowNetwork: false, providers: [providerId] }).catch(() => null)
      if (!result || result.errors.has(providerId)) throw new AgentError('ai_error', 'Đã xóa thông tin đăng nhập. Mở lại ứng dụng để đồng bộ danh sách tài khoản.')
    }
  }

  // ----- kiểm tra kết nối: gọi provider thật với model đang chọn -----

  async test(): Promise<{ ok: boolean; message: string }> {
    const sel = this.getSelectedModel()
    const model = sel && this.modelRuntime.getModel(sel.provider, sel.id)
    if (!model) return { ok: false, message: 'Chưa chọn model hoặc model không còn' }
    try {
      await this.modelRuntime.completeSimple(model, { messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }] },
        { signal: AbortSignal.timeout(15_000), maxTokens: 1 })
      return { ok: true, message: 'Kết nối được' }
    } catch (e) {
      return { ok: false, message: scrub(e instanceof Error ? e.message : String(e)) }
    }
  }

  private consentModel() {
    const sel = this.getSelectedModel()
    const model = sel && this.modelRuntime.getModel(sel.provider, sel.id)
    return model && (model.type === undefined || model.type === 'chat') ? model : null
  }

  private consentSelection(): string {
    const model = this.consentModel()
    return model ? JSON.stringify([model.provider, model.id, model.baseUrl, this.modelRuntime.isUsingOAuth(model.provider)]) : ''
  }

  async getConsentTarget(): Promise<AiConsentTarget | null> {
    const model = this.consentModel()
    if (!model) return null
    const selection = this.consentSelection()
    let baseUrl = model.baseUrl
    if (this.modelRuntime.isUsingOAuth(model.provider)) {
      this.credentials.requireReady()
      const resolved = await this.modelRuntime.getAuth(model, { signal: AbortSignal.timeout(10_000) })
      if (!resolved) throw new AgentError('ai_not_configured', 'Không xác minh được điểm đến OAuth. Hãy kiểm tra tài khoản trong Cài đặt.')
      baseUrl = resolved.auth.baseUrl ?? baseUrl
    }
    this.ensureSelection(selection)
    return normalizeConsentTarget(model.provider, baseUrl)
  }

  private ensureSelection(selection: string): void {
    if (this.consentSelection() !== selection)
      throw new AgentError('ai_provider_changed', 'Nhà cung cấp AI đã thay đổi. Hãy kiểm tra lại trước khi gửi.')
  }

  private consentKey(projectId: string, selected: string, requested: AiConsentTarget, active: AiConsentTarget | null): string {
    this.ensureSelection(selected)
    if (!sameConsentTarget(requested, active))
      throw new AgentError('ai_provider_changed', 'Nhà cung cấp AI đã thay đổi. Hãy kiểm tra lại trước khi gửi.')
    return JSON.stringify([projectId, requested.provider, requested.baseUrl])
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
