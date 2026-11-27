// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentContextItem, AgentSessionSnapshot } from '@nexgraph/contracts/agent-types'
import { emptyAgentSnapshot, installNexgraph } from '../../test-utils'
import { AgentPanel } from './AgentPanel'

vi.mock('../editor/monaco', () => ({
  languageFor: () => 'typescript',
  createDiffEditor: () => ({ dispose: vi.fn() })
}))

const target = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', accountId: 'account-a' }
const settings = { ...target, model: 'm', hasKey: true }
const info = (id: string) => ({ id, title: `Phiên ${id}`, createdAt: 1, updatedAt: 2, provider: 'openai', baseUrl: target.baseUrl, model: 'm', messageCount: 1 })
const snapshot = (id: string, text: string, mode: AgentSessionSnapshot['mode'] = 'ask'): AgentSessionSnapshot => ({
  ...emptyAgentSnapshot(), session: info(id), mode,
  messages: text ? [{ id: `msg-${id}`, role: 'assistant', text, timestamp: 1, citations: [], tools: [] }] : []
})
const props = () => ({ projectId: 'p1', onOpenCode: vi.fn(), onHighlight: vi.fn(), onOpenSettings: vi.fn() })
const configured = () => ({ getSettings: vi.fn(async () => settings), hasConsent: vi.fn(async () => true) })
const pending = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const input = async () => {
  const box = screen.getByRole('textbox', { name: 'Tin nhắn cho trợ lý AI' })
  await waitFor(() => expect(box).toBeEnabled())
  return box
}
const ask = async (text: string) => userEvent.type(await input(), `${text}{Enter}`)

