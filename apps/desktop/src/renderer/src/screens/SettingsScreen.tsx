import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react'
import type { AiSettings } from '@shared/graph-types'
import type { AuthEventView, AuthPromptView, ModelInfo, ProviderInfo } from '@shared/agent-types'
import { tr, vi } from '../strings'
import { formatNumber, setLocale, useLocale } from '../state/locale'
import { Icon, type IconName } from '../components/common/icons'
import { THEMES, setTheme, useThemeId, useThemesVersion } from '../state/useTheme'
import { setBlame, setEditorPrefs, setVimMode, useBlame, useEditorPrefs, useVimMode } from '../state/editorPrefs'
import { CHAT_WIDTH, TERMINAL_HEIGHT, setChatDock, setChatWidth, setExplorerOpen, setStatusBar, setStatusItemHidden, setTerminalHeight, useChatDock, useChatWidth, useExplorerOpen, useHiddenStatusItems, useStatusBar, useTerminalHeight } from '../state/layoutPrefs'
import { STATUS_BAR_ITEMS } from '../state/statusBarRegistry'
import { Toast } from '../components/common/Toast'
import { errorText } from '../state/errorText'
import { ConnectionDialog } from '../components/agent/ConnectionDialog'
import { AuthLinks } from '../components/agent/AuthLinks'
import { GeminiAccountSettingsCard } from '../components/agent/GeminiAccountSettingsCard'
import { KeymapEditor } from '../components/settings/KeymapEditor'
import { ProfileEditor } from '../components/settings/ProfileEditor'
import { ExtensionList } from '../components/settings/ExtensionList'
import { setNotifyPrefs, useNotifyPrefs } from '../state/agentNotify'
import './settings.css'

const errCode = (e: unknown): string | undefined => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : undefined)
const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

const EMPTY_CUSTOM = { id: '', label: '', baseUrl: '', model: '', apiKey: '', contextWindow: '' }
/** Cùng giới hạn với `saveCustomProvider` ở main: số nguyên dương ≤ 10 triệu; để trống = tự nhận/mặc định. */
const parseContextWindow = (raw: string): { value?: number; invalid: boolean } => {
  const text = raw.trim()
  if (text === '') return { invalid: false }
  const value = Number(text)
  return Number.isInteger(value) && value > 0 && value <= 10_000_000 ? { value, invalid: false } : { invalid: true }
}
const STATUS_ITEMS = STATUS_BAR_ITEMS.filter(({ id }) => id !== 'engine').map(({ id, labelKey }) => ({ id, label: labelKey }))

// Từ khoá cho ô tìm: tiêu đề và vài chữ người dùng hay gõ của mỗi mục.
const SECTION_WORDS = {
  theme: () => tr('Giao diện theme màu sáng tối dark light bộ icon tệp file icons'),
  chat: () => tr('Khung chat AI trợ lý vị trí trái phải dock độ rộng panels bảng'),
  editor: () => tr('Trình soạn thảo editor vim chế độ phím cỡ chữ font size tab ngắt dòng wrap định dạng lưu format auto save tự lưu terminal'),
  keymap: () => tr('Phím tắt keymap keybinding shortcut lệnh bàn phím base keymap vs code vscode jetbrains sublime nguồn'),
  blame: () => tr('Version Control Git blame inline từng dòng tác giả commit tóm tắt độ trễ'),
  layout: () => tr('Panels bảng bố cục terminal chiều cao cây tệp explorer mở sẵn thanh trạng thái status bar'),
  profiles: () => tr('Hồ sơ trợ lý profile tool công cụ chạy lệnh agent'),
  notify: () => tr('Thông báo hệ thống âm thanh chuông trợ lý xong lỗi chờ duyệt cửa sổ nền notification sound'),
  extensions: () => tr('Extension tiện ích mở rộng plugin theme lệnh cài'),
  quick: () => tr('Kết nối nhanh ollama local tài khoản AI'),
  gemini: () => tr('Gemini Google Antigravity tài khoản AI'),
  apikey: () => tr('API key nhà cung cấp OpenAI Anthropic Claude khoá'),
  custom: () => tr('Nhà cung cấp tuỳ chỉnh custom base URL OpenRouter'),
  oauth: () => tr('Đăng nhập gói đăng ký ChatGPT OAuth'),
  model: () => tr('Mô hình model kiểm tra kết nối'),
  privacy: () => tr('Quyền riêng tư dữ liệu bảo mật'),
  language: () => tr('Ngôn ngữ giao diện language locale Tiếng Việt English')
}
const PAGES = (): { id: string; label: string; icon: IconName; sections: (keyof typeof SECTION_WORDS)[] }[] => [
  { id: 'appearance', label: tr('Giao diện'), icon: 'palette', sections: ['theme', 'language', 'editor'] },
  { id: 'keymap', label: tr('Phím tắt'), icon: 'keyboard', sections: ['keymap'] },
  { id: 'panels', label: tr('Bảng'), icon: 'panelLeft', sections: ['chat', 'layout'] },
  { id: 'vcs', label: tr('Quản lý phiên bản'), icon: 'branch', sections: ['blame'] },
  { id: 'agent', label: tr('Trợ lý AI'), icon: 'spark', sections: ['profiles', 'notify'] },
  { id: 'extensions', label: tr('Extension'), icon: 'plug', sections: ['extensions'] },
  { id: 'ai', label: tr('Tài khoản AI'), icon: 'plug', sections: ['quick', 'gemini', 'apikey', 'custom', 'oauth'] },
  { id: 'model', label: tr('Mô hình'), icon: 'spark', sections: ['model'] },
  { id: 'privacy', label: tr('Quyền riêng tư'), icon: 'shield', sections: ['privacy'] }
]

