import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react'
import type { AiSettings } from '@shared/graph-types'
import type { AuthEventView, AuthPromptView, ModelInfo, ProviderInfo } from '@shared/agent-types'
import { vi } from '../strings'
import { Icon, type IconName } from '../components/common/icons'
import { THEMES, setTheme, useThemeId } from '../state/useTheme'
import { Toast } from '../components/common/Toast'
import { ConnectionDialog } from '../components/agent/ConnectionDialog'
import { AuthLinks } from '../components/agent/AuthLinks'
import { GeminiAccountSettingsCard } from '../components/agent/GeminiAccountSettingsCard'
import './settings.css'

const errCode = (e: unknown): string | undefined => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : undefined)
const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

const EMPTY_CUSTOM = { id: '', label: '', baseUrl: '', model: '', apiKey: '' }

// Từ khoá cho ô tìm: tiêu đề và vài chữ người dùng hay gõ của mỗi mục.
const SECTION_WORDS = {
  theme: 'Giao diện theme màu sáng tối dark light',
  chat: 'Giao diện khung chat AI trợ lý vị trí trái phải dock',
  quick: 'Kết nối nhanh ollama local tài khoản AI',
  gemini: 'Gemini Google Antigravity tài khoản AI',
  apikey: 'API key nhà cung cấp OpenAI Anthropic Claude khoá',
  custom: 'Nhà cung cấp tuỳ chỉnh custom base URL OpenRouter',
  oauth: 'Đăng nhập gói đăng ký ChatGPT OAuth',
  model: 'Mô hình model kiểm tra kết nối',
  privacy: 'Quyền riêng tư dữ liệu bảo mật'
}
const PAGES: { id: string; label: string; icon: IconName; sections: (keyof typeof SECTION_WORDS)[] }[] = [
  { id: 'appearance', label: 'Giao diện', icon: 'palette', sections: ['theme', 'chat'] },
  { id: 'ai', label: 'Tài khoản AI', icon: 'plug', sections: ['quick', 'gemini', 'apikey', 'custom', 'oauth'] },
  { id: 'model', label: 'Mô hình', icon: 'spark', sections: ['model'] },
  { id: 'privacy', label: 'Quyền riêng tư', icon: 'shield', sections: ['privacy'] }
]

