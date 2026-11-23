// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { NexGraphApi } from '@shared/api'
import type { AgentSessionInfo, AgentSessionSnapshot } from '@shared/agent-types'
import { emptyAgentSnapshot, installNexgraph } from '../../test-utils'
import { setNotifyPrefs } from '../../state/agentNotify'
import { setLocale, useLocale } from '../../state/locale'
import { AgentPanel } from './AgentPanel'

vi.mock('../editor/monaco', () => ({ languageFor: () => 'typescript', createDiffEditor: () => ({ dispose: vi.fn() }) }))

const target = { provider: 'openai', baseUrl: 'https://api.example.com/v1' }
const pid = 'alerts-test'
const props = { projectId: pid, onOpenCode: vi.fn(), onHighlight: vi.fn(), onOpenSettings: vi.fn() }
const ai = { getSettings: vi.fn(async () => ({ ...target, model: 'm', hasKey: true })), hasConsent: vi.fn(async () => true) }
const session: AgentSessionInfo = { id: 's1', title: 'Sửa lỗi đăng nhập', createdAt: 1, updatedAt: 1, provider: 'openai', baseUrl: target.baseUrl, model: 'm', messageCount: 0 }
const snapshot = (over: Partial<AgentSessionSnapshot> = {}): AgentSessionSnapshot => ({ ...emptyAgentSnapshot(), session, ...over })
const box = async () => { const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Tin nhắn cho trợ lý AI' }); await waitFor(() => expect(input).toBeEnabled()); return input }
const notify = vi.fn(async (_title: string, _body: string) => {})

/** Dựng app với một lượt đang chạy. `endTurn` giải phóng lời gọi prompt như main làm khi lượt kết thúc. */
async function runningTurn(agent: Partial<NexGraphApi['agent']> = {}) {
  const resolvers: (() => void)[] = []
  const prompt = vi.fn(() => new Promise<void>((resolve) => { resolvers.push(resolve) }))
  const { emitAgent } = installNexgraph({ ai, agent: { prompt, snapshot: vi.fn(async () => snapshot()), listSessions: vi.fn(async () => [session]), notify, ...agent } })
  render(<AgentPanel {...props} />)
  await userEvent.type(await box(), 'hỏi gì đó{Enter}')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument())
  return { emitAgent, endTurn: () => act(async () => { resolvers.shift()?.() }) }
}

beforeEach(() => {
  notify.mockClear()
  setNotifyPrefs({ notify: true, sound: false })
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
})
afterEach(() => { vi.restoreAllMocks(); setLocale('vi') })

describe('thông báo khi lượt kết thúc', () => {
  it('xong lúc cửa sổ không focus: thông báo kèm tên hội thoại', async () => {
    const { emitAgent } = await runningTurn()
    act(() => emitAgent(pid, { type: 'done', text: 'xong', citations: [] }))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Sửa lỗi đăng nhập', 'Trợ lý đã trả lời xong')
  })

  it('đang xem cửa sổ thì không thông báo', async () => {
    vi.mocked(document.hasFocus).mockReturnValue(true)
    const { emitAgent } = await runningTurn()
    act(() => emitAgent(pid, { type: 'done', text: 'xong', citations: [] }))
    expect(await screen.findByText('xong')).toBeInTheDocument()
    expect(notify).not.toHaveBeenCalled()
  })

  it('tắt thông báo trong cài đặt thì không gửi', async () => {
    setNotifyPrefs({ notify: false })
    const { emitAgent } = await runningTurn()
    act(() => emitAgent(pid, { type: 'done', text: 'xong', citations: [] }))
    expect(await screen.findByText('xong')).toBeInTheDocument()
    expect(notify).not.toHaveBeenCalled()
  })

  it('lượt lỗi thì báo lỗi; lượt bị dừng (do người dùng hoặc báo ai_cancelled) thì không báo', async () => {
    const { emitAgent, endTurn } = await runningTurn()
    act(() => emitAgent(pid, { type: 'error', code: 'ai_cancelled', message: 'Đã dừng' }))
    await endTurn()
    expect(notify).not.toHaveBeenCalled()

    await userEvent.clear(await box()) // lượt lỗi trả câu hỏi về ô soạn
    await userEvent.type(await box(), 'lượt hai{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Dừng' }))
    act(() => emitAgent(pid, { type: 'error', code: 'ai_cancelled', message: 'Đã dừng' }))
    expect(notify).not.toHaveBeenCalled()

    await userEvent.type(await box(), 'lượt ba{Enter}')
    await screen.findByRole('button', { name: 'Dừng' })
    act(() => emitAgent(pid, { type: 'error', code: 'ai_rate_limited', message: 'Hết hạn mức' }))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Sửa lỗi đăng nhập', 'Trợ lý gặp lỗi')
  })

  it('chờ duyệt thay đổi ở chế độ Sửa thì báo cần người dùng', async () => {
    const { emitAgent } = await runningTurn({ getMode: vi.fn(async () => 'edit' as const) })
    act(() => emitAgent(pid, { type: 'approval', request: { id: 'r1', tool: 'edit', path: 'a.ts', before: 'a', after: 'b' } }))
    expect(await screen.findByRole('group', { name: /a\.ts/ })).toBeInTheDocument()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Sửa lỗi đăng nhập', 'Trợ lý đang chờ bạn duyệt thay đổi')
  })
})

