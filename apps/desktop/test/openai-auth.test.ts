import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createOpenAiOAuth, revokeOpenAiSession, type OpenAiRegistration } from '../src/main/agent/openai-auth'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' }
const device = '12345678-1234-4123-8123-123456789012'
const original: Parameters<typeof createOpenAiOAuth>[0] = {
  name: 'OpenAI', isSubscription: true,
  login: async () => { throw new Error('unused') },
  refresh: async (credential) => credential,
  toAuth: async (credential) => ({ apiKey: credential.access })
}
type Credential = Awaited<ReturnType<typeof original.login>>

function harness(options: { rejectFirst?: boolean; wrongNonce?: boolean; wrongSignature?: boolean; issuer?: string; audience?: string; sub?: string; scope?: string; stored?: OpenAiRegistration; deny?: boolean } = {}) {
  const authorizations: URLSearchParams[] = []
  const grants: URLSearchParams[] = []
  const callbacks: Promise<{ status: number; body: string }>[] = []
  const saveRegistration = vi.fn()
  const controller = new AbortController()
  const request = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input).endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] })
    const grant = new URLSearchParams(init?.body as URLSearchParams)
    grants.push(grant)
    const authorization = authorizations.at(-1)!
    expect(createHash('sha256').update(grant.get('code_verifier')!).digest('base64url')).toBe(authorization.get('code_challenge'))
    expect(grant.get('redirect_uri')).toBe(authorization.get('redirect_uri'))
    expect(grant.get('resource')).toBe('https://api.openai.com/v1')
    if (options.rejectFirst && grants.length === 1) return Response.json({ error: 'invalid_grant' }, { status: 400 })
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({
      iss: options.issuer ?? 'https://auth.openai.com', aud: options.audience ?? 'oaiapp_test_registration', sub: options.sub ?? 'test-account',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: options.wrongNonce ? 'wrong-nonce' : authorization.get('nonce')
    })).toString('base64url')
    const unsigned = `${header}.${payload}`
    const idToken = `${unsigned}.${options.wrongSignature ? Buffer.alloc(256).toString('base64url') : sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`
    return Response.json({
      access_token: 'test-access-token', refresh_token: 'test-refresh-token', id_token: idToken, expires_in: 3600,
      scope: options.scope ?? 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
    })
  })
  const oauth = createOpenAiOAuth(original, {
    fetch: request, timeoutMs: 10000, readStored: async () => options.stored, saveRegistration
  })
  const run = () => oauth.login({
    signal: controller.signal,
    prompt: async () => { throw new Error('No manual code needed for loopback') },
    notify: (event) => {
      if (event.type !== 'auth_url') return
      const authorization = new URL(event.url).searchParams
      authorizations.push(authorization)
      const callback = new URL(authorization.get('redirect_uri')!)
      callback.searchParams.set('state', authorization.get('state')!)
      if (options.deny) callback.searchParams.set('error', 'access_denied')
      else {
        callback.searchParams.set('code', `test-code-${authorizations.length}`)
        if (authorization.get('client_id') === 'dynamic_agent_client')
          callback.searchParams.set('client_id', 'oaiapp_test_registration')
      }
      callbacks.push(fetch(callback).then(async (response) => ({ status: response.status, body: await response.text() })))
    }
  }, { agentName: 'NexGraph', getDeviceId: () => device })
  return { run, authorizations, grants, callbacks, controller, saveRegistration }
}