/** Màn Tài khoản AI: key theo nhà cung cấp → nhà cung cấp tuỳ chỉnh → OAuth gói đăng ký → chọn model → kiểm tra kết nối. */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [keyProvider, setKeyProvider] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [custom, setCustom] = useState(EMPTY_CUSTOM)
  const [loginEvent, setLoginEvent] = useState<AuthEventView | null>(null)
  const [loginPrompt, setLoginPrompt] = useState<AuthPromptView | null>(null)
  const [promptInput, setPromptInput] = useState('')
  const [loginProvider, setLoginProvider] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [testing, setTesting] = useState(false)
  const [connecting, setConnecting] = useState<'oauth' | 'api_key' | 'local' | null>(null)
  const loginPending = useRef(false)
  const operation = useRef(false)
  const themeId = useThemeId()
  const [query, setQuery] = useState('')
  const [activePage, setActivePage] = useState('appearance')
  const [chatDock, setChatDock] = useState(() => { try { return localStorage.getItem('nexgraph.chat.dock') === 'right' ? 'right' : 'left' } catch { return 'left' } })

  const load = useCallback(async () => {
    const currentSettings = window.nexgraph.ai.getSettings().then(setSettings).catch((e) => {
      setSettings(null)
      setError(errMessage(e))
    })
    try {
      const a = window.nexgraph.auth
      const [providers, models] = await Promise.all([a.list(), a.models()])
      setProviders(providers)
      setModels(models)
      setKeyProvider((prev) => prev || providers.find((p) => !p.custom && p.hasKey)?.id || providers.find((p) => !p.custom)?.id || '')
    } catch (e) {
      setError(errMessage(e))
    }
    await currentSettings
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    // Sự kiện đăng nhập gửi cho cả cửa sổ: bỏ qua lượt do hộp Kết nối nhanh khởi động.
    const offEvent = window.nexgraph.auth.onEvent((e) => loginPending.current && setLoginEvent(e.type === 'progress' ? null : e))
    const offPrompt = window.nexgraph.auth.onPrompt((p) => {
      if (!loginPending.current) return
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
    if (operation.current) return
    operation.current = true
    setWorking(true)
    setStatus(null)
    setError(null)
    setTestResult(null)
    try {
      await fn()
      if (okMessage) setStatus(okMessage)
      await load()
    } catch (e) {
      setError(errCode(e) === 'no_keychain' ? vi.accounts.noKeychain : errMessage(e))
    } finally {
      operation.current = false
      setWorking(false)
    }
  }

  const saveKey = () => void run(async () => {
    await window.nexgraph.auth.setKey(keyProvider, keyInput)
    setKeyInput('')
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

  const loginCancel = () => void window.nexgraph.auth.loginCancel().catch((e) => setError(errMessage(e)))

  const answerPrompt = (value: string | null) => {
    setLoginPrompt(null)
    if (loginPrompt) void window.nexgraph.auth.promptReply(loginPrompt.id, value).catch((e) => setError(errMessage(e)))
  }

  const test = async () => {
    if (operation.current) return
    operation.current = true
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      const r = await window.nexgraph.auth.test()
      setTestResult(r.ok ? vi.accounts.testOk : vi.accounts.testFail(r.message))
    } catch (e) {
      setTestResult(vi.accounts.testFail(errMessage(e)))
    } finally {
      operation.current = false
      setTesting(false)
    }
  }

  const selected = settings?.model ?? ''
  const keyTarget = providers.find((p) => p.id === keyProvider)
  const customs = providers.filter((p) => p.custom)
  const busy = working || testing
  const oauthProviders = providers.filter((p) => p.oauth && !p.custom && p.id !== 'anthropic')
  const oauthStorageIssue = oauthProviders.find((p) => p.oauthStorageIssue)?.oauthStorageIssue
  const selectedModel = models.find((m) => m.provider === settings?.provider && m.id === settings.model)

  const q = query.trim().toLocaleLowerCase('vi')
  const shows = (id: keyof typeof SECTION_WORDS) => !q || SECTION_WORDS[id].toLocaleLowerCase('vi').includes(q)
  const pages = PAGES.filter((page) => page.sections.some(shows))
  // Bấm danh mục thì giữ mục đó sáng dù trang cuối quá ngắn để cuộn tới đỉnh.
  const jumped = useRef(0)
  const goTo = (id: string) => {
    setActivePage(id)
    jumped.current = Date.now()
    document.getElementById(`settings-${id}`)?.scrollIntoView?.({ block: 'start' })
  }
  // Đánh dấu trang đang đọc theo vị trí cuộn, như thanh trái của Wu.
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (Date.now() - jumped.current < 400) return
    const top = event.currentTarget.getBoundingClientRect().top + 48
    const current = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-settings-page]')].filter((el) => el.getBoundingClientRect().top <= top).pop()
    if (current?.dataset.settingsPage) setActivePage(current.dataset.settingsPage)
  }

  return (
    <main className="screen settings settings-wu">
      <nav className="settings-nav" aria-label="Mục cài đặt">
        <button type="button" className="settings-back" onClick={onBack}>{vi.settings.back}</button>
        <label className="settings-search"><Icon name="search" size={14} />
          <input type="search" aria-label="Tìm cài đặt" placeholder="Tìm cài đặt…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {pages.map((page) => <button key={page.id} type="button" className="settings-nav-item" aria-current={activePage === page.id ? 'true' : undefined} onClick={() => goTo(page.id)}>
          <Icon name={page.icon} size={15} /><span>{page.label}</span>
        </button>)}
      </nav>
      <div className="settings-content" onScroll={onScroll}>
      {error && <p role="alert" className="inline-message error">{error}</p>}
      {status && <Toast message={status} onDismiss={() => setStatus(null)} />}
      {pages.length === 0 && <div className="settings-empty"><strong>Không có kết quả</strong><span className="muted">Không có cài đặt nào khớp “{query.trim()}”</span></div>}

      {pages.some((p) => p.id === 'appearance') && <h1 id="settings-appearance" data-settings-page="appearance" className="settings-page-title">Giao diện</h1>}
      {shows('theme') && <section className="settings-section" aria-labelledby="settings-theme-title">
        <h2 id="settings-theme-title">Theme</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-theme">Theme</label><p>Màu của toàn bộ app và editor. Cũng mở được bằng ⌘K rồi ⌘T.</p></div>
          <select id="settings-theme" value={themeId} onChange={(e) => setTheme(e.target.value)}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </section>}
      {shows('chat') && <section className="settings-section" aria-labelledby="settings-chat-title">
        <h2 id="settings-chat-title">Khung chat AI</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-chat-dock">Vị trí</label><p>Bên trái dùng chung chỗ với cây tệp như Wu; bên phải đứng cạnh cây tệp. Ẩn/hiện bằng Ctrl+L.</p></div>
          <select id="settings-chat-dock" value={chatDock} onChange={(e) => {
            const dock = e.target.value === 'right' ? 'right' : 'left'
            setChatDock(dock)
            try { localStorage.setItem('nexgraph.chat.dock', dock) } catch { /* chỉ là tuỳ chọn */ }
          }}>
            <option value="left">Bên trái (kiểu Wu)</option>
            <option value="right">Bên phải</option>
          </select>
        </div>
      </section>}

      {pages.some((p) => p.id === 'ai') && <h1 id="settings-ai" data-settings-page="ai" className="settings-page-title">{vi.accounts.title}</h1>}
      {shows('quick') && <section className="settings-section" aria-labelledby="settings-quick-title">
        <h2 id="settings-quick-title">Kết nối nhanh</h2>
        <div className="settings-row">
          <div><span className="settings-label">Kết nối</span><p>Chọn nhà cung cấp và đăng nhập trong một hộp thoại, hoặc dùng model chạy trên máy qua Ollama.</p></div>
          <div className="row">
            <button type="button" className="primary" disabled={busy} onClick={() => setConnecting('oauth')}>Kết nối nhanh</button>
            <button type="button" disabled={busy} onClick={() => setConnecting('local')}>Kết nối Ollama local</button>
          </div>
        </div>
      </section>}

      {shows('gemini') && <GeminiAccountSettingsCard active={settings?.runtime === 'antigravity-cli' && !!settings.model} disabled={busy} onConnect={() => setConnecting('oauth')}
        onApiKey={() => setConnecting('api_key')} onDisconnected={() => void load()} />}

      {shows('apikey') && <section className="settings-section">
        <h2>{vi.accounts.apiKeyTitle}</h2>
        <p className="muted">{vi.accounts.apiKeyLead}</p>
        <label className="field">{vi.accounts.provider}
          <select value={keyProvider} disabled={busy} onChange={(e) => {
            setKeyProvider(e.target.value)
            setKeyInput('')
          }}>
            {providers.filter((p) => !p.custom && (p.authMethods?.includes('api_key') ?? true)).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {keyTarget?.hasKey && <p className="muted">{vi.accounts.keySaved}</p>}
        {keyTarget?.description && <p className="muted small">{keyTarget.description}</p>}
        <div className="field">
          <label htmlFor="account-key">{vi.accounts.apiKey}</label>
          <input id="account-key" type="password" autoComplete="off" disabled={busy}
            value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder={keyTarget?.hasKey ? vi.accounts.keyPlaceholder : ''} />
          <div className="row">
            <button type="button" className="primary" onClick={saveKey} disabled={busy || !keyProvider || !keyInput.trim()}>{vi.accounts.saveKey}</button>
            {keyTarget?.hasKey && <button type="button" disabled={busy} onClick={removeKey}>{vi.accounts.removeKey}</button>}
          </div>
        </div>
      </section>}

      {shows('custom') && <section className="settings-section">
        <h2>{vi.accounts.customTitle}</h2>
        <p className="muted">{vi.accounts.customLead}</p>
        <p className="muted small" role="note">{vi.accounts.customSecurityNote}</p>
        {customs.length > 0 && (
          <ul className="muted">
            {customs.map((c) => (
              <li key={c.id}>
                {c.label} · {c.id}
                <button type="button" className="link" disabled={busy} onClick={() => removeCustom(c.id)}>{vi.accounts.removeCustom}</button>
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
              disabled={busy || !custom.id.trim() || !custom.label.trim() || !custom.baseUrl.trim() || !custom.model.trim()}>{vi.accounts.saveCustom}</button>
          </div>
        </div>
      </section>}

      {shows('oauth') && <section className="settings-section">
        <h2>{vi.accounts.oauthTitle}</h2>
        <p className="muted">Đăng nhập ChatGPT và các tài khoản được nhà cung cấp hỗ trợ. Quyền dùng model và hạn mức tùy tài khoản. Claude trong NexGraph dùng Anthropic API key.</p>
        {oauthStorageIssue && <p role="status" className="muted">{oauthStorageIssue}</p>}
        {loginEvent && <p className="muted">{'userCode' in loginEvent ? `${vi.accounts.oauthUserCode}: ${loginEvent.userCode}` : 'url' in loginEvent ? loginEvent.instructions ?? loginEvent.url : loginEvent.message}</p>}
        <AuthLinks event={loginEvent} />
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
          <div className="row settings-oauth-row" key={p.id}>
            <span className="settings-oauth-name">{p.label}</span>
            {p.loggedIn
              ? <button type="button" disabled={busy} onClick={() => void run(async () => { await window.nexgraph.auth.logout(p.id) }, vi.accounts.saved)}>{vi.accounts.oauthLogout}</button>
              : <button type="button" disabled={busy || !!p.oauthStorageIssue} onClick={() => login(p.id)}>{vi.accounts.oauthLogin}</button>}
            {p.id === 'openai' && !p.loggedIn && <button type="button" disabled={busy} onClick={() => void run(async () => {
              await window.nexgraph.auth.forgetRegistration()
            }, 'Đã bỏ đăng ký ChatGPT đã lưu. Lần đăng nhập tiếp theo có thể chọn tài khoản hoặc workspace khác.')}>Dùng tài khoản hoặc workspace khác</button>}
          </div>
        ))}
      </section>}

      {pages.some((p) => p.id === 'model') && <h1 id="settings-model" data-settings-page="model" className="settings-page-title">Mô hình</h1>}
      {shows('model') && <section className="settings-section">
        <h2>{vi.accounts.modelTitle}</h2>
        <label className="field">{vi.accounts.modelTitle}
          <select disabled={busy} value={settings?.provider && selected ? `${settings.provider}/${selected}` : ''} onChange={(e) => {
            const m = models.find((x) => `${x.provider}/${x.id}` === e.target.value)
            if (m) void run(() => window.nexgraph.auth.selectModel(m.provider, m.id))
          }}>
            <option value="">{vi.accounts.modelPlaceholder}</option>
            {models.filter((m) => settings?.runtime === 'antigravity-cli' ? m.runtime === 'antigravity-cli' || m.provider === 'google-antigravity' : m.runtime !== 'antigravity-cli' && m.provider !== 'google-antigravity').map((m) => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.id === 'auto' ? 'Tự động' : m.label} ({m.provider === 'google-antigravity' ? 'Tài khoản Google' : m.provider})</option>)}
          </select>
        </label>
        {selectedModel && <p className="muted small">
          Context {selectedModel.contextWindow?.toLocaleString() ?? 'chưa xác định'} token · Đầu ra {selectedModel.maxTokens?.toLocaleString() ?? 'chưa xác định'} token
          {' · '}{selectedModel.pricing === 'local' ? 'Chạy trên máy' : selectedModel.pricing === 'subscription' ? 'Theo hạn mức tài khoản'
            : selectedModel.pricing === 'free' ? 'Miễn phí, có quota' : selectedModel.cost?.input != null && selectedModel.cost?.output != null
              ? `USD / 1M token vào ${selectedModel.cost.input}, ra ${selectedModel.cost.output}` : 'Chi phí chưa xác định'}
        </p>}

        <div className="row">
          <button type="button" disabled={busy} onClick={() => void test()}>{testing ? 'Đang kiểm tra…' : vi.accounts.test}</button>
          {testResult && <span role="status">{testResult}</span>}
        </div>
      </section>}

      {pages.some((p) => p.id === 'privacy') && <h1 id="settings-privacy" data-settings-page="privacy" className="settings-page-title">{vi.settings.privacyTitle}</h1>}
      {shows('privacy') && <section className="settings-section">
        <h2>Dữ liệu</h2>
        <p>{vi.settings.privacy1}</p>
        <p>{vi.settings.privacy2}</p>
      </section>}
      </div>
      {connecting && <ConnectionDialog initialMethod={connecting} onClose={() => setConnecting(null)}
        onConnected={() => { setConnecting(null); void load() }} />}
    </main>
  )
}
