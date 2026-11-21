import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react'
import type { AiSettings } from '@shared/graph-types'
import type { AuthEventView, AuthPromptView, ModelInfo, ProviderInfo } from '@shared/agent-types'
import { vi } from '../strings'
import { Icon, type IconName } from '../components/common/icons'
import { THEMES, setTheme, useThemeId, useThemesVersion } from '../state/useTheme'
import { setBlame, setEditorPrefs, setVimMode, useBlame, useEditorPrefs, useVimMode } from '../state/editorPrefs'
import { CHAT_WIDTH, TERMINAL_HEIGHT, setChatDock, setChatWidth, setExplorerOpen, setStatusBar, setTerminalHeight, useChatDock, useChatWidth, useExplorerOpen, useStatusBar, useTerminalHeight } from '../state/layoutPrefs'
import { Toast } from '../components/common/Toast'
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

const EMPTY_CUSTOM = { id: '', label: '', baseUrl: '', model: '', apiKey: '' }

// Từ khoá cho ô tìm: tiêu đề và vài chữ người dùng hay gõ của mỗi mục.
const SECTION_WORDS = {
  theme: 'Giao diện theme màu sáng tối dark light bộ icon tệp file icons',
  chat: 'Khung chat AI trợ lý vị trí trái phải dock độ rộng panels bảng',
  editor: 'Trình soạn thảo editor vim chế độ phím cỡ chữ font size tab ngắt dòng wrap định dạng lưu format auto save tự lưu terminal',
  keymap: 'Phím tắt keymap keybinding shortcut lệnh bàn phím base keymap vs code vscode jetbrains sublime nguồn',
  blame: 'Version Control Git blame inline từng dòng tác giả commit tóm tắt độ trễ',
  layout: 'Panels bảng bố cục terminal chiều cao cây tệp explorer mở sẵn thanh trạng thái status bar',
  profiles: 'Hồ sơ trợ lý profile tool công cụ chạy lệnh agent',
  notify: 'Thông báo hệ thống âm thanh chuông trợ lý xong lỗi chờ duyệt cửa sổ nền notification sound',
  extensions: 'Extension tiện ích mở rộng plugin theme lệnh cài',
  quick: 'Kết nối nhanh ollama local tài khoản AI',
  gemini: 'Gemini Google Antigravity tài khoản AI',
  apikey: 'API key nhà cung cấp OpenAI Anthropic Claude khoá',
  custom: 'Nhà cung cấp tuỳ chỉnh custom base URL OpenRouter',
  oauth: 'Đăng nhập gói đăng ký ChatGPT OAuth',
  model: 'Mô hình model kiểm tra kết nối',
  privacy: 'Quyền riêng tư dữ liệu bảo mật'
}
const PAGES: { id: string; label: string; icon: IconName; sections: (keyof typeof SECTION_WORDS)[] }[] = [
  { id: 'appearance', label: 'Giao diện', icon: 'palette', sections: ['theme', 'editor'] },
  { id: 'keymap', label: 'Phím tắt', icon: 'keyboard', sections: ['keymap'] },
  { id: 'panels', label: 'Panels', icon: 'panelLeft', sections: ['chat', 'layout'] },
  { id: 'vcs', label: 'Version Control', icon: 'branch', sections: ['blame'] },
  { id: 'agent', label: 'Trợ lý AI', icon: 'spark', sections: ['profiles', 'notify'] },
  { id: 'extensions', label: 'Extension', icon: 'plug', sections: ['extensions'] },
  { id: 'ai', label: 'Tài khoản AI', icon: 'plug', sections: ['quick', 'gemini', 'apikey', 'custom', 'oauth'] },
  { id: 'model', label: 'Mô hình', icon: 'spark', sections: ['model'] },
  { id: 'privacy', label: 'Quyền riêng tư', icon: 'shield', sections: ['privacy'] }
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
          <div><label htmlFor="settings-theme">Theme</label><p>Màu của toàn bộ app và editor. Cũng mở được bằng ⌘K rồi ⌘T hoặc từ bảng lệnh (⌘⇧P).</p></div>
          <select id="settings-theme" value={themeId} onChange={(e) => setTheme(e.target.value)}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-icon-theme">Bộ icon tệp</label><p>Icon dùng trong cây tệp, thẻ editor và tìm tệp.</p></div>
          <select id="settings-icon-theme" value={editorPrefs.iconTheme} onChange={(e) => setEditorPrefs({ iconTheme: e.target.value === 'mono' ? 'mono' : 'symbols' })}>
            <option value="symbols">Symbols (có màu)</option><option value="mono">Đơn sắc</option>
          </select>
        </div>
      </section>}
      {shows('editor') && <section className="settings-section" aria-labelledby="settings-editor-title">
        <h2 id="settings-editor-title">Trình soạn thảo</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-font-size">Cỡ chữ editor</label><p>Cỡ chữ cho nội dung tệp (8–32). ⌘= / ⌘- thu phóng tạm thời, ⌘0 đặt lại.</p></div>
          <NumberSetting id="settings-font-size" value={editorPrefs.fontSize} min={8} max={32} onChange={(fontSize) => setEditorPrefs({ fontSize })} />
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-terminal-font-size">Cỡ chữ terminal</label><p>Cỡ chữ trong terminal (8–32).</p></div>
          <NumberSetting id="settings-terminal-font-size" value={editorPrefs.terminalFontSize} min={8} max={32} onChange={(terminalFontSize) => setEditorPrefs({ terminalFontSize })} />
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-tab-size">Tab size</label><p>Số khoảng trắng mặc định; tệp mới mở có thể tự nhận diện thụt lề.</p></div>
          <select id="settings-tab-size" value={editorPrefs.tabSize} onChange={(e) => setEditorPrefs({ tabSize: Number(e.target.value) as 2 | 4 | 8 })}>
            <option value={2}>2</option><option value={4}>4</option><option value={8}>8</option>
          </select>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-wrap">Ngắt dòng</label><p>Ngắt dòng dài theo chiều rộng editor.</p></div>
          <select id="settings-wrap" value={editorPrefs.wordWrap} onChange={(e) => setEditorPrefs({ wordWrap: e.target.value === 'on' ? 'on' : 'off' })}>
            <option value="off">Tắt</option><option value="on">Theo khung</option>
          </select>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-format-save">Định dạng khi lưu</label><p>Định dạng tệp trước khi lưu nếu có formatter cho ngôn ngữ đó.</p></div>
          <button id="settings-format-save" type="button" role="switch" aria-checked={editorPrefs.formatOnSave}
            className={`switch${editorPrefs.formatOnSave ? ' on' : ''}`} onClick={() => setEditorPrefs({ formatOnSave: !editorPrefs.formatOnSave })}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-auto-save">Tự lưu</label><p>Khi nào lưu các thay đổi trong editor.</p></div>
          <select id="settings-auto-save" value={editorPrefs.autoSave} onChange={(e) => setEditorPrefs({ autoSave: e.target.value === 'afterDelay' || e.target.value === 'onFocusChange' ? e.target.value : 'off' })}>
            <option value="off">Tắt</option><option value="afterDelay">Sau khi dừng gõ</option><option value="onFocusChange">Khi rời editor</option>
          </select>
        </div>
        {editorPrefs.autoSave === 'afterDelay' && <div className="settings-row">
          <div><label htmlFor="settings-auto-save-delay">Thời gian chờ (ms)</label><p>Lưu sau khoảng thời gian không gõ.</p></div>
          <NumberSetting id="settings-auto-save-delay" value={editorPrefs.autoSaveDelay} min={1} max={2147483647} onChange={(autoSaveDelay) => setEditorPrefs({ autoSaveDelay })} />
        </div>}
        <div className="settings-row">
          <div><label htmlFor="settings-vim">Chế độ Vim</label><p>Phím kiểu Vim trong editor (normal/insert/visual); trạng thái hiện ở thanh dưới. Bật/tắt cũng được từ bảng lệnh.</p></div>
          <button id="settings-vim" type="button" role="switch" aria-checked={vimMode} className={`switch${vimMode ? ' on' : ''}`} onClick={() => setVimMode(!vimMode)}><span /></button>
        </div>
      </section>}

      {pages.some((p) => p.id === 'keymap') && <h1 id="settings-keymap" data-settings-page="keymap" className="settings-page-title">Phím tắt</h1>}
      {shows('keymap') && <section className="settings-section" aria-label="Phím tắt">
        <p className="muted">Bấm Đổi hoặc bấm đúp một dòng rồi nhấn tổ hợp mới; hợp âm hai bước như ⌘K ⌘T cũng được. Một phím chỉ thuộc một lệnh.</p>
        <KeymapEditor />
      </section>}

      {pages.some((p) => p.id === 'panels') && <h1 id="settings-panels" data-settings-page="panels" className="settings-page-title">Panels</h1>}
      {shows('chat') && <section className="settings-section" aria-labelledby="settings-chat-title">
        <h2 id="settings-chat-title">Khung chat AI</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-chat-dock">Vị trí</label><p>Bên trái dùng chung chỗ với cây tệp như Wu; bên phải đứng cạnh cây tệp. Ẩn/hiện bằng ⌘L.</p></div>
          <select id="settings-chat-dock" value={chatDock} onChange={(e) => setChatDock(e.target.value === 'right' ? 'right' : 'left')}>
            <option value="left">Bên trái (kiểu Wu)</option>
            <option value="right">Bên phải</option>
          </select>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-chat-width">Độ rộng (px)</label><p>Độ rộng khung chat ({CHAT_WIDTH.min}–{CHAT_WIDTH.max}); cũng kéo được thanh chia cạnh khung.</p></div>
          <NumberSetting id="settings-chat-width" value={chatWidth} min={CHAT_WIDTH.min} max={CHAT_WIDTH.max} onChange={setChatWidth} />
        </div>
      </section>}
      {shows('layout') && <section className="settings-section" aria-labelledby="settings-layout-title">
        <h2 id="settings-layout-title">Bố cục</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-terminal-height">Chiều cao terminal (px)</label><p>Chiều cao panel terminal ở dưới ({TERMINAL_HEIGHT.min}–{TERMINAL_HEIGHT.max}, không vượt quá cửa sổ); cũng kéo được thanh chia phía trên terminal.</p></div>
          <NumberSetting id="settings-terminal-height" value={terminalHeight} min={TERMINAL_HEIGHT.min} max={TERMINAL_HEIGHT.max} onChange={setTerminalHeight} />
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-explorer-open">Mở sẵn cây tệp</label><p>Vào dự án thì hiện sẵn cây tệp ở bên trái. Áp dụng từ lần mở dự án tiếp theo.</p></div>
          <button id="settings-explorer-open" type="button" role="switch" aria-checked={explorerOpen} className={`switch${explorerOpen ? ' on' : ''}`} onClick={() => setExplorerOpen(!explorerOpen)}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-status-bar">Hiện thanh trạng thái</label><p>Thanh dưới cùng: trạng thái engine, vị trí con trỏ, ngôn ngữ, kiểu xuống dòng. Engine lỗi thì thanh vẫn hiện để còn nút Khởi động lại.</p></div>
          <button id="settings-status-bar" type="button" role="switch" aria-checked={statusBar} className={`switch${statusBar ? ' on' : ''}`} onClick={() => setStatusBar(!statusBar)}><span /></button>
        </div>
      </section>}

      {pages.some((p) => p.id === 'vcs') && <h1 id="settings-vcs" data-settings-page="vcs" className="settings-page-title">Version Control</h1>}
      {shows('blame') && <section className="settings-section" aria-labelledby="settings-blame-title">
        <h2 id="settings-blame-title">Blame từng dòng</h2>
        <div className="settings-row">
          <div><label htmlFor="settings-blame">Hiện blame</label><p>Tác giả và thời điểm sửa dòng có con trỏ, hiện mờ ở cuối dòng khi tệp không có thay đổi chưa lưu. Bật/tắt cũng được từ bảng lệnh.</p></div>
          <button id="settings-blame" type="button" role="switch" aria-checked={blameOn} className={`switch${blameOn ? ' on' : ''}`} onClick={() => setBlame(!blameOn)}><span /></button>
        </div>
        {blameOn && <>
          <div className="settings-row">
            <div><label htmlFor="settings-blame-delay">Độ trễ (ms)</label><p>Chờ con trỏ đứng yên trên dòng bấy lâu rồi mới hiện blame (0–5000); 0 là hiện ngay.</p></div>
            <NumberSetting id="settings-blame-delay" value={editorPrefs.blameDelay} min={0} max={5000} onChange={(blameDelay) => setEditorPrefs({ blameDelay })} />
          </div>
          <div className="settings-row">
            <div><label htmlFor="settings-blame-summary">Kèm tóm tắt commit</label><p>Thêm dòng đầu thông điệp commit sau tên tác giả và thời điểm.</p></div>
            <button id="settings-blame-summary" type="button" role="switch" aria-checked={editorPrefs.blameSummary}
              className={`switch${editorPrefs.blameSummary ? ' on' : ''}`} onClick={() => setEditorPrefs({ blameSummary: !editorPrefs.blameSummary })}><span /></button>
          </div>
        </>}
      </section>}

      {pages.some((p) => p.id === 'agent') && <h1 id="settings-agent" data-settings-page="agent" className="settings-page-title">Trợ lý AI</h1>}
      {shows('profiles') && <section className="settings-section" aria-labelledby="settings-profiles-title">
        <h2 id="settings-profiles-title">Hồ sơ trợ lý</h2>
        <p className="muted">Ba hồ sơ dựng sẵn là Hỏi, Kế hoạch và Sửa. Hồ sơ tự tạo chọn một chế độ nền rồi tắt bớt tool (ví dụ Sửa nhưng không chạy lệnh); hồ sơ hiện cạnh ba chế độ ở chân khung chat. Mọi thao tác ghi vẫn phải được duyệt.</p>
        <ProfileEditor />
      </section>}

      {shows('notify') && <section className="settings-section" aria-labelledby="settings-notify-title">
        <h2 id="settings-notify-title">Khi trợ lý xong</h2>
        <p className="muted">Chỉ báo khi cửa sổ NexGraph không được chọn (đang ở ứng dụng khác hoặc đã thu nhỏ). Báo khi trợ lý trả lời xong, gặp lỗi hoặc chờ bạn duyệt thay đổi.</p>
        <div className="settings-row">
          <div><label htmlFor="settings-agent-notify">Thông báo hệ thống</label><p>Hiện thông báo của hệ điều hành; bấm vào để quay lại NexGraph.</p></div>
          <button id="settings-agent-notify" type="button" role="switch" aria-checked={notifyPrefs.notify} className={`switch${notifyPrefs.notify ? ' on' : ''}`} onClick={() => setNotifyPrefs({ notify: !notifyPrefs.notify })}><span /></button>
        </div>
        <div className="settings-row">
          <div><label htmlFor="settings-agent-sound">Âm thanh</label><p>Phát một tiếng chuông ngắn, riêng cho xong, lỗi và chờ duyệt.</p></div>
          <button id="settings-agent-sound" type="button" role="switch" aria-checked={notifyPrefs.sound} className={`switch${notifyPrefs.sound ? ' on' : ''}`} onClick={() => setNotifyPrefs({ sound: !notifyPrefs.sound })}><span /></button>
        </div>
      </section>}

      {pages.some((p) => p.id === 'extensions') && <h1 id="settings-extensions" data-settings-page="extensions" className="settings-page-title">Extension</h1>}
      {shows('extensions') && <section className="settings-section" aria-labelledby="settings-extensions-title">
        <h2 id="settings-extensions-title">Extension đã cài</h2>
        <p className="muted">Extension là một thư mục có <code>extension.json</code>, đóng góp theme (bảng màu) và lệnh (chèn văn bản hoặc chạy chuỗi lệnh có sẵn) cho bảng lệnh ⌘⇧P. Extension không chạy mã trong app. Mẫu ở <code>nexgraph/examples/extension-sample</code>.</p>
        <ExtensionList />
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