describe('OpenAI SIWC recovery', () => {
  it('invalid_grant uses a new code/PKCE/state with issued client ID and verifies the ID token', async () => {
    const test = harness({ rejectFirst: true })
    const credential = await test.run()
    await Promise.all(test.callbacks)
    expect(credential).toMatchObject({ type: 'oauth', clientId: 'oaiapp_test_registration', sub: 'test-account' })
    expect(test.authorizations).toHaveLength(2)
    expect(test.authorizations[0].get('client_id')).toBe('dynamic_agent_client')
    expect(test.authorizations[0].get('agent_name_hint')).toBe('NexGraph')
    expect(test.authorizations[1].get('client_id')).toBe('oaiapp_test_registration')
    expect(test.authorizations[1].has('agent_name_hint')).toBe(false)
    expect(test.authorizations[1].get('state')).not.toBe(test.authorizations[0].get('state'))
    expect(test.grants[1].get('code')).not.toBe(test.grants[0].get('code'))
    expect(test.authorizations[1].get('ext_agent_host_id')).toBe(`urn:uuid:${device}`)
    expect(test.saveRegistration).toHaveBeenCalledExactlyOnceWith({ clientId: 'oaiapp_test_registration', sub: 'test-account' })
  })

  it('returning account keeps issued registration even when callback omits client_id', async () => {
    const test = harness({ stored: { clientId: 'oaiapp_test_registration', sub: 'test-account', idToken: 'test-prior-id-token' } })
    await test.run()
    await Promise.all(test.callbacks)
    expect(test.authorizations).toHaveLength(1)
    expect(test.authorizations[0].get('client_id')).toBe('oaiapp_test_registration')
    expect(test.authorizations[0].has('agent_name_hint')).toBe(false)
    expect(test.authorizations[0].get('id_token_hint')).toBe('test-prior-id-token')
  })

  it.each([
    { wrongSignature: true }, { issuer: 'https://wrong.example' }, { audience: 'wrong-client' },
    { sub: 'different-account', stored: { clientId: 'oaiapp_test_registration', sub: 'test-account' } },
    { scope: 'openid profile email' }
  ])('unverified identity or missing inference permission never persists registration (%j)', async (options) => {
    const test = harness(options)
    await expect(test.run()).rejects.toThrow()
    await Promise.all(test.callbacks)
    expect(test.saveRegistration).not.toHaveBeenCalled()
  })

  it('refresh keeps verified account metadata when the provider rotates access tokens', async () => {
    const oauth = createOpenAiOAuth({ ...original, refresh: async () => ({ type: 'oauth', access: 'new-access', refresh: 'new-refresh', expires: 2000 }) })
    const credential: Credential = { type: 'oauth', access: 'old-access', refresh: 'old-refresh', expires: 1,
      clientId: 'oaiapp_test_registration', sub: 'test-account', idToken: 'test-id-token', scopes: ['chatgpt.tokens.use.direct'] }
    await expect(oauth.refresh(credential, new AbortController().signal)).resolves.toMatchObject({ ...credential, access: 'new-access', refresh: 'new-refresh', expires: 2000 })
  })

  it('valid signature with a wrong nonce is rejected before credentials are accepted', async () => {
    const test = harness({ wrongNonce: true })
    await expect(test.run()).rejects.toThrow('không khớp')
    await Promise.all(test.callbacks)
  })

  it('cancel closes the callback listener and settles the login', async () => {
    const controller = new AbortController()
    const oauth = createOpenAiOAuth(original, { timeoutMs: 10000 })
    await expect(oauth.login({
      signal: controller.signal, prompt: vi.fn(),
      notify: (event) => { if (event.type === 'auth_url') controller.abort() }
    }, { agentName: 'NexGraph', getDeviceId: () => device })).rejects.toThrow('hủy')
  })
})

describe('OpenAI login failure paths', () => {
  it('denied authorization rejects the login and tells the browser it was cancelled, not invalid', async () => {
    const test = harness({ deny: true })
    await expect(test.run()).rejects.toThrow('chưa được chấp thuận')
    const [response] = await Promise.all(test.callbacks)
    expect(response.status).toBe(200)
    expect(response.body).toContain('huỷ')
  })

  it('timeout settles the login with a timeout message and closes the loopback port', async () => {
    const redirects: string[] = []
    const oauth = createOpenAiOAuth(original, { timeoutMs: 40 })
    await expect(oauth.login({
      signal: new AbortController().signal, prompt: vi.fn(),
      notify: (event: { type: string; url?: string }) => {
        if (event.type === 'auth_url' && event.url) redirects.push(new URL(event.url).searchParams.get('redirect_uri')!)
      }
    }, { agentName: 'NexGraph', getDeviceId: () => device })).rejects.toThrow('quá thời gian chờ')
    expect(redirects).toHaveLength(1)
    await expect(fetch(`${redirects[0]}?code=x&state=y`)).rejects.toThrow()
  })
})

describe('OpenAI session revocation', () => {
  it('uses discovery and a POST body, accepts an empty HTTP 200', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ revocation_endpoint: 'https://auth.openai.com/oauth/revoke' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    await expect(revokeOpenAiSession('test-refresh', 'test-client', request)).resolves.toBe(true)
    expect(request).toHaveBeenNthCalledWith(2, 'https://auth.openai.com/oauth/revoke', expect.objectContaining({
      method: 'POST', redirect: 'error', body: new URLSearchParams({ token: 'test-refresh', token_type_hint: 'refresh_token', client_id: 'test-client' })
    }))
    expect(request.mock.calls.every(([url]) => !String(url).includes('test-refresh'))).toBe(true)
  })

  it('retries a server failure once and rejects an untrusted discovery endpoint', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ revocation_endpoint: 'https://auth.openai.com/oauth/revoke' }))
      .mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 200 }))
    await expect(revokeOpenAiSession('test-refresh', 'test-client', request)).resolves.toBe(true)
    expect(request).toHaveBeenCalledTimes(3)
    const unsafe = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ revocation_endpoint: 'https://untrusted.example/revoke' }))
    await expect(revokeOpenAiSession('test-refresh', 'test-client', unsafe)).resolves.toBe(false)
    expect(unsafe).toHaveBeenCalledOnce()
  })
})
