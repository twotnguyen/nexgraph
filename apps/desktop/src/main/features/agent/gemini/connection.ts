import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { AuthEventView, ModelInfo } from '@nexgraph/contracts/agent-types'
import type { GeminiCliStatus } from '@nexgraph/contracts/gemini-types'
import {
  AcpClient,
  AcpError,
  safeGeminiMessage,
  type AcpHandlers,
  type AcpInitializeResult
} from './acp-client'
import { ANTIGRAVITY_CLI_VERSION, GeminiInstallation, type InstallationOptions } from './installation'
import { buildGeminiEnvironment, prepareGeminiProfile } from './profile'
type Metadata = {
  profileId: string
  connectionId: string
  authenticated: boolean
  model: string
  modelSelected: boolean
}
type ConfigOption = { id: string; category?: string; currentValue?: string; options?: unknown[] }
export type GeminiConnectionDeps = InstallationOptions & {
  dataDir: string
  notify(event: AuthEventView): void
  onStatus?(status: GeminiCliStatus): void
}
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value)
const fresh = (): Metadata => ({
  profileId: randomUUID(),
  connectionId: randomUUID(),
  authenticated: false,
  model: '',
  modelSelected: false
})
const choiceOptions = (value: unknown[]): { value: string; name: string }[] =>
  value.flatMap((item) => {
    const entry = object(item)
    return Array.isArray(entry.options)
      ? choiceOptions(entry.options)
      : validId(entry.value)
        ? [{ value: entry.value, name: typeof entry.name === 'string' ? entry.name : entry.value }]
        : []
  })
