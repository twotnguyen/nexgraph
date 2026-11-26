/** Sự kiện SSE của Nex; `type` là tên sự kiện, `data` là payload (đã bóc envelope). */
export type NexEvent = { type: string; data?: Record<string, unknown> }

/** Integration (nhà cung cấp đăng nhập) do sidecar Nex trả về. Chỉ giữ trường giao diện cần. */
export type NexIntegrationMethod = {
  id?: string
  type: 'key' | 'env' | 'oauth' | 'command' | 'external'
  label?: string
  names?: string[]
  command?: string[]
  form?: { key: string; title?: string; type?: string; required?: boolean; hidden?: boolean; options?: { value: string; label: string }[]; when?: { key: string; op: string; value: string }[] }[]
}
export type NexIntegrationConnection = {
  type: 'credential' | 'env'
  id?: string
  label?: string
  name?: string
  method?: 'key' | 'oauth' | 'external'
  status?: { status: 'needs_auth'; message: string; url?: string }
}
export type NexIntegration = {
  id: string
  name: string
  methods: NexIntegrationMethod[]
  connections: NexIntegrationConnection[]
}

/** Model của sidecar; chỉ id/nhãn — KHÔNG giữ `settings` vì phản hồi đó có thể chứa API key đã resolve. */
export type NexModelEntry = { providerID: string; id: string; name?: string }

/** Lần đăng nhập OAuth/device do sidecar bắt đầu. */
export type NexOAuthAttempt = {
  attemptID: string
  url: string
  instructions?: string
  mode?: 'auto' | 'code'
  paste?: boolean
}

export type NexAttemptState = {
  status: 'pending' | 'complete' | 'failed' | 'expired'
  message?: string
}


export type NexClientOptions = {
  /** Chuỗi hoặc getter: sidecar khởi động lại thì URL/mật khẩu đổi, client phải đọc lại mỗi request. */
  baseUrl: string | (() => string)
  secret: string | (() => string)
  fetchImpl?: typeof fetch
  /** Thời gian chờ trước khi nối lại SSE sau lỗi mạng. */
  reconnectDelayMs?: number
}

export class NexHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'NexHttpError'
  }
}

const basic = (password: string): string => `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`

/**
 * Client HTTP + SSE tới tiến trình Nex (OpenCode). Không log body request/response:
 * một số endpoint của OpenCode trả nguyên văn API key provider (spike A2 §7).
 */
export class NexClient {
  private readonly fetchImpl: typeof fetch
  private readonly reconnectDelayMs: number
  private stopped = false

  constructor(private readonly o: NexClientOptions) {
    this.fetchImpl = o.fetchImpl ?? fetch
    this.reconnectDelayMs = o.reconnectDelayMs ?? 1_000
  }