describe('AgentPanel workbench', () => {
  it('khôi phục hội thoại, tạo phiên mới và chuyển phiên đồng bộ chế độ', async () => {
    const { api } = installNexgraph({ ai: configured(), agent: {
      snapshot: vi.fn(async () => snapshot('one', 'Hội thoại đã lưu')),
      listSessions: vi.fn(async () => [info('one'), info('two')]),
      newSession: vi.fn(async () => ({ ...emptyAgentSnapshot(), session: info('new') })),
      switchSession: vi.fn(async () => snapshot('two', 'Nội dung phiên hai', 'edit'))
    } })
    render(<AgentPanel {...props()} />)
    expect(await screen.findByText('Hội thoại đã lưu')).toBeInTheDocument()
    const create = screen.getByRole('button', { name: 'Phiên mới' })
    await waitFor(() => expect(create).toBeEnabled())
    await userEvent.click(create)
    await waitFor(() => expect(screen.queryByText('Hội thoại đã lưu')).not.toBeInTheDocument())
    expect(api.agent.newSession).toHaveBeenCalledWith('p1')
    await userEvent.click(screen.getByRole('button', { name: 'Lịch sử' }))
    const session = await screen.findByRole('button', { name: /^Phiên two/ })
    await userEvent.click(session)
    expect(await screen.findByText('Nội dung phiên hai')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sửa' })).toHaveAttribute('aria-pressed', 'true')
    expect(api.agent.switchSession).toHaveBeenCalledWith('p1', 'two')
  })

  it('đợi snapshot đầu, bỏ qua snapshot nền cũ khi đã gửi câu hỏi mới', async () => {
    const initial = pending<AgentSessionSnapshot>()
    const stale = pending<AgentSessionSnapshot>()
    const { api, emitAgent } = installNexgraph({ ai: configured(), agent: {
      snapshot: vi.fn(() => stale.promise).mockImplementationOnce(() => initial.promise),
      prompt: vi.fn(() => new Promise<void>(() => {}))
    } })
    render(<AgentPanel {...props()} />)
    expect(screen.getByRole('textbox', { name: 'Tin nhắn cho trợ lý AI' })).toBeDisabled()
    expect(api.agent.prompt).not.toHaveBeenCalled()
    await act(async () => initial.resolve(snapshot('current', 'Hội thoại hiện tại')))
    await input()
    act(() => emitAgent('p1', { type: 'done', text: 'Finished', citations: [] }))
    await waitFor(() => expect(api.agent.snapshot).toHaveBeenCalledTimes(2))
    await ask('Câu hỏi mới')
    await waitFor(() => expect(api.agent.prompt).toHaveBeenCalled())
    act(() => emitAgent('p1', { type: 'session', sessionId: 'current' }))
    act(() => emitAgent('p1', { type: 'text', delta: 'Đang trả lời câu mới' }))
    await act(async () => stale.resolve(snapshot('old', 'Câu trả lời cũ')))
    expect(screen.queryByText('Câu trả lời cũ')).not.toBeInTheDocument()
    expect(screen.getByText('Câu hỏi mới')).toBeInTheDocument()
    expect(screen.getByText('Đang trả lời câu mới')).toBeInTheDocument()
  })

  it('gõ /login khi chưa cấu hình mở onboarding và không gọi model', async () => {
    const { api } = installNexgraph()
    render(<AgentPanel {...props()} />)
    await ask('/login')
    expect(await screen.findByRole('dialog', { name: 'Kết nối trợ lý AI' })).toBeInTheDocument()
    expect(api.agent.prompt).not.toHaveBeenCalled()
  })

  it('đính kèm giữ nguyên bản nháp và vùng chọn tại thời điểm bấm', async () => {
    const context: Extract<AgentContextItem, { kind: 'file' }> = {
      kind: 'file', file: 'src/a.ts', start: 2, end: 4, text: 'const draft = 1', dirty: true, version: 'v1'
    }
    const { api } = installNexgraph({ ai: configured(), agent: { prompt: vi.fn(() => new Promise<void>(() => {})) } })
    render(<AgentPanel {...props()} activeFile={{ file: 'src/a.ts', line: 2, lineEnd: 4 }} getEditorContext={() => context} />)
    const attach = screen.getByRole('button', { name: 'Thêm tệp đang mở' })
    await waitFor(() => expect(attach).toBeEnabled())
    await userEvent.click(attach)
    context.text = 'later draft'
    context.start = 20
    context.end = 40
    await ask('Giải thích vùng chọn')
    expect(api.agent.prompt).toHaveBeenCalledWith('p1', 'Giải thích vùng chọn', target, { context: [{
      kind: 'file', file: 'src/a.ts', start: 2, end: 4, text: 'const draft = 1', dirty: true, version: 'v1'
    }] })
  })

  it('đổi accountId cùng provider và endpoint không cấp consent cũ', async () => {
    let accountId = 'account-a'
    const { api } = installNexgraph({ ai: {
      getSettings: vi.fn(async () => ({ ...settings, accountId })), hasConsent: vi.fn(async () => false)
    } })
    render(<AgentPanel {...props()} />)
    await ask('Câu hỏi nhạy cảm')
    await screen.findByRole('dialog')
    accountId = 'account-b'
    await userEvent.click(screen.getByRole('button', { name: 'Đồng ý và gửi' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nhà cung cấp hoặc model AI đã thay đổi')
    expect(api.ai.grantConsent).not.toHaveBeenCalled()
    expect(api.agent.prompt).not.toHaveBeenCalled()
    expect(await input()).toHaveValue('Câu hỏi nhạy cảm')
  })

  it('duyệt lệnh hiện executable, arguments và cwd đầy đủ', async () => {
    const { api, emitAgent } = installNexgraph({ ai: configured(), agent: {
      getMode: vi.fn(async () => 'edit' as const),
      snapshot: vi.fn(async () => ({ ...emptyAgentSnapshot(), mode: 'edit' as const })),
      prompt: vi.fn(() => new Promise<void>(() => {}))
    } })
    render(<AgentPanel {...props()} />)
    await ask('Chạy kiểm thử')
    act(() => emitAgent('p1', { type: 'approval', request: {
      id: 'command', tool: 'command', executable: 'pnpm', args: ['test', '--run'], cwd: '/Đồ án/demo', timeoutMs: 120000
    } }))
    const card = await screen.findByRole('group', { name: 'Chạy lệnh trong dự án' })
    expect(within(card).getByText('/Đồ án/demo')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Cho phép chạy' }))
    expect(api.agent.approve).toHaveBeenCalledWith('p1', 'command', true)
  })

  it('duyệt web của Nex hiện ở chế độ Hỏi; yêu cầu web thiếu URL bị bỏ qua', async () => {
    const { api, emitAgent } = installNexgraph({ ai: configured(), agent: {
      prompt: vi.fn(() => new Promise<void>(() => {}))
    } })
    render(<AgentPanel {...props()} />)
    await ask('Thư viện này đổi API ở bản mới không?')
    act(() => emitAgent('p1', { type: 'approval', request: { id: 'web-empty', tool: 'webfetch', target: '  ' } }))
    act(() => emitAgent('p1', { type: 'approval', request: { id: 'web', tool: 'websearch', target: 'vitest 4 breaking changes' } }))
    const card = await screen.findByRole('group', { name: 'Tìm trên web' })
    expect(within(card).getByText('vitest 4 breaking changes')).toBeInTheDocument()
    expect(screen.queryAllByRole('group', { name: /trang web|trên web/ })).toHaveLength(1)
    await userEvent.click(within(card).getByRole('button', { name: 'Cho phép' }))
    expect(api.agent.approve).toHaveBeenCalledWith('p1', 'web', true)
  })

  it('Dừng trong lúc đồng bộ editor không khởi động prompt sau đó', async () => {
    const flush = pending<void>()
    const { api } = installNexgraph({ ai: configured() })
    render(<AgentPanel {...props()} beforePrompt={() => flush.promise} />)
    await ask('Kiểm tra mã')
    await userEvent.click(await screen.findByRole('button', { name: 'Dừng' }))
    await act(async () => flush.resolve())
    expect(api.agent.abort).toHaveBeenCalledWith('p1')
    expect(api.agent.prompt).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Tin nhắn cho trợ lý AI' })).toBeEnabled())
  })
})
