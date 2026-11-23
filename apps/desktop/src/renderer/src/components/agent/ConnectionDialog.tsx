import { tr } from '../../strings'
import { msg, msgText, type Message } from '../../state/messages'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AuthEventView, AuthPromptView, LocalModelInfo, ModelInfo, ProviderInfo } from '@shared/agent-types'
import { consentTargetForSettings, sameConsentTarget } from '@shared/agent-types'
import type { AiSettings } from '@shared/graph-types'
import { Icon } from '../common/icons'
import { AuthLinks } from './AuthLinks'
import { ConnectionProviderPicker, type ConnectionProvider } from './ConnectionProviderPicker'
import { GeminiConnectionPane } from './GeminiConnectionPane'
import './connection-dialog.css'

type Method = 'oauth' | 'api_key' | 'local'
const messageOf = (error: unknown): string =>
  error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
const labelFor = (provider: ProviderInfo): string =>
  ({ openai: 'OpenAI / ChatGPT', 'openai-codex': tr('Codex qua ChatGPT'), google: 'Google AI Studio', openrouter: 'OpenRouter', anthropic: 'Anthropic / Claude' } as Record<string, string>)[provider.id] ?? provider.label

type Props = {
  projectId?: string
  onConnected(): void
  onClose(): void
  initialMethod?: Method
  initialProvider?: ConnectionProvider
}

export function ConnectionDialog({ projectId, onConnected, onClose, initialMethod, initialProvider }: Props) {
  const [provider, setProvider] = useState<ConnectionProvider>(initialProvider ?? (initialMethod === 'local' ? 'local' : 'gemini'))
  const [geminiMethod, setGeminiMethod] = useState<'account' | 'api_key'>(initialMethod === 'api_key' ? 'api_key' : 'account')
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  const keyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return <div className="modal-backdrop"><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="connection-title" className="modal connection-dialog" onKeyDown={keyboard}>
    <header className="connection-heading"><div><h2 id="connection-title">{tr('Kết nối trợ lý AI')}</h2><p className="muted">{tr('Chọn nhà cung cấp phù hợp với tài khoản của bạn.')}</p></div>
      <button type="button" className="icon-button" aria-label={tr('Đóng kết nối AI')} onClick={onClose}><Icon name="close" size={18} /></button></header>
    <ConnectionProviderPicker value={provider} disabled={busy} onChange={(next) => { setProvider(next); setGeminiMethod('account') }} />
    <div className="connection-provider-detail">
      {provider === 'gemini' && <div className="connection-method-choice" role="group" aria-label={tr('Cách dùng Gemini')}>
        <button type="button" aria-label={tr('Gemini bằng tài khoản Google')} aria-pressed={geminiMethod === 'account'} disabled={busy} onClick={() => setGeminiMethod('account')}><strong>{tr('Tài khoản Google')}</strong><small>{tr('Antigravity CLI chính thức')}<br />{tr('Hạn mức theo tài khoản')}</small></button>
        <button type="button" aria-label={tr('Gemini bằng API key')} aria-pressed={geminiMethod === 'api_key'} disabled={busy} onClick={() => setGeminiMethod('api_key')}><strong>API key</strong><small>Google AI Studio<br />{tr('Hạn mức API riêng')}</small></button>
      </div>}
      {provider === 'gemini' && geminiMethod === 'account'
        ? <GeminiConnectionPane projectId={projectId} onConnected={onConnected} onClose={onClose} onBusyChange={setBusy} />
        : <PiConnectionForm key={provider} projectId={projectId} onConnected={onConnected} onClose={onClose} providerGroup={provider}
          initialMethod={provider === 'local' ? 'local' : provider === 'gemini' || provider === 'other' ? 'api_key' : initialMethod === 'api_key' ? 'api_key' : 'oauth'} onBusyChange={setBusy} />}
    </div>
  </section></div>
}