/** Google auth stays in the official CLI. Connection scope is local, not a verified account identity. */
export class GeminiConnectionManager {
  private readonly installation: GeminiInstallation
  private readonly metadataFile: string
  private metadata: Metadata = fresh()
  private readonly clients = new Set<AcpClient>()
  private readonly opening = new Set<Promise<AcpClient>>()
  private operation?: { kind: 'setup' | 'login'; controller: AbortController }
  private state?: GeminiCliStatus['state']
  private error?: string
  private capabilities?: GeminiCliStatus['capabilities']
  private generation = 0
  private persistence: Promise<void> = Promise.resolve()
  private discovery?: Promise<ModelInfo[]>
  private available: ModelInfo[] = []
  constructor(private readonly deps: GeminiConnectionDeps) {
    if (!isAbsolute(deps.dataDir)) throw new Error('Thư mục dữ liệu Google phải là đường dẫn tuyệt đối')
    this.installation = new GeminiInstallation(deps.dataDir, deps)
    this.metadataFile = join(deps.dataDir, 'antigravity', 'connection.json')
    try {
      const saved = object(JSON.parse(readFileSync(this.metadataFile, 'utf8')))
      if (
        typeof saved.profileId === 'string' &&
        UUID.test(saved.profileId) &&
        typeof saved.connectionId === 'string' &&
        UUID.test(saved.connectionId)
      )
        this.metadata = {
          profileId: saved.profileId,
          connectionId: saved.connectionId,
          authenticated: saved.authenticated === true,
          model: validId(saved.model) ? saved.model : '',
          modelSelected: saved.modelSelected === true
        }
    } catch {
      /* No legacy Gemini token or profile is imported. */
    }
  }
  private persist(): Promise<void> {
    const value = JSON.stringify(this.metadata)
    this.persistence = this.persistence
      .catch(() => {})
      .then(async () => {
        await mkdir(join(this.deps.dataDir, 'antigravity'), { recursive: true, mode: 0o700 })
        const temp = this.metadataFile + '.' + randomUUID() + '.tmp'
        await writeFile(temp, value, { mode: 0o600 })
        await rename(temp, this.metadataFile)
      })
    return this.persistence
  }
  connectionIdentity(): string {
    return this.metadata.connectionId
  }
  selectedModel(): string {
    return this.metadata.model
  }
  async status(): Promise<GeminiCliStatus> {
    const installed = !!this.installation.entry(),
      platformSupported = this.installation.platformSupported()
    return {
      state:
        this.state ??
        (!platformSupported
          ? 'unsupported_platform'
          : !installed
            ? 'not_installed'
            : this.metadata.authenticated
              ? 'connected'
              : 'signed_out'),
      version: ANTIGRAVITY_CLI_VERSION,
      installed,
      platformSupported,
      authenticated: this.metadata.authenticated,
      model: this.metadata.model,
      connectionId: this.metadata.connectionId,
      ...(this.error ? { error: this.error } : {}),
      ...(this.capabilities ? { capabilities: { ...this.capabilities } } : {})
    }
  }
  private async publish(): Promise<GeminiCliStatus> {
    const value = await this.status()
    this.deps.onStatus?.(value)
    return value
  }
  private start(kind: 'setup' | 'login'): AbortController {
    if (this.operation)
      throw new AcpError(
        'google_busy',
        'Google đang cài đặt hoặc đăng nhập. Dừng thao tác trước khi tiếp tục.'
      )
    const controller = new AbortController()
    this.operation = { kind, controller }
    this.error = undefined
    return controller
  }
  async setup(): Promise<GeminiCliStatus> {
    const controller = this.start('setup')
    try {
      this.state = 'installing'
      await this.publish()
      await this.installation.setup(controller.signal, (message) =>
        this.deps.notify({ type: 'progress', message })
      )
      this.state = undefined
    } catch (error) {
      this.error = controller.signal.aborted
        ? 'Đã dừng cài đặt Antigravity CLI'
        : safeGeminiMessage(error instanceof Error ? error.message : error)
      this.state = controller.signal.aborted ? undefined : 'error'
    } finally {
      if (this.operation?.controller === controller) this.operation = undefined
    }
    return this.publish()
  }
  async login(): Promise<GeminiCliStatus> {
    const controller = this.start('login'),
      generation = ++this.generation
    let client: AcpClient | undefined
    try {
      await this.stopClients()
      this.state = 'authenticating'
      await this.publish()
      this.deps.notify({
        type: 'info',
        message:
          'Hoàn tất đăng nhập Google trong trình duyệt. Tài khoản được Antigravity quản lý trên máy này; NexGraph không sao chép thông tin đăng nhập.'
      })
      client = await this.createClient(
        this.deps.dataDir,
        {},
        { signal: controller.signal, skipAuthentication: true }
      )
      if (!client.initializeResult?.authMethods?.some((method) => method.id === 'oauth-personal'))
        throw new AcpError('auth_unavailable', 'Antigravity không cung cấp đăng nhập Google')
      await client.request(
        'authenticate',
        { methodId: 'oauth-personal' },
        { timeoutMs: 360000, signal: controller.signal }
      )
      if (controller.signal.aborted || generation !== this.generation)
        throw new AcpError('cancelled', 'Đã hủy đăng nhập Google')
      this.metadata.authenticated = true
      this.metadata.connectionId = randomUUID()
      this.available = []
      await this.persist()
      this.state = undefined
      this.error = undefined
      this.deps.notify({
        type: 'info',
        message: 'Đã kết nối Google qua Antigravity. Chạy kiểm tra kết nối trước khi dùng trợ lý với dự án.'
      })
    } catch (error) {
      this.error = controller.signal.aborted
        ? 'Đã hủy đăng nhập Google'
        : safeGeminiMessage(error instanceof Error ? error.message : error)
      this.state = controller.signal.aborted ? undefined : 'error'
    } finally {
      if (client)
        await client.close().catch((error) => {
          this.error = safeGeminiMessage(error)
          this.state = 'error'
        })
      if (this.operation?.controller === controller) this.operation = undefined
    }
    return this.publish()
  }
  cancelLogin(): void {
    this.operation?.controller.abort()
    for (const client of this.clients) void client.close().catch(() => {})
  }
  async disconnect(): Promise<void> {
    await this.shutdown()
    this.metadata.authenticated = false
    this.metadata.connectionId = randomUUID()
    this.available = []
    this.state = undefined
    this.error = undefined
    await this.persist()
    await this.publish()
  }
  async shutdown(): Promise<void> {
    ++this.generation
    this.cancelLogin()
    await this.stopClients()
    await Promise.allSettled([...this.opening])
    await this.stopClients()
  }
  /** Only local connection metadata changes. Never logs out or deletes shared Google/CLI auth state. */
  async forget(): Promise<void> {
    await this.disconnect()
  }
  private async stopClients(): Promise<void> {
    const results = await Promise.allSettled([...this.clients].map((client) => client.close()))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
    this.clients.clear()
  }
  createClient(
    root: string,
    handlers: AcpHandlers = {},
    options: {
      maxTurns?: number
      mcpTools?: string[]
      signal?: AbortSignal
      skipAuthentication?: boolean
    } = {}
  ): Promise<AcpClient> {
    const opening = this.openClient(root, handlers, options)
    this.opening.add(opening)
    void opening.then(
      () => this.opening.delete(opening),
      () => this.opening.delete(opening)
    )
    return opening
  }
  private async openClient(
    root: string,
    handlers: AcpHandlers,
    options: { maxTurns?: number; mcpTools?: string[]; signal?: AbortSignal; skipAuthentication?: boolean }
  ): Promise<AcpClient> {
    const generation = this.generation,
      command = this.installation.command()
    if (!command)
      throw new AcpError(
        'google_not_installed',
        'Cài Antigravity CLI trong cài đặt trước khi đăng nhập Google'
      )
    if (options.signal?.aborted) throw new AcpError('cancelled', 'Đã hủy kết nối Google')
    const profile = await prepareGeminiProfile(this.deps.dataDir, this.metadata.profileId, root, options)
    if (options.signal?.aborted || generation !== this.generation)
      throw new AcpError('cancelled', 'Đã hủy kết nối Google')
    const client = AcpClient.launch({
      command: command.executable,
      args: [...command.args, ...profile.args],
      cwd: profile.cwd,
      env: buildGeminiEnvironment(profile),
      handlers: {
        ...handlers,
        onAuthUrl: (url) => {
          this.deps.notify({
            type: 'auth_url',
            url,
            instructions: 'Hoàn tất đăng nhập Google trong trình duyệt.'
          })
          handlers.onAuthUrl?.(url)
        }
      }
    })
    client.sessionCwd = profile.cwd
    this.clients.add(client)
    const originalRequest = client.request.bind(client),
      originalClose = client.close.bind(client),
      sessions = new Set<string>()
    let closing: Promise<void> | undefined
    client.request = async <T>(
      method: string,
      params: unknown,
      requestOptions: { signal?: AbortSignal; timeoutMs?: number } = {}
    ): Promise<T> => {
      const result = await originalRequest<T>(method, params, requestOptions)
      if (method === 'session/new' && typeof object(result).sessionId === 'string')
        sessions.add(object(result).sessionId as string)
      if (method === 'session/load' && typeof object(params).sessionId === 'string')
        sessions.add(object(params).sessionId as string)
      if (method === 'session/close' && typeof object(params).sessionId === 'string')
        sessions.delete(object(params).sessionId as string)
      return result
    }
    client.close = () =>
      (closing ??= (async () => {
        const results = await Promise.allSettled(
          [...sessions].map((sessionId) =>
            originalRequest('session/close', { sessionId }, { timeoutMs: 5000 })
          )
        )
        let closeFailure: unknown
        try {
          await originalClose()
        } catch (error) {
          closeFailure = error
        }
        this.clients.delete(client)
        const failure = results.find(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        )
        if (failure)
          throw new AcpError(
            'session_stop_failed',
            'Chưa xác nhận mọi phiên Antigravity đã đóng. Thử ngắt kết nối lại.'
          )
        if (closeFailure) throw closeFailure
      })())
    const aborted = () => {
      void client.close().catch(() => {})
    }
    options.signal?.addEventListener('abort', aborted, { once: true })
    try {
      const result = await originalRequest<AcpInitializeResult>(
        'initialize',
        {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'NexGraph', version: '0.1.0' }
        },
        { timeoutMs: 45000, signal: options.signal }
      )
      if (options.signal?.aborted || generation !== this.generation)
        throw new AcpError('cancelled', 'Đã hủy kết nối Google')
      if (
        result.protocolVersion !== 1 ||
        result.agentInfo?.name !== 'Antigravity ACP Server' ||
        result.agentInfo.version !== ANTIGRAVITY_CLI_VERSION ||
        !result.agentCapabilities?.mcpCapabilities?.http
      )
        throw new AcpError(
          'unsupported_cli',
          'Antigravity không đúng phiên bản hoặc thiếu giao thức MCP HTTP được hỗ trợ'
        )
      client.initializeResult = result
      this.capabilities = {
        loadSession: !!result.agentCapabilities?.loadSession,
        models: false,
        modes: false
      }
      if (this.metadata.authenticated && !options.skipAuthentication)
        await originalRequest(
          'authenticate',
          { methodId: 'oauth-personal' },
          { timeoutMs: 45000, signal: options.signal }
        )
      return client
    } catch (error) {
      await client.close()
      throw error
    } finally {
      options.signal?.removeEventListener('abort', aborted)
    }
  }
  private modelOption(response: unknown): ConfigOption | undefined {
    const value = object(response)
    const configs = Array.isArray(value.configOptions) ? value.configOptions : []
    return configs
      .map(object)
      .find(
        (option) => (option.category === 'model' || option.id === 'model') && option.type === 'select'
      ) as ConfigOption | undefined
  }
  rememberSession(response: unknown): void {
    const model = this.modelOption(response)
    if (model && Array.isArray(model.options))
      this.available = choiceOptions(model.options)
        .slice(0, 200)
        .map((option) => ({
          runtime: 'antigravity-cli',
          provider: 'google-antigravity',
          id: option.value,
          label: safeGeminiMessage(option.name).slice(0, 200),
          supportsTools: true,
          pricing: 'subscription',
          cost: { input: null, output: null }
        }))
    if (this.available.length) {
      this.error = undefined
      if (this.state === 'error') this.state = undefined
    }
    if (
      !this.metadata.modelSelected &&
      model &&
      validId(model.currentValue) &&
      this.available.some((entry) => entry.id === model.currentValue) &&
      this.metadata.model !== model.currentValue
    ) {
      this.metadata.model = model.currentValue
      void this.persist().catch(() => {})
    }
    this.capabilities = {
      loadSession: !!this.capabilities?.loadSession,
      models: this.available.length > 0,
      modes:
        Array.isArray(object(response).configOptions) &&
        (object(response).configOptions as unknown[]).some((item) => object(item).id === 'mode')
    }
    void this.publish().catch(() => {})
  }
  async configureSession(
    client: Pick<AcpClient, 'request'>,
    sessionId: string,
    response: unknown
  ): Promise<void> {
    this.rememberSession(response)
    const model = this.modelOption(response)
    if (!model || !this.available.length)
      throw new AcpError(
        'model_unavailable',
        'Antigravity chưa cung cấp danh sách model. Kiểm tra tài khoản và thử lại.'
      )
    if (!this.available.some((entry) => entry.id === this.metadata.model))
      throw new AcpError(
        'model_unavailable',
        'Model đã chọn không khả dụng trong phiên Google hiện tại. Hãy chọn lại model.'
      )
    if (model.currentValue !== this.metadata.model) {
      const result = await client.request(
        'session/set_config_option',
        { sessionId, configId: model.id, value: this.metadata.model },
        { timeoutMs: 30000 }
      )
      this.rememberSession(result)
    }
  }
  private copyModels(): ModelInfo[] {
    return this.available.map((model) => ({ ...model, ...(model.cost ? { cost: { ...model.cost } } : {}) }))
  }
  async models(): Promise<ModelInfo[]> {
    if (!this.available.length && this.metadata.authenticated && !this.operation) {
      this.discovery ??= (async () => {
        let client: AcpClient | undefined
        const generation = this.generation
        try {
          client = await this.createClient(this.deps.dataDir)
          const response = await client.request(
            'session/new',
            { cwd: client.sessionCwd, mcpServers: [] },
            { timeoutMs: 45000 }
          )
          if (generation === this.generation) this.rememberSession(response)
        } catch (error) {
          if (generation === this.generation) {
            this.error = safeGeminiMessage(error instanceof Error ? error.message : error)
            this.state = 'error'
            await this.publish()
          }
        } finally {
          if (client) await client.close()
          this.discovery = undefined
        }
        return this.copyModels()
      })()
      return this.discovery
    }
    return this.copyModels()
  }
  async selectModel(id: string): Promise<void> {
    if (!validId(id) || !this.available.some((model) => model.id === id))
      throw new AcpError('model_unavailable', 'Chọn model do Antigravity cung cấp cho tài khoản đang kết nối')
    this.metadata.model = id
    this.metadata.modelSelected = true
    await this.persist()
    await this.publish()
  }
}
