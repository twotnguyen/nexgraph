// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyGeminiStatus, installNexgraph } from '../test-utils'
import type { NexGraphApi } from '@shared/api'
import type { ModelInfo } from '@shared/agent-types'
import { SettingsScreen } from './SettingsScreen'
import { isStatusItemHidden, setStatusItemHidden } from '../state/layoutPrefs'
import { STATUS_BAR_ITEMS } from '../state/statusBarRegistry'
import { setLocale } from '../state/locale'

const provider = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, label: id, hasKey: false, oauth: false, loggedIn: false, custom: false, ...over })

const RESTORE_FAILED = 'Đã đăng xuất nhưng chưa nạp lại được API key đã lưu. Key vẫn còn trong kho khoá; mở lại ứng dụng để dùng key.'
const REVOKE_FAILED = 'Đã đăng xuất trên máy. Chưa xác nhận được thu hồi phiên từ xa. Bạn có thể ngắt NexGraph trong ChatGPT Settings.'

afterEach(() => setLocale('vi'))

describe('SettingsScreen', () => {
  it('switch bật lại các mục thanh trạng thái đã ẩn bằng chuột phải', async () => {
    installNexgraph()
    const ids = ['diagnostics', 'diagnosticsDetail', 'git', 'cursor', 'selection', 'language', 'eol', 'encoding', 'indentation', 'notifications', 'vim']
    act(() => { ids.forEach((id) => setStatusItemHidden(id, true)) })
    render(<SettingsScreen onBack={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Mục thanh trạng thái' })).toBeInTheDocument()
    const switches = ids.map((id) => document.getElementById(`settings-status-${id}`)!)
    expect(switches).toHaveLength(STATUS_BAR_ITEMS.length - 1)
    expect(document.getElementById('settings-status-engine')).toBeNull()
    for (const sw of switches) expect(sw).toHaveAttribute('aria-checked', 'false')
    const cursorSwitch = document.getElementById('settings-status-cursor')!
    await userEvent.click(cursorSwitch)
    expect(cursorSwitch).toHaveAttribute('aria-checked', 'true')
    expect(isStatusItemHidden('cursor')).toBe(false)
    act(() => { ids.forEach((id) => setStatusItemHidden(id, false)) })
  })

  it('ngắt Gemini không còn báo đang dùng dù vẫn giữ runtime Google và hồ sơ đăng nhập', async () => {
    const settings = { runtime: 'antigravity-cli' as const, provider: 'google-antigravity', baseUrl: '', model: 'auto', connectionId: 'account-a', hasKey: false }
    const { api } = installNexgraph({
      ai: { getSettings: vi.fn(async () => ({ ...settings })) },
      gemini: {
        status: vi.fn(async () => emptyGeminiStatus({ state: 'connected', authenticated: true, installed: true })),
        disconnect: vi.fn(async () => { settings.model = '' })
      }
    })
    render(<SettingsScreen onBack={vi.fn()} />)
    expect(await screen.findByText('Đang dùng tài khoản Google')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ngắt kết nối NexGraph' }))
    expect(await screen.findByText('Đã có kết nối Google')).toBeInTheDocument()
    expect(screen.queryByText('Đang dùng tài khoản Google')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ngắt kết nối NexGraph' })).not.toBeInTheDocument()
    expect(api.gemini.forget).not.toHaveBeenCalled()
  })

  it('ô tìm lọc mục và danh mục; vị trí khung chat lưu cho Workspace', async () => {
    installNexgraph()
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.selectOptions(await screen.findByLabelText('Vị trí'), 'right')
    expect(localStorage.getItem('nexgraph.chat.dock')).toBe('right')
    localStorage.removeItem('nexgraph.chat.dock')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Tìm cài đặt' }), 'ollama')
    expect(screen.getByRole('button', { name: 'Kết nối Ollama local' })).toBeInTheDocument()
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Tài khoản AI|Giao diện|Mô hình|Quyền riêng tư/ }).map((b) => b.textContent)).toEqual(['Tài khoản AI'])
    await userEvent.type(screen.getByRole('searchbox', { name: 'Tìm cài đặt' }), 'zzz')
    expect(screen.getByText('Không có kết quả')).toBeInTheDocument()
  })

  it('thứ tự ba mục từ trên xuống: key theo nhà cung cấp → nhà cung cấp tuỳ chỉnh → đăng nhập gói đăng ký', async () => {
    installNexgraph({ auth: { list: vi.fn(async () => [provider('anthropic', { oauth: true, hasKey: true }), provider('smoke', { custom: true })]) } })
    const { container } = render(<SettingsScreen onBack={() => {}} />)
    const headings = (await screen.findAllByRole('heading', { level: 2 })).filter((heading) => /API key|tuỳ chỉnh|gói đăng ký/.test(heading.textContent ?? ''))
    expect(headings[0]).toHaveTextContent('API key')
    expect(headings[1]).toHaveTextContent('tuỳ chỉnh')
    expect(headings[2]).toHaveTextContent('gói đăng ký')
    expect(headings[0].compareDocumentPosition(headings[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(headings[1].compareDocumentPosition(headings[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container).toBeInTheDocument()
  })

  it('giải thích tài khoản ChatGPT và Claude dùng API key trong NexGraph', async () => {
    installNexgraph({ auth: { list: vi.fn(async () => [provider('openai-codex', { oauth: true })]) } })
    render(<SettingsScreen onBack={() => {}} />)
    expect(await screen.findByText(/Claude trong NexGraph dùng Anthropic API key/)).toBeInTheDocument()
  })

  it('giải thích kho khoá vắng và vô hiệu hoá đăng nhập OAuth', async () => {
    const issue = 'Kho khoá an toàn của hệ điều hành không khả dụng.'
    installNexgraph({ auth: { list: vi.fn(async () => [provider('openai-codex', { oauth: true, oauthStorageIssue: issue })]) } })
    render(<SettingsScreen onBack={() => {}} />)
    expect(await screen.findByRole('status')).toHaveTextContent(issue)
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeDisabled()
  })

  it('vẫn cho đăng xuất khi không đọc được điểm đến OAuth', async () => {
    const { api } = installNexgraph({
      ai: { getSettings: vi.fn(async () => { throw new Error('Không xác minh được điểm đến OAuth') }) },
      auth: { list: vi.fn(async () => [provider('openai-codex', { oauth: true, loggedIn: true })]) }
    })
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Đăng xuất' }))
    expect(api.auth.logout).toHaveBeenCalledWith('openai-codex')
  })

  it('ô khoá không bao giờ hiển thị giá trị đã lưu (placeholder thay thế)', async () => {
    installNexgraph({ auth: { list: vi.fn(async () => [provider('anthropic', { hasKey: true })]) } })
    render(<SettingsScreen onBack={() => {}} />)
    const input = await screen.findByLabelText('API key')
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('placeholder', 'Đã có key trong kho khoá')
  })

  it('lưu key gọi auth.setKey cho nhà cung cấp đang chọn; gỡ key gọi removeKey', async () => {
    const { api } = installNexgraph({ auth: { list: vi.fn(async () => [provider('anthropic'), provider('openai')]) } })
    render(<SettingsScreen onBack={() => {}} />)
    await screen.findByLabelText('API key')
    const select = screen.getByRole('combobox', { name: 'Nhà cung cấp' })
    await userEvent.selectOptions(select, 'openai')
    await userEvent.type(screen.getByLabelText('API key'), 'sk-1')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu key' }))
    expect(api.auth.setKey).toHaveBeenCalledWith('openai', 'sk-1')
  })

  it('lưu nhà cung cấp tuỳ chỉnh gọi saveCustom và tự chọn model', async () => {
    const { api } = installNexgraph()
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.type(await screen.findByLabelText('ID'), 'smoke')
    await userEvent.type(screen.getByLabelText('Tên hiển thị'), 'Smoke local')
    await userEvent.type(screen.getByLabelText('Base URL'), 'http://127.0.0.1:9/v1')
    await userEvent.type(screen.getByLabelText('Tên model'), 'fake')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu nhà cung cấp' }))
    expect(api.auth.saveCustom).toHaveBeenCalledWith({ id: 'smoke', label: 'Smoke local', baseUrl: 'http://127.0.0.1:9/v1', model: 'fake' }, undefined)
    expect(api.auth.selectModel).toHaveBeenCalledWith('smoke', 'fake')
  })

  it('ô Context window tuỳ chọn: nhập số thì gửi kèm, để trống thì không gửi', async () => {
    const { api } = installNexgraph()
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.type(await screen.findByLabelText('ID'), 'ctx')
    await userEvent.type(screen.getByLabelText('Tên hiển thị'), 'Ctx local')
    await userEvent.type(screen.getByLabelText('Base URL'), 'http://127.0.0.1:9/v1')
    await userEvent.type(screen.getByLabelText('Tên model'), 'fake')
    await userEvent.type(screen.getByLabelText('Context window (token)'), '20000')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu nhà cung cấp' }))
    expect(api.auth.saveCustom).toHaveBeenCalledWith({ id: 'ctx', label: 'Ctx local', baseUrl: 'http://127.0.0.1:9/v1', model: 'fake', contextWindow: 20000 }, undefined)
  })

  it('Context window không hợp lệ: báo lỗi, khoá nút Lưu, không gọi IPC', async () => {
    const { api } = installNexgraph()
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.type(await screen.findByLabelText('ID'), 'bad')
    await userEvent.type(screen.getByLabelText('Tên hiển thị'), 'Bad')
    await userEvent.type(screen.getByLabelText('Base URL'), 'http://127.0.0.1:9/v1')
    await userEvent.type(screen.getByLabelText('Tên model'), 'fake')
    const field = screen.getByLabelText('Context window (token)')
    await userEvent.type(field, '4096.5')
    expect(await screen.findByRole('alert')).toHaveTextContent('Context window phải là số nguyên dương')
    expect(screen.getByRole('button', { name: 'Lưu nhà cung cấp' })).toBeDisabled()
    await userEvent.clear(field)
    await userEvent.type(field, '2000')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lưu nhà cung cấp' })).toBeEnabled()
    expect(api.auth.saveCustom).not.toHaveBeenCalled()
  })

  it('bỏ nháp key khi chọn một nhà cung cấp khác', async () => {
    const { api } = installNexgraph({ auth: { list: vi.fn(async () => [provider('anthropic'), provider('openai')]) } })
    render(<SettingsScreen onBack={() => {}} />)
    await screen.findByRole('option', { name: 'openai' })
    const key = screen.getByLabelText('API key')
    await userEvent.type(key, 'sk-nhap')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nhà cung cấp' }), 'openai')
    expect(key).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Lưu key' })).toBeDisabled()
    expect(api.auth.setKey).not.toHaveBeenCalled()
  })

  it('hiện lỗi kết nối và cho kiểm tra lại khi IPC từ chối', async () => {
    const probe = vi.fn(async () => ({ ok: true, message: 'ok' }))
      .mockRejectedValueOnce(new Error('endpoint mất kết nối'))
    installNexgraph({ auth: { test: probe } })
    render(<SettingsScreen onBack={() => {}} />)
    const button = screen.getByRole('button', { name: 'Kiểm tra kết nối' })
    await userEvent.click(button)
    expect(await screen.findByRole('status')).toHaveTextContent('endpoint mất kết nối')
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('đăng nhập OAuth: sự kiện auth_url hiện hướng dẫn, Huỷ gọi loginCancel', async () => {
    const { api } = installNexgraph({ auth: {
      list: vi.fn(async () => [provider('openai-codex', { oauth: true })]),
      login: vi.fn(() => new Promise<void>(() => {}))
    } })
    const { emitAuth } = installAuthSinks(api)
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Đăng nhập' }))
    expect(api.auth.login).toHaveBeenCalledWith('openai-codex')
    act(() => emitAuth({ type: 'auth_url', url: 'https://oauth.example/authorize', instructions: 'Mở liên kết' }))
    expect(await screen.findByText('Mở liên kết')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mở lại trang xác nhận' })).toHaveAttribute('href', 'https://oauth.example/authorize')
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ đăng nhập' }))
    expect(api.auth.loginCancel).toHaveBeenCalled()
  })

  it('câu hỏi đăng nhập OAuth cho phép trả lời và huỷ bằng null', async () => {
    const { api } = installNexgraph({
      auth: { list: vi.fn(async () => [provider('openai-codex', { oauth: true })]), login: vi.fn(() => new Promise<void>(() => {})) }
    })
    const { emitPrompt } = installAuthSinks(api)
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Đăng nhập' }))
    act(() => emitPrompt({ id: 'openai-codex#1', kind: 'text', message: 'Dán mã' }))
    await userEvent.type(await screen.findByLabelText('Dán mã'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Gửi' }))
    expect(api.auth.promptReply).toHaveBeenCalledWith('openai-codex#1', 'abc')
  })

  it('câu hỏi đăng nhập do hộp Kết nối nhanh khởi động không hiện ở Cài đặt', async () => {
    const { api } = installNexgraph({ auth: { list: vi.fn(async () => [provider('openai-codex', { oauth: true })]) } })
    const { emitPrompt } = installAuthSinks(api)
    render(<SettingsScreen onBack={() => {}} />)
    await screen.findByRole('button', { name: 'Đăng nhập' })
    act(() => emitPrompt({ id: 'openai-codex#1', kind: 'text', message: 'Dán mã' }))
    expect(screen.queryByLabelText('Dán mã')).toBeNull()
  })

  it('rời màn khi OAuth còn chờ → huỷ đăng nhập, không treo prompt ở main', async () => {
    const { api } = installNexgraph({
      auth: {
        list: vi.fn(async () => [provider('openai-codex', { oauth: true })]),
        login: vi.fn(() => new Promise<void>(() => {}))
      }
    })
    const { emitPrompt } = installAuthSinks(api)
    const { unmount } = render(<SettingsScreen onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Đăng nhập' }))
    act(() => emitPrompt({ id: 'openai-codex#1', kind: 'text', message: 'Dán mã' }))
    await screen.findByLabelText('Dán mã')
    unmount()
    expect(api.auth.loginCancel).toHaveBeenCalled()
  })

  it('Đăng xuất không nạp lại được API key → hiện thông báo dù không ở luồng đăng nhập', async () => {
    const { api } = installNexgraph({ auth: { list: vi.fn(async () => [provider('openai', { oauth: true, loggedIn: true, hasKey: true })]) } })
    const { emitNotice } = installAuthSinks(api)
    render(<SettingsScreen onBack={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument()
    act(() => emitNotice({ message: RESTORE_FAILED }))
    expect(await screen.findByText(RESTORE_FAILED)).toBeInTheDocument()
  })

  it('thông báo Đăng xuất có bản English khi giao diện English', async () => {
    setLocale('en')
    const { api } = installNexgraph({ auth: { list: vi.fn(async () => [provider('openai', { oauth: true, loggedIn: true, hasKey: true })]) } })
    const { emitNotice } = installAuthSinks(api)
    render(<SettingsScreen onBack={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    act(() => emitNotice({ message: RESTORE_FAILED }))
    expect(await screen.findByText('Signed out but could not reload the saved API key. The key is still in the keychain; reopen the app to use it.')).toBeInTheDocument()
  })

  it('nhiều auth:notice cùng lúc → hiện đủ cả hai, không che nhau', async () => {
    const { api } = installNexgraph({ auth: { list: vi.fn(async () => [provider('openai', { oauth: true, loggedIn: true, hasKey: true })]) } })
    const { emitNotice } = installAuthSinks(api)
    render(<SettingsScreen onBack={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument()
    act(() => {
      emitNotice({ message: REVOKE_FAILED })
      emitNotice({ message: RESTORE_FAILED })
    })
    expect(await screen.findByText(REVOKE_FAILED)).toBeInTheDocument()
    expect(screen.getByText(RESTORE_FAILED)).toBeInTheDocument()
    expect(screen.getAllByRole('status').filter((el) => el.closest('.toast'))).toHaveLength(2)
  })

  it('main báo catalog model đổi sau khi lưu key → danh sách tự tải lại, listener huỷ khi unmount', async () => {
    let catalog = [model('go-a')]
    const { api } = installNexgraph({ auth: {
      list: vi.fn(async () => [provider('opencode-go')]),
      models: vi.fn(async () => catalog)
    } })
    const { emitModelsChanged } = installAuthSinks(api)
    const { unmount } = render(<SettingsScreen onBack={() => {}} />)
    expect(await screen.findByRole('option', { name: 'go-a (opencode-go)' })).toBeInTheDocument()
    catalog = [model('go-a'), model('go-b')]
    act(() => emitModelsChanged({ providerId: 'opencode-go' }))
    expect(await screen.findByRole('option', { name: 'go-b (opencode-go)' })).toBeInTheDocument()
    expect(api.auth.models).toHaveBeenCalledTimes(2)
    unmount()
    act(() => emitModelsChanged({ providerId: 'opencode-go' }))
    expect(api.auth.models).toHaveBeenCalledTimes(2)
  })
})

const model = (id: string, provider = 'opencode-go'): ModelInfo =>
  ({ provider, id, label: id, supportsImages: false, pricing: 'unknown', cost: { input: null, output: null } })

/** Nối các sink onEvent/onPrompt/onNotice của stub auth trong installNexgraph để bắn sự kiện từ main. */
function installAuthSinks(api: { auth: Pick<NexGraphApi['auth'], 'onEvent' | 'onPrompt' | 'onNotice' | 'onModelsChanged'> }) {
  const eventSinks = new Set<(e: unknown) => void>()
  const promptSinks = new Set<(p: unknown) => void>()
  const noticeSinks = new Set<(n: unknown) => void>()
  const modelsSinks = new Set<(e: unknown) => void>()
  const auth = api.auth
  ;(auth.onEvent as ReturnType<typeof vi.fn>).mockImplementation((cb: (e: unknown) => void) => { eventSinks.add(cb); return () => eventSinks.delete(cb) })
  ;(auth.onPrompt as ReturnType<typeof vi.fn>).mockImplementation((cb: (p: unknown) => void) => { promptSinks.add(cb); return () => promptSinks.delete(cb) })
  ;(auth.onNotice as ReturnType<typeof vi.fn>).mockImplementation((cb: (n: unknown) => void) => { noticeSinks.add(cb); return () => noticeSinks.delete(cb) })
  ;(auth.onModelsChanged as ReturnType<typeof vi.fn>).mockImplementation((cb: (e: unknown) => void) => { modelsSinks.add(cb); return () => modelsSinks.delete(cb) })
  return {
    emitAuth: (e: unknown) => eventSinks.forEach((h) => h(e)),
    emitPrompt: (p: unknown) => promptSinks.forEach((h) => h(p)),
    emitNotice: (n: unknown) => noticeSinks.forEach((h) => h(n)),
    emitModelsChanged: (e: unknown) => modelsSinks.forEach((h) => h(e))
  }
}