function PiConnectionForm({ projectId, onConnected, onClose, initialMethod = 'oauth', providerGroup, onBusyChange }: Props & {
  providerGroup: ConnectionProvider
  onBusyChange: (busy: boolean) => void
}) {
  const preferredProvider = providerGroup === 'gemini' ? 'google' : providerGroup === 'openai' ? 'openai' : 'anthropic'
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [method, setMethod] = useState<Method>(initialMethod)
  const [provider, setProvider] = useState(preferredProvider)
  const [key, setKey] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [model, setModel] = useState('')
  const [localUrl, setLocalUrl] = useState('http://127.0.0.1:11434/v1')
  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([])
  const [event, setEvent] = useState<AuthEventView | null>(null)
  const [prompt, setPrompt] = useState<AuthPromptView | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Message | null>(null)
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
      const available = items.filter((p) => inGroup(p) && (initialMethod === 'oauth' ? p.oauth && p.id !== 'anthropic' : p.authMethods?.includes('api_key') ?? true))
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
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false) }, [busy, onBusyChange])

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
    const options = providers.filter((item) => inGroup(item) && (next === 'oauth' ? item.oauth && item.id !== 'anthropic' : item.authMethods?.includes('api_key') ?? true))
    setProvider(options.find((item) => item.id === preferredProvider)?.id ?? options[0]?.id ?? '')
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
    if (!items.length) setError(msg('Chưa có model local. Tải một model trong Ollama rồi tìm lại.'))
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
    const target = consentTargetForSettings(settings)
    if (!target || !testedSettings) throw new Error(tr('Chưa xác định được nhà cung cấp đang chọn'))
    if (settings.model !== testedSettings.model || !sameConsentTarget(target, consentTargetForSettings(testedSettings)))
      throw new Error(tr('Kết nối đã thay đổi. Hãy kiểm tra lại model đang chọn.'))
    if (projectId) await window.nexgraph.ai.grantConsent(projectId, target)
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
  function inGroup(p: ProviderInfo) {
    return providerGroup === 'gemini' ? p.id === 'google' : providerGroup === 'openai' ? p.id === 'openai' || p.id === 'openai-codex'
      : p.id !== 'google' && p.id !== 'openai' && p.id !== 'openai-codex'
  }
  const oauthProviders = providers.filter((p) => inGroup(p) && p.oauth && p.id !== 'anthropic')
  const apiProviders = providers.filter((p) => inGroup(p) && !p.custom && (p.authMethods?.includes('api_key') ?? true))
  const options = method === 'oauth' ? oauthProviders : apiProviders
  const modelAvailable = method === 'local' ? localModels.some((m) => m.id === model) : !!selectedModel

  return (
    <>
        {providerGroup !== 'gemini' && providerGroup !== 'local' && <div className="connection-methods" role="group" aria-label={tr('Cách kết nối')}>
          <button type="button" aria-pressed={method === 'oauth'} disabled={busy} onClick={() => reset('oauth')}>{tr('Tài khoản')}</button>
          <button type="button" aria-pressed={method === 'api_key'} disabled={busy} onClick={() => reset('api_key')}>API key</button>
        </div>}
        {error && <p role="alert" className="inline-message error">{msgText(error)}</p>}
        {method === 'local' ? (
          <div className="field">
            <label htmlFor="connect-local-url">{tr('Địa chỉ Ollama')}</label>
            <input id="connect-local-url" value={localUrl} disabled={busy} onChange={(e) => {
              setLocalUrl(e.target.value); setLocalModels([]); setModels([]); setModel(''); setResult(null)
            }} />
            <p className="muted small">{tr('Kết nối tới Ollama trên máy này. Model local dùng RAM/VRAM của máy.')}</p>
            <button type="button" disabled={busy} onClick={discover}>{tr('Tìm model local')}</button>
            {localModels.length > 0 && <><label htmlFor="connect-local-model">{tr('Model local')}</label>
              <select id="connect-local-model" disabled={busy} value={model} onChange={(e) => { setModel(e.target.value); setResult(null) }}>
                {localModels.map((m) => <option key={m.id} value={m.id}>{m.label}{m.sizeBytes ? ` · ${(m.sizeBytes / 1024 ** 3).toFixed(1)} GB` : ''}</option>)}
              </select></>}
          </div>
        ) : (
          <div className="field">
            <label htmlFor="connect-provider">{tr('Nhà cung cấp')}</label>
            <select id="connect-provider" value={provider} disabled={busy} onChange={(e) => {
              setProvider(e.target.value); setKey(''); setModels([]); setModel(''); setResult(null); setFreeOnly(false)
            }}>
              {options.map((p) => <option key={p.id} value={p.id}>{labelFor(p)}</option>)}
            </select>
            {method === 'oauth'
              ? <p className="muted small">{provider === 'openai' ? tr('Đăng nhập ChatGPT bằng trình duyệt. Cần gói Plus/Pro đủ điều kiện và workspace cho phép dùng gói trong NexGraph.') : tr('Đăng nhập bằng phương thức do nhà cung cấp hỗ trợ.')}</p>
              : <><label htmlFor="connect-api-key">API key</label>
                <input id="connect-api-key" type="password" autoComplete="off" value={key} disabled={busy} onChange={(e) => setKey(e.target.value)} placeholder={selectedProvider?.hasKey ? tr('Đã lưu key; nhập để thay thế') : ''} />
                {provider === 'google' && <p className="muted small">{tr('Dùng Gemini API key từ Google AI Studio. Free tier có quota theo model và dự án.')}</p>}
                {provider === 'openrouter' && <p className="muted small">{tr('Chọn model miễn phí hoặc trả phí theo tài khoản OpenRouter.')}</p>}
                {provider === 'anthropic' && <p className="muted small">{tr('Claude trong NexGraph dùng Anthropic API key.')}</p>}
              </>}
            {selectedProvider?.oauthStorageIssue && method === 'oauth' && <p role="status">{selectedProvider.oauthStorageIssue}</p>}
            <div className="row">
              <button type="button" className="primary" disabled={busy || !selectedProvider || method === 'api_key' && !key.trim() || method === 'oauth' && !!selectedProvider.oauthStorageIssue} onClick={connect}>
                {method === 'oauth' ? tr('Tiếp tục đăng nhập') : tr('Lưu API key')}
              </button>
              {(selectedProvider?.hasKey || selectedProvider?.loggedIn) && <button type="button" disabled={busy} onClick={() => void run(() => loadModels(provider))}>{tr('Dùng kết nối đã lưu')}</button>}
              {method === 'oauth' && provider === 'openai' && !selectedProvider?.loggedIn && <button type="button" disabled={busy} onClick={() => void run(async () => {
                await window.nexgraph.auth.forgetRegistration()
                setModels([]); setModel(''); setResult(null); setEvent(null)
              })}>{tr('Dùng tài khoản hoặc workspace khác')}</button>}
            </div>
            {provider === 'openrouter' && <label className="connection-check"><input type="checkbox" checked={freeOnly} disabled={busy} onChange={(e) => { setFreeOnly(e.target.checked); setModel(''); setResult(null) }} />{tr('Chỉ hiện model miễn phí')}</label>}
          </div>
        )}
        {event && <p className="connection-auth-status" role="status">{event.type === 'device_code' ? tr('Mã xác nhận {code}', { code: event.userCode }) : event.type === 'auth_url' ? event.instructions ?? tr('Hoàn tất đăng nhập trong trình duyệt.') : event.message}</p>}
        <AuthLinks event={event} />
        {loginPending.current && <button type="button" onClick={() => void window.nexgraph.auth.loginCancel()}>{tr('Hủy đăng nhập')}</button>}
        {prompt && <div className="field">
          <label htmlFor="connect-auth-answer">{prompt.message}</label>
          {prompt.options?.length ? <div className="row">{prompt.options.map((option) =>
            <button key={option.id} type="button" onClick={() => reply(option.id)}>{option.label}</button>)}</div>
            : <><input id="connect-auth-answer" type={prompt.kind === 'secret' ? 'password' : 'text'} autoComplete="off" value={answer} onChange={(e) => setAnswer(e.target.value)} />
              <button type="button" onClick={() => reply(answer)}>{tr('Gửi xác nhận')}</button></>}
        </div>}
        {method !== 'local' && relevantModels.length > 0 && <div className="field">
          <label htmlFor="connect-model">Model</label>
          <select id="connect-model" value={model} disabled={busy} onChange={(e) => { setModel(e.target.value); setResult(null) }}>
            <option value="">{tr('Chọn model')}</option>
            {relevantModels.map((m) => <option key={m.id} value={m.id}>{m.label}{m.pricing === 'free' ? ` · ${tr('Miễn phí')}` : ''}</option>)}
          </select>
        </div>}
        {selectedModel && <p className="connection-model-info muted small">
          {tr('Context {context} token · Đầu ra {output} token', { context: selectedModel.contextWindow?.toLocaleString() ?? tr('chưa xác định'), output: selectedModel.maxTokens?.toLocaleString() ?? tr('chưa xác định') })}
          {' · '}{selectedModel.pricing === 'subscription' ? tr('Theo hạn mức tài khoản') : selectedModel.pricing === 'local' ? tr('Chạy trên máy') : selectedModel.pricing === 'free' ? tr('Miễn phí, có quota') : selectedModel.cost?.input != null && selectedModel.cost?.output != null ? tr('USD / 1M token vào {input}, ra {output}', { input: selectedModel.cost.input, output: selectedModel.cost.output }) : tr('Chi phí chưa xác định')}
        </p>}
        <div className="row"><button type="button" disabled={busy || !modelAvailable} onClick={test}>{tr('Kiểm tra kết nối và công cụ')}</button></div>
        {result && <p role="status" className={result.ok ? 'connection-success' : 'inline-message error'}>{result.message}</p>}
        {projectId && result?.ok && <label className="connection-check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{tr('Cho phép gửi ngữ cảnh dự án tới {provider} tại {url}.', { provider: testedSettings?.provider ?? '', url: testedSettings?.baseUrl ?? '' })}</span>
        </label>}
        <footer className="connection-footer">
          <button type="button" onClick={close}>{tr('Đóng')}</button>
          <button type="button" className="primary" disabled={busy || !result?.ok || !!projectId && !consent} onClick={finish}>{busy ? tr('Đang xử lý…') : tr('Dùng kết nối')}</button>
        </footer>
    </>
  )
}
