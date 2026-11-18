import { useEffect, useRef, useState } from 'react'
import type { AuthEventView, AuthPromptView, LocalModelInfo, ModelInfo, ProviderInfo } from '@shared/agent-types'
import { sameConsentTarget } from '@shared/agent-types'
import type { AiSettings } from '@shared/graph-types'
import { Icon } from '../common/icons'
import { AuthLinks } from './AuthLinks'
import './connection-dialog.css'

type Method = 'oauth' | 'api_key' | 'local'
const messageOf = (error: unknown): string =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
const labelFor = (provider: ProviderInfo): string =>
  ({ openai: 'OpenAI / ChatGPT', 'openai-codex': 'Codex qua ChatGPT', google: 'Google AI Studio', openrouter: 'OpenRouter', anthropic: 'Anthropic / Claude' } as Record<string, string>)[provider.id] ?? provider.label

export function ConnectionDialog({ projectId, onConnected, onClose, initialMethod = 'oauth' }: {
  projectId?: string
  onConnected(): void
  onClose(): void
  initialMethod?: Method
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [method, setMethod] = useState<Method>(initialMethod)
  const [provider, setProvider] = useState(initialMethod === 'api_key' ? 'google' : 'openai')
  const [key, setKey] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [model, setModel] = useState('')
  const [localUrl, setLocalUrl] = useState('http://127.0.0.1:11434/v1')
  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([])
  const [event, setEvent] = useState<AuthEventView | null>(null)
  const [prompt, setPrompt] = useState<AuthPromptView | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testedSettings, setTestedSettings] = useState<AiSettings | null>(null)
  const [consent, setConsent] = useState(false)
  const [freeOnly, setFreeOnly] = useState(false)
  const loginPending = useRef(false)
  const operation = useRef(false)
  const alive = useRef(true)
  const selectedProvider = providers.find((p) => p.id === provider)
  const relevantModels = models.filter((m) => m.provider === (method === 'local' ? 'ollama-local' : provider) &&
    (!freeOnly || m.pricing === 'free' || m.id.endsWith(':free') || m.id === 'openrouter/free'))
  const selectedModel = relevantModels.find((m) => m.id === model)

  useEffect(() => {
    alive.current = true
    void window.nexgraph.auth.list().then((items) => {
      if (!alive.current) return
      setProviders(items)
      const available = items.filter((p) => initialMethod === 'oauth' ? p.oauth && p.id !== 'anthropic' : p.authMethods?.includes('api_key') ?? true)
      setProvider((current) => available.some((p) => p.id === current) ? current : available[0]?.id ?? '')
    }).catch((e) => { if (alive.current) setError(messageOf(e)) })
    const offEvent = window.nexgraph.auth.onEvent(setEvent)
    const offPrompt = window.nexgraph.auth.onPrompt((value) => { setPrompt(value); setAnswer('') })
    return () => {
      alive.current = false
      offEvent()
      offPrompt()
      if (loginPending.current) void window.nexgraph.auth.loginCancel()
    }
  }, [])

  const run = async (action: () => Promise<void>) => {
    if (operation.current) return
    operation.current = true
    setBusy(true)
    setError(null)
    try { await action() } catch (e) { if (alive.current) setError(messageOf(e)) }
    finally {
      operation.current = false
      if (alive.current) setBusy(false)
    }
  }
  const reset = (next: Method) => {
    setMethod(next)
    setProvider(next === 'api_key' ? 'google' : 'openai')
    setKey('')
    setModels([])
    setModel('')
    setResult(null)
    setConsent(false)
    setEvent(null)
    setFreeOnly(false)
  }
  const loadModels = async (id: string) => {
    const [items, accounts] = await Promise.all([window.nexgraph.auth.models(), window.nexgraph.auth.list()])
    if (!alive.current) return
    setModels(items)
    setProviders(accounts)
    setModel(items.find((m) => m.provider === id)?.id ?? '')
    setResult(null)
  }
  const connect = () => void run(async () => {
    if (method === 'oauth') {
      loginPending.current = true
      try { await window.nexgraph.auth.login(provider) }
      finally { loginPending.current = false; if (alive.current) setPrompt(null) }
    } else {
      await window.nexgraph.auth.setKey(provider, key.trim())
      setKey('')
    }
    await loadModels(provider)
  })
  const discover = () => void run(async () => {
    const items = await window.nexgraph.auth.discoverLocal(localUrl)
    setLocalModels(items)
    setModel(items[0]?.id ?? '')
    setResult(null)
    if (!items.length) setError('Chưa có model local. Tải một model trong Ollama rồi tìm lại.')
  })
  const test = () => void run(async () => {
    if (method === 'local') {
      await window.nexgraph.auth.connectLocal(localUrl, model)
      await loadModels('ollama-local')
    } else {
      await window.nexgraph.auth.selectModel(provider, model)
    }
    const response = await window.nexgraph.auth.test()
    const settings = await window.nexgraph.ai.getSettings()
    if (alive.current) { setResult(response); setTestedSettings(response.ok ? settings : null); setConsent(false) }
  })
  const finish = () => void run(async () => {
    const settings = await window.nexgraph.ai.getSettings()
    if (!settings.provider || !testedSettings?.provider) throw new Error('Chưa xác định được nhà cung cấp đang chọn')
    if (settings.model !== testedSettings.model || !sameConsentTarget(
      { provider: settings.provider, baseUrl: settings.baseUrl, accountId: settings.accountId },
      { provider: testedSettings.provider, baseUrl: testedSettings.baseUrl, accountId: testedSettings.accountId }))
      throw new Error('Kết nối đã thay đổi. Hãy kiểm tra lại model đang chọn.')
    if (projectId) {
      await window.nexgraph.ai.grantConsent(projectId, {
        provider: settings.provider, baseUrl: settings.baseUrl, ...(settings.accountId ? { accountId: settings.accountId } : {})
      })
    }
    onConnected()
  })
  const reply = (value: string | null) => {
    if (!prompt) return
    void window.nexgraph.auth.promptReply(prompt.id, value).catch((e) => setError(messageOf(e)))
    setPrompt(null)
  }
  const close = () => {
    if (loginPending.current) void window.nexgraph.auth.loginCancel()
    onClose()
  }
  const oauthProviders = providers.filter((p) => p.oauth && p.id !== 'anthropic')
  const apiProviders = providers.filter((p) => !p.custom && (p.authMethods?.includes('api_key') ?? true))
  const options = method === 'oauth' ? oauthProviders : apiProviders
  const modelAvailable = method === 'local' ? localModels.some((m) => m.id === model) : !!selectedModel

  return (
    <div className="modal-backdrop">
      <section role="dialog" aria-modal="true" aria-labelledby="connection-title" className="modal connection-dialog">
        <header className="connection-heading">
          <div><h2 id="connection-title">Kết nối trợ lý AI</h2><p className="muted">Chọn tài khoản, API key hoặc model chạy trên máy.</p></div>
          <button type="button" className="icon-button" aria-label="Đóng kết nối AI" onClick={close}><Icon name="close" size={18} /></button>
        </header>
        <div className="connection-methods" role="group" aria-label="Cách kết nối">
          <button type="button" aria-pressed={method === 'oauth'} disabled={busy} onClick={() => reset('oauth')}>Tài khoản</button>
          <button type="button" aria-pressed={method === 'api_key'} disabled={busy} onClick={() => reset('api_key')}>API key</button>
          <button type="button" aria-pressed={method === 'local'} disabled={busy} onClick={() => reset('local')}>Ollama local</button>
        </div>
        {error && <p role="alert" className="inline-message error">{error}</p>}
        {method === 'local' ? (
          <div className="field">
            <label htmlFor="connect-local-url">Địa chỉ Ollama</label>
            <input id="connect-local-url" value={localUrl} disabled={busy} onChange={(e) => {
              setLocalUrl(e.target.value); setLocalModels([]); setModels([]); setModel(''); setResult(null)
            }} />
            <p className="muted small">Kết nối tới Ollama trên máy này. Model local dùng RAM/VRAM của máy.</p>
            <button type="button" disabled={busy} onClick={discover}>Tìm model local</button>
            {localModels.length > 0 && <><label htmlFor="connect-local-model">Model local</label>
              <select id="connect-local-model" disabled={busy} value={model} onChange={(e) => { setModel(e.target.value); setResult(null) }}>
                {localModels.map((m) => <option key={m.id} value={m.id}>{m.label}{m.sizeBytes ? ` · ${(m.sizeBytes / 1024 ** 3).toFixed(1)} GB` : ''}</option>)}
              </select></>}
          </div>
        ) : (
          <div className="field">
            <label htmlFor="connect-provider">Nhà cung cấp</label>
            <select id="connect-provider" value={provider} disabled={busy} onChange={(e) => {
              setProvider(e.target.value); setKey(''); setModels([]); setModel(''); setResult(null); setFreeOnly(false)
            }}>
              {options.map((p) => <option key={p.id} value={p.id}>{labelFor(p)}</option>)}
            </select>
            {method === 'oauth'
              ? <p className="muted small">{provider === 'openai' ? 'Đăng nhập ChatGPT bằng trình duyệt. Cần gói Plus/Pro đủ điều kiện và workspace cho phép dùng gói trong NexGraph.' : 'Đăng nhập bằng phương thức do nhà cung cấp hỗ trợ.'}</p>
              : <><label htmlFor="connect-api-key">API key</label>
                <input id="connect-api-key" type="password" autoComplete="off" value={key} disabled={busy} onChange={(e) => setKey(e.target.value)} placeholder={selectedProvider?.hasKey ? 'Đã lưu key; nhập để thay thế' : ''} />
                {provider === 'google' && <p className="muted small">Dùng Gemini API key từ Google AI Studio. Free tier có quota theo model và dự án.</p>}
                {provider === 'openrouter' && <p className="muted small">Chọn model miễn phí hoặc trả phí theo tài khoản OpenRouter.</p>}
                {provider === 'anthropic' && <p className="muted small">Claude trong NexGraph dùng Anthropic API key.</p>}
              </>}
            {selectedProvider?.oauthStorageIssue && method === 'oauth' && <p role="status">{selectedProvider.oauthStorageIssue}</p>}
            <div className="row">
              <button type="button" className="primary" disabled={busy || !selectedProvider || method === 'api_key' && !key.trim() || method === 'oauth' && !!selectedProvider.oauthStorageIssue} onClick={connect}>
                {method === 'oauth' ? 'Tiếp tục đăng nhập' : 'Lưu API key'}
              </button>
              {(selectedProvider?.hasKey || selectedProvider?.loggedIn) && <button type="button" disabled={busy} onClick={() => void run(() => loadModels(provider))}>Dùng kết nối đã lưu</button>}
              {method === 'oauth' && provider === 'openai' && !selectedProvider?.loggedIn && <button type="button" disabled={busy} onClick={() => void run(async () => {
                await window.nexgraph.auth.forgetRegistration()
                setModels([]); setModel(''); setResult(null); setEvent(null)
              })}>Dùng tài khoản hoặc workspace khác</button>}
            </div>
            {provider === 'openrouter' && <label className="connection-check"><input type="checkbox" checked={freeOnly} disabled={busy} onChange={(e) => { setFreeOnly(e.target.checked); setModel(''); setResult(null) }} />Chỉ hiện model miễn phí</label>}
          </div>
        )}
        {event && <p className="connection-auth-status" role="status">{event.type === 'device_code' ? `Mã xác nhận ${event.userCode}` : event.type === 'auth_url' ? event.instructions ?? 'Hoàn tất đăng nhập trong trình duyệt.' : event.message}</p>}
        <AuthLinks event={event} />
        {loginPending.current && <button type="button" onClick={() => void window.nexgraph.auth.loginCancel()}>Hủy đăng nhập</button>}
        {prompt && <div className="field">
          <label htmlFor="connect-auth-answer">{prompt.message}</label>
          {prompt.options?.length ? <div className="row">{prompt.options.map((option) =>
            <button key={option.id} type="button" onClick={() => reply(option.id)}>{option.label}</button>)}</div>
            : <><input id="connect-auth-answer" type={prompt.kind === 'secret' ? 'password' : 'text'} autoComplete="off" value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <button type="button" onClick={() => reply(answer)}>Gửi xác nhận</button></>}
        </div>}
        {method !== 'local' && relevantModels.length > 0 && <div className="field">
          <label htmlFor="connect-model">Model</label>
          <select id="connect-model" value={model} disabled={busy} onChange={(e) => { setModel(e.target.value); setResult(null) }}>
            <option value="">Chọn model</option>
            {relevantModels.map((m) => <option key={m.id} value={m.id}>{m.label}{m.pricing === 'free' ? ' · Miễn phí' : ''}</option>)}
          </select>
        </div>}
        {selectedModel && <p className="connection-model-info muted small">
          Context {selectedModel.contextWindow?.toLocaleString() ?? 'chưa xác định'} token · Đầu ra {selectedModel.maxTokens?.toLocaleString() ?? 'chưa xác định'} token
          {' · '}{selectedModel.pricing === 'subscription' ? 'Theo hạn mức tài khoản' : selectedModel.pricing === 'local' ? 'Chạy trên máy' : selectedModel.pricing === 'free' ? 'Miễn phí, có quota' : selectedModel.cost?.input != null && selectedModel.cost?.output != null ? `USD / 1M token vào ${selectedModel.cost.input}, ra ${selectedModel.cost.output}` : 'Chi phí chưa xác định'}
        </p>}
        <div className="row"><button type="button" disabled={busy || !modelAvailable} onClick={test}>Kiểm tra kết nối và công cụ</button></div>
        {result && <p role="status" className={result.ok ? 'connection-success' : 'inline-message error'}>{result.message}</p>}
        {projectId && result?.ok && <label className="connection-check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Cho phép gửi ngữ cảnh dự án tới {testedSettings?.provider} tại <code>{testedSettings?.baseUrl}</code>.</span>
        </label>}
        <footer className="connection-footer">
          <button type="button" onClick={close}>Đóng</button>
          <button type="button" className="primary" disabled={busy || !result?.ok || !!projectId && !consent} onClick={finish}>{busy ? 'Đang xử lý…' : 'Dùng kết nối'}</button>
        </footer>
      </section>
    </div>
  )
}