describe('lỗi provider trong chat', () => {
  /** Ô soạn tin: nhãn đổi theo ngôn ngữ nên tìm theo role, không theo tên. */
  const anyBox = async () => { const input = screen.getByRole<HTMLTextAreaElement>('textbox'); await waitFor(() => expect(input).toBeEnabled()); return input }
  /** Dựng một lượt đang chạy với ô soạn tìm theo role (dùng được ở cả VI và EN). */
  async function startTurn() {
    const resolvers: (() => void)[] = []
    const prompt = vi.fn(() => new Promise<void>((resolve) => { resolvers.push(resolve) }))
    const { emitAgent } = installNexgraph({ ai, agent: { prompt, snapshot: vi.fn(async () => snapshot()), listSessions: vi.fn(async () => [session]), notify } })
    render(<AgentPanel {...props} />)
    await userEvent.type(await anyBox(), 'hỏi gì đó{Enter}')
    await waitFor(() => expect(screen.getByRole('button', { name: /Dừng|Stop/ })).toBeInTheDocument())
    return { emitAgent }
  }

  it('hiện câu theo mã lỗi kèm thông điệp ngắn của provider, không phải "không kết nối được"', async () => {
    const { emitAgent } = await startTurn()
    act(() => emitAgent(pid, { type: 'error', code: 'ai_model_not_found', message: 'Không tìm thấy mô hình ở nhà cung cấp', detail: 'The model `x` does not exist' }))
    expect(await screen.findByText(/Không tìm thấy mô hình ở nhà cung cấp.*The model `x` does not exist/)).toBeInTheDocument()
    expect(screen.queryByText(/Không kết nối được tới nhà cung cấp AI/)).not.toBeInTheDocument()
  })

  it('EN: cùng mã lỗi ra một câu tiếng Anh kèm chi tiết', async () => {
    setLocale('en')
    const { emitAgent } = await startTurn()
    act(() => emitAgent(pid, { type: 'error', code: 'ai_model_not_found', message: 'Không tìm thấy mô hình ở nhà cung cấp', detail: 'The model `x` does not exist' }))
    expect(await screen.findByText(/The provider does not have this model.*The model `x` does not exist/)).toBeInTheDocument()
  })

  it('ngữ cảnh vượt cửa sổ: câu hướng dẫn tăng context window', async () => {
    const { emitAgent } = await startTurn()
    act(() => emitAgent(pid, { type: 'error', code: 'ai_context_window', message: 'Ngữ cảnh vượt giới hạn mô hình — tăng context window hoặc rút gọn câu hỏi' }))
    expect((await screen.findAllByText(/Ngữ cảnh vượt giới hạn mô hình/)).length).toBeGreaterThan(0)
  })

  it('MIN-46 M3: model có cửa sổ nhỏ hiện đúng số token của main, không dùng câu "tăng context window"', async () => {
    const { emitAgent } = await startTurn()
    const message = 'Mô hình chỉ có 6000 token ngữ cảnh, không đủ cho system prompt + công cụ — chọn mô hình lớn hơn.'
    act(() => emitAgent(pid, { type: 'error', code: 'ai_context_small', message }))
    expect((await screen.findAllByText(/Mô hình chỉ có 6000 token ngữ cảnh/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/tăng context window/)).not.toBeInTheDocument()
  })

  it('MIN-46 M3 EN: câu ngữ cảnh nhỏ dịch theo mẫu, giữ số token', async () => {
    setLocale('en')
    const { emitAgent } = await startTurn()
    act(() => emitAgent(pid, { type: 'error', code: 'ai_context_small', message: 'Mô hình chỉ có 6000 token ngữ cảnh, không đủ cho system prompt + công cụ — chọn mô hình lớn hơn.' }))
    expect((await screen.findAllByText(/The model has only 6000 context tokens/)).length).toBeGreaterThan(0)
  })

  it('MIN-46 M1/M6 EN: mã conflict không có trong chat.errors vẫn dịch qua errorText', async () => {
    setLocale('en')
    const { emitAgent } = await startTurn()
    act(() => emitAgent(pid, { type: 'error', code: 'conflict', message: 'Tệp đang có bản nháp chưa lưu trong trình soạn thảo. Lưu hoặc đóng bản nháp trước khi trợ lý sửa.' }))
    expect((await screen.findAllByText(/The file has an unsaved draft in the editor\. Save or close the draft before the assistant edits it\./)).length).toBeGreaterThan(0)
    expect(screen.queryByText(/bản nháp chưa lưu/)).not.toBeInTheDocument()
  })
})

describe('vòng context', () => {
  const ring = () => screen.queryByRole('img', { name: /Ngữ cảnh đã dùng/ })

  it('hiện % của phiên khi backend có số, đổi theo sự kiện và ẩn khi số không còn tin cậy', async () => {
    const { emitAgent } = installNexgraph({ ai, agent: { snapshot: vi.fn(async () => snapshot({ context: { tokens: 150_000, window: 200_000 } })), listSessions: vi.fn(async () => [session]), notify } })
    render(<AgentPanel {...props} />)
    await box()
    expect(await screen.findByRole('img', { name: 'Ngữ cảnh đã dùng: 150.000 / 200.000 token (75%)' })).toHaveAttribute('data-level', 'warning')
    act(() => emitAgent(pid, { type: 'context', context: { tokens: 190_000, window: 200_000 } }))
    expect(ring()).toHaveAttribute('data-level', 'danger')
    expect(ring()).toHaveAttribute('title', '190.000 / 200.000 token (95%)')
    act(() => emitAgent(pid, { type: 'context', context: null })) // vừa tóm tắt: chưa có số mới
    expect(ring()).toBeNull()
  })

  it('backend không báo số thì không có vòng (không hiện 0% giả)', async () => {
    installNexgraph({ ai, agent: { snapshot: vi.fn(async () => snapshot()), listSessions: vi.fn(async () => [session]), notify } })
    render(<AgentPanel {...props} />)
    await box()
    expect(ring()).toBeNull()
  })
})

describe('tin nhắn đã lưu', () => {
  const dialog = () => screen.getByRole('dialog', { name: 'Tin nhắn đã lưu' })

  it('lưu nội dung ô soạn, chèn lại vào chỗ con trỏ, rồi xóa', async () => {
    installNexgraph({ ai, agent: { snapshot: vi.fn(async () => snapshot()), listSessions: vi.fn(async () => [session]), notify } })
    render(<AgentPanel {...props} />)
    const input = await box()
    await userEvent.type(input, 'Viết test cho hàm vừa sửa')
    await userEvent.click(screen.getByRole('button', { name: 'Tin nhắn đã lưu' }))
    expect(within(dialog()).getByText('Chưa có tin nhắn đã lưu.')).toBeInTheDocument()
    expect(within(dialog()).getByRole('textbox', { name: 'Tên tin nhắn' })).toHaveValue('Viết test cho hàm vừa sửa')
    await userEvent.clear(within(dialog()).getByRole('textbox', { name: 'Tên tin nhắn' }))
    await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Tên tin nhắn' }), 'Viết test{Enter}')
    expect(within(dialog()).getByTitle('Viết test cho hàm vừa sửa')).toHaveTextContent('Viết test')

    // Chèn vào giữa chữ đang soạn: bấm ← bốn lần để con trỏ đứng sau "Hãy ".
    await userEvent.clear(input)
    await userEvent.type(input, 'Hãy  nhé')
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}')
    await userEvent.click(screen.getByRole('button', { name: 'Tin nhắn đã lưu' }))
    await userEvent.click(within(dialog()).getByTitle('Viết test cho hàm vừa sửa'))
    expect(input).toHaveValue('Hãy Viết test cho hàm vừa sửa nhé')
    expect(screen.queryByRole('dialog', { name: 'Tin nhắn đã lưu' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Tin nhắn đã lưu' }))
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Xóa tin đã lưu Viết test' }))
    expect(within(dialog()).getByText('Chưa có tin nhắn đã lưu.')).toBeInTheDocument()
  })

  it('lệnh /saved mở hộp tin đã lưu; ô soạn trống thì chỉ gợi ý cách lưu', async () => {
    installNexgraph({ ai, agent: { snapshot: vi.fn(async () => snapshot()), listSessions: vi.fn(async () => [session]), notify } })
    render(<AgentPanel {...props} />)
    await userEvent.type(await box(), '/saved{Enter}')
    expect(within(dialog()).getByText(/Soạn tin trong ô chat/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Tin nhắn đã lưu' })).toBeNull()
  })

  it('mở được khi chưa chọn model: lưu tin không phụ thuộc vào kết nối AI', async () => {
    installNexgraph({
      ai: { getSettings: vi.fn(async () => ({ ...target, model: '', hasKey: false })), hasConsent: vi.fn(async () => true) },
      agent: { snapshot: vi.fn(async () => snapshot()), listSessions: vi.fn(async () => [session]), notify }
    })
    render(<AgentPanel {...props} />)
    const saved = await screen.findByRole('button', { name: 'Tin nhắn đã lưu' })
    expect(saved).toBeEnabled()
    await userEvent.click(saved)
    expect(dialog()).toBeInTheDocument()
  })
})

/** Cha theo dõi locale như App thật: đổi ngôn ngữ thì panel vẽ lại (element mới mỗi lần). */
function LocaleHost({ render: draw }: { render: () => ReactNode }) {
  useLocale()
  return <>{draw()}</>
}

describe('I1: chuỗi lỗi giữ khoá, dịch lúc render', () => {
  it('alert "chưa cấu hình trợ lý AI" đổi theo ngôn ngữ sau khi đã hiện', async () => {
    installNexgraph({
      ai: { getSettings: vi.fn(async () => ({ ...target, model: '', hasKey: false })), hasConsent: vi.fn(async () => true) },
      agent: { snapshot: vi.fn(async () => snapshot()), listSessions: vi.fn(async () => [session]), notify }
    })
    render(<LocaleHost render={() => <AgentPanel {...props} />} />)
    const input = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Tin nhắn cho trợ lý AI' })
    await userEvent.type(input, 'hello{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa cấu hình trợ lý AI. Mọi tính năng khác vẫn dùng được.')
    act(() => setLocale('en'))
    expect(screen.getByRole('alert')).toHaveTextContent('The AI assistant is not configured. All other features still work.')
    act(() => setLocale('vi'))
    expect(screen.getByRole('alert')).toHaveTextContent('Chưa cấu hình trợ lý AI. Mọi tính năng khác vẫn dùng được.')
  })
})