function NumberSetting({ id, value, min, max, onChange }: { id: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return <input id={id} type="number" min={min} max={max} step={1} value={draft}
    onChange={(event) => {
      const next = event.currentTarget.value
      setDraft(next)
      const n = event.currentTarget.valueAsNumber
      if (Number.isInteger(n) && n >= min && n <= max) onChange(n)
    }}
    onBlur={() => {
      const n = Number(draft)
      if (draft.trim() && Number.isFinite(n)) {
        const clamped = Math.min(max, Math.max(min, Math.round(n)))
        onChange(clamped)
        setDraft(String(clamped))
      } else setDraft(String(value))
    }} />
}

/** Màn Tài khoản AI: key theo nhà cung cấp → nhà cung cấp tuỳ chỉnh → OAuth gói đăng ký → chọn model → kiểm tra kết nối. */
export function SettingsScreen({ onBack, initialPage }: { onBack: () => void; initialPage?: string }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [keyProvider, setKeyProvider] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [custom, setCustom] = useState(EMPTY_CUSTOM)
  const contextInvalid = parseContextWindow(custom.contextWindow).invalid
  const [loginEvent, setLoginEvent] = useState<AuthEventView | null>(null)
  const [loginPrompt, setLoginPrompt] = useState<AuthPromptView | null>(null)
  const [promptInput, setPromptInput] = useState('')
  const [loginProvider, setLoginProvider] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  // Hàng đợi toast: nhiều auth:notice cùng lúc phải hiện đủ, không ghi đè nhau.
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([])
  const toastSeq = useRef(0)
  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const pushToast = useCallback((message: string) => setToasts((list) => [...list, { id: ++toastSeq.current, message }]), [])
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [testing, setTesting] = useState(false)
  const [connecting, setConnecting] = useState<'oauth' | 'api_key' | 'local' | null>(null)
  const loginPending = useRef(false)
  const operation = useRef(false)
  const themeId = useThemeId()
  useThemesVersion()
  const vimMode = useVimMode()
  const editorPrefs = useEditorPrefs()
  const notifyPrefs = useNotifyPrefs()
  const [query, setQuery] = useState('')
  const [activePage, setActivePage] = useState('appearance')
  const blameOn = useBlame()
  const chatDock = useChatDock()
  const chatWidth = useChatWidth()
  const terminalHeight = useTerminalHeight()
  const explorerOpen = useExplorerOpen()
  const statusBar = useStatusBar()
  const hiddenStatusItems = useHiddenStatusItems()
  const locale = useLocale()

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
    // Catalog model đổi ở main (refresh nền sau khi lưu key): tải lại để bộ chọn thấy model mới
    // mà không phải đóng/mở lại Cài đặt. Listener huỷ khi unmount.
    return window.nexgraph.auth.onModelsChanged(() => { void load() })
  }, [load])

  useEffect(() => {
    // Sự kiện đăng nhập gửi cho cả cửa sổ: bỏ qua lượt do hộp Kết nối nhanh khởi động.
    const offEvent = window.nexgraph.auth.onEvent((e) => loginPending.current && setLoginEvent(e.type === 'progress' ? null : e))
    const offPrompt = window.nexgraph.auth.onPrompt((p) => {
      if (!loginPending.current) return
      setLoginPrompt(p)
      setPromptInput('')
    })
    // Thông báo ngoài luồng đăng nhập (ví dụ Đăng xuất không nạp lại được key) — không phụ thuộc loginPending.
    const offNotice = window.nexgraph.auth.onNotice((n) => pushToast(tr(n.message)))
    return () => {
      offEvent()
      offPrompt()
      offNotice()
      if (loginPending.current) void window.nexgraph.auth.loginCancel()
    }
  }, [pushToast])

  const run = async (fn: () => Promise<void>, okMessage?: string) => {
    if (operation.current) return
    operation.current = true
    setWorking(true)
    setToasts([])
    setError(null)
    setTestResult(null)
    try {
      await fn()
      if (okMessage) pushToast(okMessage)
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
    const contextWindow = parseContextWindow(custom.contextWindow)
    if (contextWindow.invalid) return
    await window.nexgraph.auth.saveCustom({ id, label, baseUrl, model, ...(contextWindow.value ? { contextWindow: contextWindow.value } : {}) }, apiKey === '' ? undefined : apiKey)
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
      setTestResult(r.ok ? vi.accounts.testOk : `${tr(r.message)}${r.detail ? ` — ${r.detail}` : ''}`)
    } catch (e) {
      setTestResult(errorText(e))
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
  const shows = (id: keyof typeof SECTION_WORDS) => !q || SECTION_WORDS[id]().toLocaleLowerCase('vi').includes(q)
  const pages = PAGES().filter((page) => page.sections.some(shows))
  // Bấm danh mục thì giữ mục đó sáng dù trang cuối quá ngắn để cuộn tới đỉnh.
  const jumped = useRef(0)
  const goTo = (id: string) => {
    setActivePage(id)
    jumped.current = Date.now()
    document.getElementById(`settings-${id}`)?.scrollIntoView?.({ block: 'start' })
  }
  useEffect(() => { if (initialPage) goTo(initialPage) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Đánh dấu trang đang đọc theo vị trí cuộn, như thanh trái của Wu.
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (Date.now() - jumped.current < 400) return
    const top = event.currentTarget.getBoundingClientRect().top + 48
    const current = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-settings-page]')].filter((el) => el.getBoundingClientRect().top <= top).pop()
    if (current?.dataset.settingsPage) setActivePage(current.dataset.settingsPage)
  }

  return (
    <main className="screen settings settings-wu">
      <nav className="settings-nav" aria-label={tr('Mục cài đặt')}>
        <button type="button" className="settings-back" onClick={onBack}>{vi.settings.back}</button>
        <label className="settings-search"><Icon name="search" size={14} />
          <input type="search" aria-label={tr('Tìm cài đặt')} placeholder={tr('Tìm cài đặt…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {pages.map((page) => <button key={page.id} type="button" className="settings-nav-item" aria-current={activePage === page.id ? 'true' : undefined} onClick={() => goTo(page.id)}>
          <Icon name={page.icon} size={15} /><span>{page.label}</span>
        </button>)}
      </nav>
      <div className="settings-content" onScroll={onScroll}>
      {error && <p role="alert" className="inline-message error">{error}</p>}
      {toasts.length > 0 && <div className="toast-stack">
        {toasts.map((t) => <Toast key={t.id} message={t.message} onDismiss={() => dismissToast(t.id)} />)}
      </div>}
      {pages.length === 0 && <div className="settings-empty"><strong>{tr('Không có kết quả')}</strong><span className="muted">{tr('Không có cài đặt nào khớp “{query}”', { query: query.trim() })}</span></div>}

      {pages.some((p) => p.id === 'appearance') && <h1 id="settings-appearance" data-settings-page="appearance" className="settings-page-title">{tr('Giao diện')}</h1>}
      {shows('language') && <section className="settings-section" aria-labelledby="settings-language-title">
        <h2 id="settings-language-title">{tr('Ngôn ngữ')}</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-locale">{tr('Ngôn ngữ giao diện')}</label><p>{tr('Đổi ngay, không cần khởi động lại.')}</p></div>
          <select id="settings-locale" value={locale} onChange={(e) => setLocale(e.target.value === 'en' ? 'en' : 'vi')}>
            <option value="vi">{tr('Tiếng Việt')}</option>
            <option value="en">{tr('English')}</option>
          </select>
        </div>
      </section>}
      {shows('theme') && <section className="settings-section" aria-labelledby="settings-theme-title">
        <h2 id="settings-theme-title">{tr('Chủ đề màu')}</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-theme">{tr('Chủ đề màu')}</label><p>{tr('Màu của toàn bộ app và editor. Cũng mở được bằng ⌘K rồi ⌘T hoặc từ bảng lệnh (⌘⇧P).')}</p></div>
          <select id="settings-theme" value={themeId} onChange={(e) => setTheme(e.target.value)}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-icon-theme">{tr('Bộ icon tệp')}</label><p>{tr('Icon dùng trong cây tệp, thẻ editor và tìm tệp.')}</p></div>
          <select id="settings-icon-theme" value={editorPrefs.iconTheme} onChange={(e) => setEditorPrefs({ iconTheme: e.target.value === 'mono' ? 'mono' : 'symbols' })}>
            <option value="symbols">{tr('Symbols (có màu)')}</option><option value="mono">{tr('Đơn sắc')}</option>
          </select>
        </div>
      </section>}
      {shows('editor') && <section className="settings-section" aria-labelledby="settings-editor-title">
        <h2 id="settings-editor-title">{tr('Trình soạn thảo')}</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-font-size">{tr('Cỡ chữ editor')}</label><p>{tr('Cỡ chữ cho nội dung tệp (8–32). ⌘= / ⌘- thu phóng tạm thời, ⌘0 đặt lại.')}</p></div>
          <NumberSetting id="settings-font-size" value={editorPrefs.fontSize} min={8} max={32} onChange={(fontSize) => setEditorPrefs({ fontSize })} />
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-terminal-font-size">{tr('Cỡ chữ terminal')}</label><p>{tr('Cỡ chữ trong terminal (8–32).')}</p></div>
          <NumberSetting id="settings-terminal-font-size" value={editorPrefs.terminalFontSize} min={8} max={32} onChange={(terminalFontSize) => setEditorPrefs({ terminalFontSize })} />
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-tab-size">{tr('Cỡ tab')}</label><p>{tr('Số khoảng trắng mặc định; tệp mới mở có thể tự nhận diện thụt lề.')}</p></div>
          <select id="settings-tab-size" value={editorPrefs.tabSize} onChange={(e) => setEditorPrefs({ tabSize: Number(e.target.value) as 2 | 4 | 8 })}>
            <option value={2}>2</option><option value={4}>4</option><option value={8}>8</option>
          </select>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-wrap">{tr('Ngắt dòng')}</label><p>{tr('Ngắt dòng dài theo chiều rộng editor.')}</p></div>
          <select id="settings-wrap" value={editorPrefs.wordWrap} onChange={(e) => setEditorPrefs({ wordWrap: e.target.value === 'on' ? 'on' : 'off' })}>
            <option value="off">{tr('Tắt')}</option><option value="on">{tr('Theo khung')}</option>
          </select>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-cursor-blink">{tr('Chớp con trỏ')}</label><p>{tr('Cho con trỏ nhấp nháy trong editor.')}</p></div>
          <button id="settings-cursor-blink" type="button" role="switch" aria-checked={editorPrefs.cursorBlink}
            className={`switch${editorPrefs.cursorBlink ? ' on' : ''}`} onClick={() => setEditorPrefs({ cursorBlink: !editorPrefs.cursorBlink })}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-cursor-shape">{tr('Kiểu con trỏ')}</label><p>{tr('Hình dạng của con trỏ khi soạn thảo.')}</p></div>
          <select id="settings-cursor-shape" value={editorPrefs.cursorShape} onChange={(e) => setEditorPrefs({ cursorShape: e.target.value === 'block' || e.target.value === 'underline' ? e.target.value : 'bar' })}>
            <option value="bar">{tr('Thanh')}</option><option value="block">{tr('Khối')}</option><option value="underline">{tr('Gạch dưới')}</option>
          </select>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-current-line-highlight">{tr('Kiểu dòng hiện tại')}</label><p>{tr('Cách làm nổi bật dòng đang có con trỏ.')}</p></div>
          <select id="settings-current-line-highlight" value={editorPrefs.currentLineHighlight} onChange={(e) => setEditorPrefs({ currentLineHighlight: e.target.value === 'none' || e.target.value === 'gutter' || e.target.value === 'line' ? e.target.value : 'all' })}>
            <option value="none">{tr('Tắt')}</option><option value="gutter">{tr('Ở lề')}</option><option value="line">{tr('Cả dòng')}</option><option value="all">{tr('Tất cả')}</option>
          </select>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-selection-highlight">{tr('Tô sáng vùng chọn')}</label><p>{tr('Làm nổi bật các đoạn trùng với vùng đang chọn.')}</p></div>
          <button id="settings-selection-highlight" type="button" role="switch" aria-checked={editorPrefs.selectionHighlight}
            className={`switch${editorPrefs.selectionHighlight ? ' on' : ''}`} onClick={() => setEditorPrefs({ selectionHighlight: !editorPrefs.selectionHighlight })}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-auto-signature-help">{tr('Gợi ý chữ ký tự động')}</label><p>{tr('Hiện gợi ý tham số khi gõ lời gọi hàm.')}</p></div>
          <button id="settings-auto-signature-help" type="button" role="switch" aria-checked={editorPrefs.autoSignatureHelp}
            className={`switch${editorPrefs.autoSignatureHelp ? ' on' : ''}`} onClick={() => setEditorPrefs({ autoSignatureHelp: !editorPrefs.autoSignatureHelp })}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-hover">{tr('Hiện thông tin khi di chuột')}</label><p>{tr('Hiện thông tin định nghĩa và tài liệu khi rê chuột vào mã.')}</p></div>
          <button id="settings-hover" type="button" role="switch" aria-checked={editorPrefs.hoverEnabled}
            className={`switch${editorPrefs.hoverEnabled ? ' on' : ''}`} onClick={() => setEditorPrefs({ hoverEnabled: !editorPrefs.hoverEnabled })}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-inline-diagnostics">{tr('Chẩn đoán ngay trong dòng')}</label><p>{tr('Hiện lỗi và cảnh báo ngay dưới dòng mã.')}</p></div>
          <button id="settings-inline-diagnostics" type="button" role="switch" aria-checked={editorPrefs.inlineDiagnostics}
            className={`switch${editorPrefs.inlineDiagnostics ? ' on' : ''}`} onClick={() => setEditorPrefs({ inlineDiagnostics: !editorPrefs.inlineDiagnostics })}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-format-save">{tr('Định dạng khi lưu')}</label><p>{tr('Định dạng tệp trước khi lưu nếu có formatter cho ngôn ngữ đó.')}</p></div>
          <button id="settings-format-save" type="button" role="switch" aria-checked={editorPrefs.formatOnSave}
            className={`switch${editorPrefs.formatOnSave ? ' on' : ''}`} onClick={() => setEditorPrefs({ formatOnSave: !editorPrefs.formatOnSave })}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-auto-save">{tr('Tự lưu')}</label><p>{tr('Khi nào lưu các thay đổi trong editor.')}</p></div>
          <select id="settings-auto-save" value={editorPrefs.autoSave} onChange={(e) => setEditorPrefs({ autoSave: e.target.value === 'afterDelay' || e.target.value === 'onFocusChange' ? e.target.value : 'off' })}>
            <option value="off">{tr('Tắt')}</option><option value="afterDelay">{tr('Sau khi dừng gõ')}</option><option value="onFocusChange">{tr('Khi rời editor')}</option>
          </select>
        </div>
        {editorPrefs.autoSave === 'afterDelay' && <div className="settings-row">
          <div><label htmlFor="settings-auto-save-delay">{tr('Thời gian chờ (ms)')}</label><p>{tr('Lưu sau khoảng thời gian không gõ.')}</p></div>
          <NumberSetting id="settings-auto-save-delay" value={editorPrefs.autoSaveDelay} min={1} max={2147483647} onChange={(autoSaveDelay) => setEditorPrefs({ autoSaveDelay })} />
        </div>}
        <div className="settings-row">
          <div><label htmlFor="settings-vim">{tr('Chế độ Vim')}</label><p>{tr('Phím kiểu Vim trong editor (normal/insert/visual); trạng thái hiện ở thanh dưới. Bật/tắt cũng được từ bảng lệnh.')}</p></div>
          <button id="settings-vim" type="button" role="switch" aria-checked={vimMode} className={`switch${vimMode ? ' on' : ''}`} onClick={() => setVimMode(!vimMode)}><span /></button>
        </div>
      </section>}

      {pages.some((p) => p.id === 'keymap') && <h1 id="settings-keymap" data-settings-page="keymap" className="settings-page-title">{tr('Phím tắt')}</h1>}
      {shows('keymap') && <section className="settings-section" aria-label={tr('Phím tắt')}>
        <p className="muted">{tr('Bấm Đổi hoặc bấm đúp một dòng rồi nhấn tổ hợp mới; hợp âm hai bước như ⌘K ⌘T cũng được. Một phím chỉ thuộc một lệnh.')}</p>
        <KeymapEditor />
      </section>}

      {pages.some((p) => p.id === 'panels') && <h1 id="settings-panels" data-settings-page="panels" className="settings-page-title">{tr('Bảng')}</h1>}
      {shows('chat') && <section className="settings-section" aria-labelledby="settings-chat-title">
        <h2 id="settings-chat-title">{tr('Khung chat AI')}</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-chat-dock">{tr('Vị trí')}</label><p>{tr('Bên trái dùng chung chỗ với cây tệp như Wu; bên phải đứng cạnh cây tệp. Ẩn/hiện bằng ⌘L.')}</p></div>
          <select id="settings-chat-dock" value={chatDock} onChange={(e) => setChatDock(e.target.value === 'right' ? 'right' : 'left')}>
            <option value="left">{tr('Bên trái (kiểu Wu)')}</option>
            <option value="right">{tr('Bên phải')}</option>
          </select>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-chat-width">{tr('Độ rộng (px)')}</label><p>{tr('Độ rộng khung chat ({min}–{max}); cũng kéo được thanh chia cạnh khung.', { min: CHAT_WIDTH.min, max: CHAT_WIDTH.max })}</p></div>
          <NumberSetting id="settings-chat-width" value={chatWidth} min={CHAT_WIDTH.min} max={CHAT_WIDTH.max} onChange={setChatWidth} />
        </div>
      </section>}
      {shows('layout') && <section className="settings-section" aria-labelledby="settings-layout-title">
        <h2 id="settings-layout-title">{tr('Bố cục')}</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-terminal-height">{tr('Chiều cao terminal (px)')}</label><p>{tr('Chiều cao panel terminal ở dưới ({min}–{max}, không vượt quá cửa sổ); cũng kéo được thanh chia phía trên terminal.', { min: TERMINAL_HEIGHT.min, max: TERMINAL_HEIGHT.max })}</p></div>
          <NumberSetting id="settings-terminal-height" value={terminalHeight} min={TERMINAL_HEIGHT.min} max={TERMINAL_HEIGHT.max} onChange={setTerminalHeight} />
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-explorer-open">{tr('Mở sẵn cây tệp')}</label><p>{tr('Vào dự án thì hiện sẵn cây tệp ở bên trái. Áp dụng từ lần mở dự án tiếp theo.')}</p></div>
          <button id="settings-explorer-open" type="button" role="switch" aria-checked={explorerOpen} className={`switch${explorerOpen ? ' on' : ''}`} onClick={() => setExplorerOpen(!explorerOpen)}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-status-bar">{tr('Hiện thanh trạng thái')}</label><p>{tr('Thanh dưới cùng: trạng thái engine, vị trí con trỏ, ngôn ngữ, kiểu xuống dòng. Engine lỗi thì thanh vẫn hiện để còn nút Khởi động lại.')}</p></div>
          <button id="settings-status-bar" type="button" role="switch" aria-checked={statusBar} className={`switch${statusBar ? ' on' : ''}`} onClick={() => setStatusBar(!statusBar)}><span /></button>
        </div>
        <div className="settings-status-items">
          <h3>{tr('Mục thanh trạng thái')}</h3>
          {STATUS_ITEMS.map(({ id, label }) => {
            const shown = !hiddenStatusItems.has(id)
            return <div className="settings-row" key={id}>
              <div><label htmlFor={`settings-status-${id}`}>{tr(label)}</label></div>
              <button id={`settings-status-${id}`} type="button" role="switch" aria-checked={shown} className={`switch${shown ? ' on' : ''}`} onClick={() => setStatusItemHidden(id, shown)}><span /></button>
            </div>
          })}
        </div>
      </section>}

      {pages.some((p) => p.id === 'vcs') && <h1 id="settings-vcs" data-settings-page="vcs" className="settings-page-title">{tr('Quản lý phiên bản')}</h1>}
      {shows('blame') && <section className="settings-section" aria-labelledby="settings-blame-title">
        <h2 id="settings-blame-title">{tr('Blame từng dòng')}</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-blame">{tr('Hiện blame')}</label><p>{tr('Tác giả và thời điểm sửa dòng có con trỏ, hiện mờ ở cuối dòng khi tệp không có thay đổi chưa lưu. Bật/tắt cũng được từ bảng lệnh.')}</p></div>
          <button id="settings-blame" type="button" role="switch" aria-checked={blameOn} className={`switch${blameOn ? ' on' : ''}`} onClick={() => setBlame(!blameOn)}><span /></button>
        </div>
        {blameOn && <>
          <div className="settings-row">
            <div><label htmlFor="settings-blame-delay">{tr('Độ trễ (ms)')}</label><p>{tr('Chờ con trỏ đứng yên trên dòng bấy lâu rồi mới hiện blame (0–5000); 0 là hiện ngay.')}</p></div>
            <NumberSetting id="settings-blame-delay" value={editorPrefs.blameDelay} min={0} max={5000} onChange={(blameDelay) => setEditorPrefs({ blameDelay })} />
          </div>
          <div className="settings-row">
            <div><label htmlFor="settings-blame-summary">{tr('Kèm tóm tắt commit')}</label><p>{tr('Thêm dòng đầu thông điệp commit sau tên tác giả và thời điểm.')}</p></div>
            <button id="settings-blame-summary" type="button" role="switch" aria-checked={editorPrefs.blameSummary}
              className={`switch${editorPrefs.blameSummary ? ' on' : ''}`} onClick={() => setEditorPrefs({ blameSummary: !editorPrefs.blameSummary })}><span /></button>
          </div>
        </>}
      </section>}

      {pages.some((p) => p.id === 'agent') && <h1 id="settings-agent" data-settings-page="agent" className="settings-page-title">{tr('Trợ lý AI')}</h1>}
      {shows('profiles') && <section className="settings-section" aria-labelledby="settings-profiles-title">
        <h2 id="settings-profiles-title">{tr('Hồ sơ trợ lý')}</h2>
        <p className="muted">{tr('Ba hồ sơ dựng sẵn là Hỏi, Kế hoạch và Sửa. Hồ sơ tự tạo chọn một chế độ nền rồi tắt bớt tool (ví dụ Sửa nhưng không chạy lệnh); hồ sơ hiện cạnh ba chế độ ở chân khung chat. Mọi thao tác ghi vẫn phải được duyệt.')}</p>
        <ProfileEditor />
      </section>}

      {shows('notify') && <section className="settings-section" aria-labelledby="settings-notify-title">
        <h2 id="settings-notify-title">{tr('Khi trợ lý xong')}</h2>
        <p className="muted">{tr('Chỉ báo khi cửa sổ NexGraph không được chọn (đang ở ứng dụng khác hoặc đã thu nhỏ). Báo khi trợ lý trả lời xong, gặp lỗi hoặc chờ bạn duyệt thay đổi.')}</p>
        <div className="settings-row">
          <div><label htmlFor="settings-agent-notify">{tr('Thông báo hệ thống')}</label><p>{tr('Hiện thông báo của hệ điều hành; bấm vào để quay lại NexGraph.')}</p></div>
          <button id="settings-agent-notify" type="button" role="switch" aria-checked={notifyPrefs.notify} className={`switch${notifyPrefs.notify ? ' on' : ''}`} onClick={() => setNotifyPrefs({ notify: !notifyPrefs.notify })}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-agent-sound">{tr('Âm thanh')}</label><p>{tr('Phát một tiếng chuông ngắn, riêng cho xong, lỗi và chờ duyệt.')}</p></div>
          <button id="settings-agent-sound" type="button" role="switch" aria-checked={notifyPrefs.sound} className={`switch${notifyPrefs.sound ? ' on' : ''}`} onClick={() => setNotifyPrefs({ sound: !notifyPrefs.sound })}><span /></button>
        </div>
      </section>}

      {pages.some((p) => p.id === 'extensions') && <h1 id="settings-extensions" data-settings-page="extensions" className="settings-page-title">Extension</h1>}
      {shows('extensions') && <section className="settings-section" aria-labelledby="settings-extensions-title">
        <h2 id="settings-extensions-title">{tr('Extension đã cài')}</h2>
        <p className="muted">{tr('Extension là một thư mục có')} <code>extension.json</code>{tr(', đóng góp theme (bảng màu) và lệnh (chèn văn bản hoặc chạy chuỗi lệnh có sẵn) cho bảng lệnh ⌘⇧P. Extension không chạy mã trong app. Mẫu ở')} <code>nexgraph/examples/extension-sample</code>.</p>
        <ExtensionList />
      </section>}

      {pages.some((p) => p.id === 'ai') && <h1 id="settings-ai" data-settings-page="ai" className="settings-page-title">{vi.accounts.title}</h1>}
      {shows('quick') && <section className="settings-section" aria-labelledby="settings-quick-title">
        <h2 id="settings-quick-title">{tr('Kết nối nhanh')}</h2>
        <div className="settings-row">
          <div><span className="settings-label">{tr('Kết nối')}</span><p>{tr('Chọn nhà cung cấp và đăng nhập trong một hộp thoại, hoặc dùng model chạy trên máy qua Ollama.')}</p></div>
          <div className="row">
            <button type="button" className="primary" disabled={busy} onClick={() => setConnecting('oauth')}>{tr('Kết nối nhanh')}</button>
            <button type="button" disabled={busy} onClick={() => setConnecting('local')}>{tr('Kết nối Ollama local')}</button>
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
        {keyTarget?.description && <p className="muted small">{tr(keyTarget.description)}</p>}
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
          <label htmlFor="custom-context">{vi.accounts.customContext}</label>
          <input id="custom-context" type="text" inputMode="numeric" autoComplete="off" aria-invalid={contextInvalid}
            aria-describedby="custom-context-hint" value={custom.contextWindow}
            onChange={(e) => setCustom({ ...custom, contextWindow: e.target.value })} placeholder="128000" />
          <p id="custom-context-hint" className="muted small">{vi.accounts.customContextHint}</p>
          {contextInvalid && <p role="alert" className="muted small">{vi.accounts.customContextInvalid}</p>}
          <label htmlFor="custom-key">{vi.accounts.customApiKey}</label>
          <input id="custom-key" type="password" autoComplete="off" value={custom.apiKey} onChange={(e) => setCustom({ ...custom, apiKey: e.target.value })} />
          <div className="row">
            <button type="button" className="primary" onClick={saveCustom}
              disabled={busy || contextInvalid || !custom.id.trim() || !custom.label.trim() || !custom.baseUrl.trim() || !custom.model.trim()}>{vi.accounts.saveCustom}</button>
          </div>
        </div>
      </section>}

      {shows('oauth') && <section className="settings-section">
        <h2>{vi.accounts.oauthTitle}</h2>
        <p className="muted">{tr('Đăng nhập ChatGPT và các tài khoản được nhà cung cấp hỗ trợ. Quyền dùng model và hạn mức tùy tài khoản. Claude trong NexGraph dùng Anthropic API key.')}</p>
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
            }, tr('Đã bỏ đăng ký ChatGPT đã lưu. Lần đăng nhập tiếp theo có thể chọn tài khoản hoặc workspace khác.'))}>{tr('Dùng tài khoản hoặc workspace khác')}</button>}
          </div>
        ))}
      </section>}

      {pages.some((p) => p.id === 'model') && <h1 id="settings-model" data-settings-page="model" className="settings-page-title">{tr('Mô hình')}</h1>}
      {shows('model') && <section className="settings-section">
        <h2>{vi.accounts.modelTitle}</h2>
        <label className="field">{vi.accounts.modelTitle}
          <select disabled={busy} value={settings?.provider && selected ? `${settings.provider}/${selected}` : ''} onChange={(e) => {
            const m = models.find((x) => `${x.provider}/${x.id}` === e.target.value)
            if (m) void run(() => window.nexgraph.auth.selectModel(m.provider, m.id))
          }}>
            <option value="">{vi.accounts.modelPlaceholder}</option>
            {models.filter((m) => settings?.runtime === 'antigravity-cli' ? m.runtime === 'antigravity-cli' || m.provider === 'google-antigravity' : m.runtime !== 'antigravity-cli' && m.provider !== 'google-antigravity').map((m) => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.id === 'auto' ? tr('Tự động') : m.label} ({m.provider === 'google-antigravity' ? tr('Tài khoản Google') : m.provider})</option>)}
          </select>
        </label>
        {selectedModel && <p className="muted small">
          {tr('Context {context} token · Đầu ra {output} token', { context: selectedModel.contextWindow != null ? formatNumber(selectedModel.contextWindow) : tr('chưa xác định'), output: selectedModel.maxTokens != null ? formatNumber(selectedModel.maxTokens) : tr('chưa xác định') })}
          {' · '}{selectedModel.pricing === 'local' ? tr('Chạy trên máy') : selectedModel.pricing === 'subscription' ? tr('Theo hạn mức tài khoản')
            : selectedModel.pricing === 'free' ? tr('Miễn phí, có quota') : selectedModel.cost?.input != null && selectedModel.cost?.output != null
              ? tr('USD / 1M token vào {input}, ra {output}', { input: selectedModel.cost.input, output: selectedModel.cost.output }) : tr('Chi phí chưa xác định')}
        </p>}

        <div className="row">
          <button type="button" disabled={busy} onClick={() => void test()}>{testing ? tr('Đang kiểm tra…') : vi.accounts.test}</button>
          {testResult && <span role="status">{testResult}</span>}
        </div>
      </section>}

      {pages.some((p) => p.id === 'privacy') && <h1 id="settings-privacy" data-settings-page="privacy" className="settings-page-title">{vi.settings.privacyTitle}</h1>}
      {shows('privacy') && <section className="settings-section">
        <h2>{tr('Dữ liệu')}</h2>
        <p>{vi.settings.privacy1}</p>
        <p>{vi.settings.privacy2}</p>
      </section>}
      </div>
      {connecting && <ConnectionDialog initialMethod={connecting} onClose={() => setConnecting(null)}
        onConnected={() => { setConnecting(null); void load() }} />}
    </main>
  )
}
