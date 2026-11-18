import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'

type Provider = NonNullable<ReturnType<ModelRuntime['getProvider']>>
type OAuth = NonNullable<Provider['auth']['oauth']>
type Interaction = Parameters<OAuth['login']>[0]
type Credential = Awaited<ReturnType<OAuth['login']>>
export type OpenAiRegistration = { clientId: string; sub?: string; idToken?: string }
type Authorization = { code: string; clientId: string }
const AUTHORIZATION = 'https://auth.openai.com/api/accounts/authorize'
const TOKEN = 'https://auth.openai.com/api/accounts/oauth/token'
const JWKS = 'https://auth.openai.com/.well-known/jwks.json'
const RESOURCE = 'https://api.openai.com/v1'
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPES = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`
const DYNAMIC_CLIENT = 'dynamic_agent_client'
const random = () => randomBytes(32).toString('base64url')
const cancelled = () => new Error('Đã hủy đăng nhập ChatGPT')

class TokenError extends Error {
  constructor(readonly error: string, status: number) {
    super(`ChatGPT từ chối xác nhận đăng nhập (HTTP ${status}, ${error}). Hãy đăng nhập lại.`)
  }
}

/** OAuth recovery uses a fresh code with the issued registration. Authorization codes are never replayed. */
export function createOpenAiOAuth(original: OAuth, deps: {
  fetch?: typeof fetch
  timeoutMs?: number
  readStored?: () => Promise<OpenAiRegistration | undefined>
  saveRegistration?: (registration: OpenAiRegistration) => Promise<void> | void
} = {}): OAuth {
  const request = deps.fetch ?? globalThis.fetch

  const tokenRequest = async (body: URLSearchParams, signal: AbortSignal): Promise<Record<string, unknown>> => {
    const response = await request(TOKEN, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body
    })
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Phản hồi đăng nhập ChatGPT không hợp lệ')
    const value = data as Record<string, unknown>
    if (!response.ok) {
      const code = typeof value.error === 'string' && /^[a-z0-9_]{1,80}$/i.test(value.error) ? value.error : 'oauth_error'
      throw new TokenError(code, response.status)
    }
    return value
  }

  const identity = async (idToken: string, clientId: string, nonce: string, signal: AbortSignal): Promise<{ sub: string }> => {
    const segments = idToken.split('.')
    if (segments.length !== 3) throw new Error('ID token ChatGPT không hợp lệ')
    let header: { alg?: string; kid?: string }
    let payload: Record<string, unknown>
    try {
      header = JSON.parse(Buffer.from(segments[0], 'base64url').toString())
      payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString())
    } catch { throw new Error('ID token ChatGPT không hợp lệ') }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Không xác minh được chữ ký tài khoản ChatGPT')
    const response = await request(JWKS, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) })
    if (!response.ok) throw new Error('Không tải được khóa xác minh tài khoản ChatGPT')
    const keys = await response.json() as { keys?: (JsonWebKey & { kid?: string; alg?: string })[] }
    const jwk = keys.keys?.find((key) => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256'))
    if (!jwk || !verify('RSA-SHA256', Buffer.from(`${segments[0]}.${segments[1]}`),
      createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(segments[2], 'base64url')))
      throw new Error('Chữ ký tài khoản ChatGPT không hợp lệ')
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (payload.iss !== 'https://auth.openai.com' || !audience.includes(clientId) ||
        typeof payload.exp !== 'number' || payload.exp <= Date.now() / 1000 || payload.nonce !== nonce ||
        typeof payload.sub !== 'string' || !payload.sub)
      throw new Error('Thông tin xác minh tài khoản ChatGPT không khớp lần đăng nhập')
    return { sub: payload.sub }
  }

  const login: OAuth['login'] = async (interaction, options) => {
    const device = options?.getDeviceId?.()
    if (!device || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(device))
      throw new Error('Chưa có UUID cài đặt để đăng nhập ChatGPT')
    const previous = await deps.readStored?.()
    let issued = typeof previous?.clientId === 'string' && previous.clientId !== DYNAMIC_CLIENT ? previous.clientId : undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      interaction.signal.throwIfAborted()
      const verifier = random()
      const challenge = createHash('sha256').update(verifier).digest('base64url')
      const state = random()
      const nonce = random()
      const callback = await authorizationCallback(state, issued, interaction, deps.timeoutMs ?? 10 * 60_000)
      try {
        const url = new URL(AUTHORIZATION)
        url.search = new URLSearchParams({
          client_id: issued ?? DYNAMIC_CLIENT,
          ...(issued ? {} : { agent_name_hint: options?.agentName ?? 'NexGraph' }),
          ...(issued && typeof previous?.idToken === 'string' ? { id_token_hint: previous.idToken } : {}),
          ext_agent_host_id: `urn:uuid:${device.toLowerCase()}`,
          response_type: 'code', redirect_uri: callback.redirect,
          resource: RESOURCE, scope: SCOPES, state, nonce,
          code_challenge: challenge, code_challenge_method: 'S256'
        }).toString()
        interaction.notify({ type: 'auth_url', url: url.href,
          instructions: attempt ? 'Hoàn tất lần xác nhận mới trong trình duyệt để kết nối NexGraph.' : 'Hoàn tất đăng nhập ChatGPT trong trình duyệt rồi quay lại NexGraph.' })
        const authorization = await callback.wait()
        issued = authorization.clientId
        interaction.notify({ type: 'progress', message: 'Đang xác minh kết nối với ChatGPT…' })
        const token = await tokenRequest(new URLSearchParams({
          grant_type: 'authorization_code', client_id: issued, code: authorization.code,
          code_verifier: verifier, redirect_uri: callback.redirect, resource: RESOURCE
        }), interaction.signal)
        if (typeof token.access_token !== 'string' || !token.access_token || typeof token.refresh_token !== 'string' ||
            !token.refresh_token || typeof token.id_token !== 'string' || !token.id_token ||
            typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 ||
            typeof token.scope !== 'string') throw new Error('ChatGPT chưa trả về đầy đủ thông tin kết nối')
        const scopes = token.scope.trim().split(/\s+/)
        if (!scopes.includes(DIRECT_SCOPE)) throw new Error('Tài khoản chưa cấp quyền sử dụng gói ChatGPT cho NexGraph')
        const verified = await identity(token.id_token, issued, nonce, interaction.signal)
        if (typeof previous?.sub === 'string' && previous.sub !== verified.sub)
          throw new Error('Tài khoản ChatGPT xác nhận khác tài khoản đã chọn. Hãy đăng xuất trước khi đổi tài khoản.')
        await deps.saveRegistration?.({ clientId: issued, sub: verified.sub })
        return {
          type: 'oauth', access: token.access_token, refresh: token.refresh_token,
          expires: Date.now() + token.expires_in * 1000,
          clientId: issued, scopes, sub: verified.sub, idToken: token.id_token
        }
      } catch (error) {
        if (!(error instanceof TokenError) || error.error !== 'invalid_grant' || !issued || attempt !== 0) throw error
        interaction.notify({ type: 'info', message: 'ChatGPT yêu cầu một lần xác nhận mới. NexGraph đang mở lại trình duyệt với đăng ký vừa cấp.' })
      } finally { await callback.close() }
    }
    throw new Error('Chưa hoàn tất đăng nhập ChatGPT. Hãy bắt đầu lại.')
  }
  return { ...original, login,
    refresh: async (credential, signal): Promise<Credential> => ({ ...credential, ...await original.refresh(credential, signal) })
  }
}

/** Revoke only at the provider's published HTTPS endpoint. Credentials never enter a URL. */
export async function revokeOpenAiSession(refresh: string, clientId: string, request: typeof fetch = globalThis.fetch): Promise<boolean> {
  let endpoint: string
  try {
    const discovery = await request('https://auth.openai.com/.well-known/openid-configuration', {
      redirect: 'error', signal: AbortSignal.timeout(8000)
    })
    if (!discovery.ok) return false
    const metadata = await discovery.json() as { revocation_endpoint?: unknown }
    if (typeof metadata.revocation_endpoint !== 'string') return false
    const url = new URL(metadata.revocation_endpoint)
    if (url.origin !== 'https://auth.openai.com' || url.username || url.password || url.search || url.hash) return false
    endpoint = url.href
  } catch { return false }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await request(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refresh, token_type_hint: 'refresh_token', client_id: clientId })
      })
      if (response.status === 200) return true
      if (response.status < 500) return false
    } catch { /* Retry one transient failure while the refresh token is still available. */ }
    if (attempt === 0) await new Promise((done) => setTimeout(done, 300))
  }
  return false
}

async function authorizationCallback(state: string, issued: string | undefined, interaction: Interaction, timeoutMs: number) {
  let resolve!: (value: Authorization) => void
  let reject!: (error: unknown) => void
  const authorization = new Promise<Authorization>((done, fail) => { resolve = done; reject = fail })
  // A rejection may arrive while the native browser is opening.
  void authorization.catch(() => {})
  let redirect = ''
  const parse = (url: URL): Authorization => {
    const expected = new URL(redirect)
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.searchParams.get('state') !== state)
      throw new Error('Xác nhận đăng nhập không khớp lần đang mở')
    if (url.searchParams.has('error')) throw new Error('Đăng nhập ChatGPT chưa được chấp thuận')
    const code = url.searchParams.get('code')
    const returned = url.searchParams.get('client_id')?.trim()
    const clientId = returned || issued
    if (!code || !clientId || clientId === DYNAMIC_CLIENT || issued && returned && issued !== returned)
      throw new Error('Đăng ký tài khoản ChatGPT không khớp xác nhận')
    return { code, clientId }
  }
  const server: Server = createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
    try {
      const url = new URL(req.url ?? '', redirect)
      const expected = new URL(redirect)
      if (url.origin === expected.origin && url.pathname === expected.pathname &&
          url.searchParams.get('state') === state && url.searchParams.has('error'))
        reject(new Error('Đăng nhập ChatGPT chưa được chấp thuận'))
      const result = parse(url)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><title>NexGraph</title><body><h1>Đã nhận xác nhận</h1><p>Quay lại NexGraph để xem kết quả kết nối.</p></body></html>')
      resolve(result)
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('Xác nhận không hợp lệ. Quay lại NexGraph và bắt đầu lại.')
    }
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); done() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('Không mở được callback ChatGPT') }
  redirect = `http://127.0.0.1:${address.port}/auth/callback`
  server.on('error', reject)
  const abort = () => reject(cancelled())
  const timer = setTimeout(() => reject(new Error('Đăng nhập ChatGPT quá thời gian chờ. Hãy bắt đầu lại.')), timeoutMs)
  interaction.signal.addEventListener('abort', abort, { once: true })
  if (interaction.signal.aborted) abort()
  return {
    redirect,
    wait: () => authorization,
    close: async () => {
      clearTimeout(timer)
      interaction.signal.removeEventListener('abort', abort)
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    }
  }
}