  private get baseUrl(): string { return typeof this.o.baseUrl === 'function' ? this.o.baseUrl() : this.o.baseUrl }
  private get password(): string { return typeof this.o.secret === 'function' ? this.o.secret() : this.o.secret }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: basic(this.password), 'Content-Type': 'application/json', ...(init.headers ?? {}) }
    })
    if (!response.ok) throw new NexHttpError(response.status, `Nex trả lỗi HTTP ${response.status} cho ${path.split('?')[0]}`)
    if (response.status === 204) return undefined as T
    const body = (await response.json()) as { data?: T } | T
    return body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)
      ? (body as { data: T }).data
      : (body as T)
  }

  async info(): Promise<Record<string, unknown>> {
    return this.request('/api/info')
  }

  async createSession(input: { title?: string; model: { providerID: string; id: string } }): Promise<{ id: string }> {
    return this.request('/api/session', { method: 'POST', body: JSON.stringify(input) })
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionId)}/prompt`, { method: 'POST', body: JSON.stringify({ text }) })
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionId)}/interrupt`, { method: 'POST' })
  }

  async setModel(sessionId: string, model: { providerID: string; id: string }): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionId)}/model`, { method: 'POST', body: JSON.stringify({ model }) })
  }

  async replyPermission(sessionId: string, requestId: string, decision: 'once' | 'reject'): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`, {
      method: 'POST', body: JSON.stringify({ decision })
    })
  }

  async messages(sessionId: string): Promise<unknown[]> {
    return this.request(`/api/session/${encodeURIComponent(sessionId)}/message`)
  }

  /** Danh sách integration + phương thức đăng nhập + kết nối hiện có. */
  async integrations(): Promise<NexIntegration[]> {
    const raw = await this.request<unknown>('/api/integration')
    return Array.isArray(raw) ? (raw as NexIntegration[]) : []
  }

  /**
   * Model của sidecar. Phản hồi thật chứa `settings.apiKey` (đã resolve từ `{env:…}`), nên chỉ
   * giữ `providerID`/`id`/`name`; không trả nguyên phản hồi ra ngoài và không log.
   */
  async models(): Promise<NexModelEntry[]> {
    const raw = await this.request<unknown>('/api/model')
    if (!Array.isArray(raw)) return []
    return raw.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const value = item as Record<string, unknown>
      if (typeof value.providerID !== 'string' || typeof value.id !== 'string') return []
      return [{ providerID: value.providerID, id: value.id, ...(typeof value.name === 'string' ? { name: value.name } : {}) }]
    })
  }

  async connectOAuth(integrationId: string, methodID: string, answer?: Record<string, unknown>): Promise<NexOAuthAttempt> {
    return this.request(`/api/integration/${encodeURIComponent(integrationId)}/connect/oauth`, {
      method: 'POST', body: JSON.stringify({ methodID, ...(answer ? { answer } : {}) })
    })
  }

  async oauthStatus(integrationId: string, attemptID: string): Promise<NexAttemptState> {
    return this.request(`/api/integration/${encodeURIComponent(integrationId)}/connect/oauth/${encodeURIComponent(attemptID)}`)
  }

  async completeOAuth(integrationId: string, attemptID: string, code?: string): Promise<void> {
    await this.request(`/api/integration/${encodeURIComponent(integrationId)}/connect/oauth/${encodeURIComponent(attemptID)}/complete`, {
      method: 'POST', body: JSON.stringify(code === undefined ? {} : { code })
    })
  }

  async cancelOAuth(integrationId: string, attemptID: string): Promise<void> {
    await this.request(`/api/integration/${encodeURIComponent(integrationId)}/connect/oauth/${encodeURIComponent(attemptID)}`, { method: 'DELETE' })
  }

  async connectCommand(integrationId: string, methodID: string): Promise<{ attemptID: string }> {
    return this.request(`/api/integration/${encodeURIComponent(integrationId)}/connect/command`, {
      method: 'POST', body: JSON.stringify({ methodID })
    })
  }

  async commandStatus(integrationId: string, attemptID: string): Promise<NexAttemptState> {
    return this.request(`/api/integration/${encodeURIComponent(integrationId)}/connect/command/${encodeURIComponent(attemptID)}`)
  }

  async cancelCommand(integrationId: string, attemptID: string): Promise<void> {
    await this.request(`/api/integration/${encodeURIComponent(integrationId)}/connect/command/${encodeURIComponent(attemptID)}`, { method: 'DELETE' })
  }

  async connectExternal(integrationId: string, methodID: string): Promise<void> {
    await this.request(`/api/integration/${encodeURIComponent(integrationId)}/connect/external`, {
      method: 'POST', body: JSON.stringify({ methodID })
    })
  }

  /** Xoá một credential (đăng xuất). Không dùng `GET /api/provider` ở bất kỳ đâu (trả key nguyên văn). */
  async removeCredential(credentialID: string): Promise<void> {
    await this.request(`/api/credential/${encodeURIComponent(credentialID)}`, { method: 'DELETE' })
  }

  /**
   * Đọc SSE tới khi hàm huỷ được gọi. OpenCode phát frame `data: {...}` và `: heartbeat`
   * (không có dòng `event:`), nhưng vẫn chấp nhận dòng `event:` nếu có.
   */
  subscribe(listener: (event: NexEvent) => void): () => void {
    this.stopped = false
    const controller = new AbortController()
    void this.pump(listener, controller.signal)
    return () => {
      this.stopped = true
      controller.abort()
    }
  }

  private async pump(listener: (event: NexEvent) => void, signal: AbortSignal): Promise<void> {
    while (!this.stopped && !signal.aborted) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/api/event`, {
          headers: { Authorization: basic(this.password), Accept: 'text/event-stream' }, signal
        })
        if (!response.ok || !response.body) throw new NexHttpError(response.status, 'Không mở được luồng sự kiện Nex')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let data: string[] = []
        while (!this.stopped && !signal.aborted) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffer += decoder.decode(chunk.value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const raw of lines) {
            const line = raw.replace(/\r$/, '')
            if (line.startsWith('data:')) {
              data.push(line.slice(5).trimStart())
              continue
            }
            if (line.trim() === '' && data.length > 0) {
              const frame = data.join('\n')
              data = []
              try {
                const value = JSON.parse(frame) as NexEvent
                if (value && typeof value.type === 'string') listener(value)
              } catch { /* frame hỏng: bỏ qua, không làm rơi luồng */ }
            }
          }
        }
        reader.cancel().catch(() => {})
      } catch {
        if (this.stopped || signal.aborted) return
      }
      if (this.stopped || signal.aborted) return
      await new Promise((resolve) => setTimeout(resolve, this.reconnectDelayMs))
    }
  }
}
