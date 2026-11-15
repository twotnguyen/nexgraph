import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiSettings } from '@shared/graph-types'
import type { AuthEventView, AuthPromptView, ModelInfo, ProviderInfo } from '@shared/agent-types'
import { vi } from '../strings'

const errCode = (e: unknown): string | undefined => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : undefined)
const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

const EMPTY_CUSTOM = { id: '', label: '', baseUrl: '', model: '', apiKey: '' }

/** Màn Tài khoản AI: key theo nhà cung cấp → nhà cung cấp tuỳ chỉnh → OAuth gói đăng ký → chọn model → kiểm tra kết nối. */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [keyProvider, setKeyProvider] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [custom, setCustom] = useState(EMPTY_CUSTOM)
  const [loginEvent, setLoginEvent] = useState<AuthEventView | null>(null)
  const [loginPrompt, setLoginPrompt] = useState<AuthPromptView | null>(null)
  const [promptInput, setPromptInput] = useState('')
  const [loginProvider, setLoginProvider] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loginPending = useRef(false)

  const load = useCallback(async () => {
    try {
      const a = window.nexgraph.auth
      const [providers, models, settings] = await Promise.all([a.list(), a.models(), window.nexgraph.ai.getSettings()])
      setProviders(providers)
      setModels(models)
      setSettings(settings)
      setKeyProvider((prev) => prev || providers.find((p) => !p.custom && p.hasKey)?.id || providers.find((p) => !p.custom)?.id || '')
    } catch (e) {
      setError(errMessage(e))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const offEvent = window.nexgraph.auth.onEvent((e) => setLoginEvent(e.type === 'progress' ? null : e))
    const offPrompt = window.nexgraph.auth.onPrompt((p) => {
      setLoginPrompt(p)
      setPromptInput('')
    })
    return () => {
      offEvent()
      offPrompt()
      if (loginPending.current) void window.nexgraph.auth.loginCancel()
    }
  }, [])

  const run = async (fn: () => Promise<void>, okMessage?: string) => {
    setStatus(null)
    setError(null)
    try {
      await fn()
      if (okMessage) setStatus(okMessage)
      await load()
    } catch (e) {
      setError(errCode(e) === 'no_keychain' ? vi.accounts.noKeychain : errMessage(e))
    }
  }

  const saveKey = () => void run(async () => {
    await window.nexgraph.auth.setKey(keyProvider, keyInput)
    setKeyInput('')
    setKeyVisible(false)
  }, vi.accounts.saved)

  const removeKey = () => void run(async () => {
    await window.nexgraph.auth.removeKey(keyProvider)
    setKeyInput('')
  }, vi.accounts.saved)

  const saveCustom = () => void run(async () => {
    const { id, label, baseUrl, model, apiKey } = custom
    await window.nexgraph.auth.saveCustom({ id, label, baseUrl, model }, apiKey === '' ? undefined : apiKey)
    await window.nexgraph.auth.selectModel(id, model)
    setCustom(EMPTY_CUSTOM)
  }, vi.accounts.saved)

  const removeCustom = (id: string) => void run(async () => {
    await window.nexgraph.auth.removeCustom(id)
  }, vi.accounts.saved)

  const login = (providerId: string) => void run(async () => {
    setLoginProvider(providerId)
    setLoginEvent(null)
    loginPending.current = true
    try {
      await window.nexgraph.auth.login(providerId)
    } finally {
      loginPending.current = false
      setLoginProvider(null)
      setLoginPrompt(null)
    }
  })

  const loginCancel = () => void run(async () => {
    await window.nexgraph.auth.loginCancel()
  })

  const answerPrompt = (value: string | null) => {
    setLoginPrompt(null)
    void window.nexgraph.auth.promptReply(loginPrompt?.id ?? '', value)
  }

  const test = async () => {
    setTestResult(null)
    const r = await window.nexgraph.auth.test()
    setTestResult(r.ok ? vi.accounts.testOk : vi.accounts.testFail(r.message))
  }

  const selected = settings?.model ?? ''
  const keyTarget = providers.find((p) => p.id === keyProvider)
  const customs = providers.filter((p) => p.custom)
  const oauthProviders = providers.filter((p) => p.oauth && !p.custom)

  return (
    <main className="screen settings">
      <button type="button" className="link" onClick={onBack}>{vi.settings.back}</button>
      <h1>{vi.accounts.title}</h1>

      <h2>{vi.accounts.apiKeyTitle}</h2>
      <p className="muted">{vi.accounts.apiKeyLead}</p>
      <label className="field">{vi.accounts.provider}
        <select value={keyProvider} onChange={(e) => setKeyProvider(e.target.value)}>
          {providers.filter((p) => !p.custom).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      {keyTarget?.hasKey && <p className="muted">{vi.accounts.keySaved}</p>}
      <div className="field">
        <label htmlFor="account-key">{vi.accounts.apiKey}</label>
        <input id="account-key" type={keyVisible ? 'text' : 'password'} autoComplete="off"
          value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder={keyTarget?.hasKey ? vi.accounts.keyPlaceholder : ''} />
        <div className="row">
          <button type="button" className="primary" onClick={saveKey} disabled={!keyInput.trim()}>{vi.accounts.saveKey}</button>
          {keyTarget?.hasKey && <button type="button" onClick={removeKey}>{vi.accounts.removeKey}</button>}
        </div>
      </div>

      <h2>{vi.accounts.customTitle}</h2>
      <p className="muted">{vi.accounts.customLead}</p>
      {customs.length > 0 && (
        <ul className="muted">
          {customs.map((c) => (
            <li key={c.id}>
              {c.label} · {c.id}
              <button type="button" className="link" onClick={() => removeCustom(c.id)}>{vi.accounts.removeCustom}</button>
            </li>
          ))}
        </ul>
      )}
      <div className="field">
        <label htmlFor="custom-id">{vi.accounts.customId}</label>
        <input id="custom-id" value={custom.id} onChange={(e) => setCustom({ ...custom, id: e.target.value })} placeholder="custom-1" />
        <label htmlFor="custom-label">{vi.accounts.customLabel}</label>
        <input id="custom-label" value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} />
        <label htmlFor="custom-url">{vi.accounts.baseUrl}</label>
        <input id="custom-url" value={custom.baseUrl} onChange={(e) => setCustom({ ...custom, baseUrl: e.target.value })} placeholder="https://openrouter.ai/api/v1" />
        <label htmlFor="custom-model">{vi.accounts.customModel}</label>
        <input id="custom-model" value={custom.model} onChange={(e) => setCustom({ ...custom, model: e.target.value })} />
        <label htmlFor="custom-key">{vi.accounts.customApiKey}</label>
        <input id="custom-key" type="password" autoComplete="off" value={custom.apiKey} onChange={(e) => setCustom({ ...custom, apiKey: e.target.value })} />
        <div className="row">
          <button type="button" className="primary" onClick={saveCustom}
            disabled={!custom.id.trim() || !custom.label.trim() || !custom.baseUrl.trim() || !custom.model.trim()}>{vi.accounts.saveCustom}</button>
        </div>
      </div>

      <h2>{vi.accounts.oauthTitle}</h2>
      <p className="muted">{vi.accounts.oauthWarning}</p>
      {loginEvent && <p className="muted">{'userCode' in loginEvent ? `${vi.accounts.oauthUserCode}: ${loginEvent.userCode}` : 'url' in loginEvent ? loginEvent.instructions ?? loginEvent.url : loginEvent.message}</p>}
      {loginProvider && <div className="row"><button type="button" onClick={loginCancel}>{vi.accounts.oauthCancel}</button></div>}
      {loginPrompt && (
        <div className="field">
          <label htmlFor="oauth-answer">{loginPrompt.message}</label>
          {loginPrompt.options && loginPrompt.options.length > 0 ? (
            <div className="row">
              {loginPrompt.options.map((o) => (
                <button type="button" className="primary" key={o.id} onClick={() => answerPrompt(o.id)}>{o.label}</button>
              ))}
            </div>
          ) : (
            <>
              <input id="oauth-answer" type={loginPrompt.kind === 'text' ? 'text' : 'password'} autoComplete="off"
                placeholder={loginPrompt.placeholder} value={promptInput} onChange={(e) => setPromptInput(e.target.value)} />
              <div className="row">
                <button type="button" className="primary" onClick={() => answerPrompt(promptInput)}>{vi.accounts.oauthSend}</button>
                <button type="button" onClick={() => answerPrompt(null)}>{vi.accounts.oauthPromptCancel}</button>
              </div>
            </>
          )}
        </div>
      )}
      {oauthProviders.map((p) => (
        <div className="row" key={p.id}>
          <span>{p.label}</span>
          {p.loggedIn
            ? <button type="button" onClick={() => void run(async () => { await window.nexgraph.auth.logout(p.id) }, vi.accounts.saved)}>{vi.accounts.oauthLogout}</button>
            : <button type="button" onClick={() => login(p.id)}>{vi.accounts.oauthLogin}</button>}
        </div>
      ))}

      <h2>{vi.accounts.modelTitle}</h2>
      <label className="field">{vi.accounts.modelTitle}
        <select value={settings?.provider && selected ? `${settings.provider}/${selected}` : ''} onChange={(e) => {
          const m = models.find((x) => `${x.provider}/${x.id}` === e.target.value)
          if (m) void run(() => window.nexgraph.auth.selectModel(m.provider, m.id))
        }}>
          <option value="">{vi.accounts.modelPlaceholder}</option>
          {models.map((m) => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.label} ({m.provider})</option>)}
        </select>
      </label>

      <div className="row">
        <button type="button" onClick={() => void test()}>{vi.accounts.test}</button>
        {status && <span role="status">{status}</span>}
        {testResult && <span role="status">{testResult}</span>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}

      <h2>{vi.settings.privacyTitle}</h2>
      <p>{vi.settings.privacy1}</p>
      <p>{vi.settings.privacy2}</p>
    </main>
  )
}
