// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ApprovalRequest } from '@shared/agent-types'
import { installNexgraph } from '../../test-utils'

// jsdom không chạy Monaco: diff editor thay bằng <textarea> chỉ đọc.
vi.mock('../editor/monaco', () => ({
  languageFor: () => 'dart',
  createEditor: () => { throw new Error('createEditor không dùng ở đây') },
  createDiffEditor: (el: HTMLElement, opts: { before: string; after: string }) => {
    const ta = document.createElement('textarea')
    ta.value = opts.after
    ta.readOnly = true
    ta.setAttribute('aria-label', 'diff')
    el.appendChild(ta)
    return { dispose: () => ta.remove() }
  }
}))

import { AgentPanel } from './AgentPanel'

const target = { provider: 'provider-one', baseUrl: 'https://api.example.com/v1' }
const configured = vi.fn(async () => ({ ...target, model: 'm1', hasKey: true }))
const consented = () => ({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true) } })
const props = () => ({ projectId: 'p1', onOpenCode: vi.fn(), onHighlight: vi.fn(), onOpenSettings: vi.fn() })
const ask = async (q: string) => userEvent.type(await screen.findByPlaceholderText(/Hỏi về dự án/), `${q}{Enter}`)
const pending = () => vi.fn(() => new Promise<void>(() => {}))
/** prompt giả phát `events` rồi kết thúc lượt. */
const replying = (emit: () => (pid: string, e: AgentEvent) => void, ...events: AgentEvent[]) =>
  vi.fn(async (pid: string) => { for (const e of events) emit()(pid, e) })

const done: AgentEvent = {
  type: 'done',
  text: 'Bước 1 [[app.py:8-9]] rồi [[ma.py:1-2]]',
  citations: [{ raw: '[[app.py:8-9]]', file: 'app.py', start: 8, end: 9, valid: true, reason: null },
    { raw: '[[ma.py:1-2]]', file: 'ma.py', start: 1, end: 2, valid: false, reason: 'file_not_found' }]
}
const editReq: ApprovalRequest = { id: 'r1', tool: 'edit', path: 'lib/auth.dart', before: 'int a = 1;\n', after: 'int a = 2;\n' }
const bashReq: ApprovalRequest = { id: 'r2', tool: 'bash', command: 'rm -rf /' }

describe('AgentPanel', () => {
  it('sự kiện text nối dần vào tin đang trả lời', async () => {
    const { emitAgent } = installNexgraph({ ...consented(), agent: { prompt: pending() } })
    render(<AgentPanel {...props()} />)
    await ask('luồng đăng nhập chạy thế nào?')
    act(() => emitAgent('p1', { type: 'text', delta: 'Bước 1: ' }))
    act(() => emitAgent('p1', { type: 'text', delta: 'mở auth.dart' }))
    expect(await screen.findByText('Bước 1: mở auth.dart')).toBeInTheDocument()
  })

  it('done thay bằng CitationText với chip; bấm chip gọi onOpenCode(file, line, lineEnd)', async () => {
    let emit: (pid: string, e: AgentEvent) => void = () => {}
    emit = installNexgraph({ ...consented(), agent: { prompt: replying(() => emit,
      { type: 'text', delta: 'Bước 1 ' }, done) } }).emitAgent
    const p = props()
    render(<AgentPanel {...p} />)
    await ask('hỏi')
    const chip = await screen.findByRole('button', { name: 'app.py:8–9' })
    expect(screen.getAllByText(/Bước 1/)).toHaveLength(1)
    await userEvent.click(chip)
    expect(p.onOpenCode).toHaveBeenCalledWith('app.py', 8, 9)
    expect(screen.getByRole('button', { name: /ma\.py:1–2/ })).toBeDisabled()
  })

  it('công tắc mặc định ở Hỏi; lần đầu sang Sửa hiện cảnh báo sandbox rồi gọi setMode edit', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { api } = installNexgraph({ ...consented(), agent: { getMode: vi.fn(async () => 'ask' as const) } })
    render(<AgentPanel {...props()} />)
    expect(await screen.findByRole('button', { name: 'Hỏi' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sửa' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Sửa' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('sandbox'))
    await waitFor(() => expect(api.agent.setMode).toHaveBeenCalledWith('p1', 'edit'))
    confirm.mockRestore()
  })

  it('từ chối cảnh báo thì giữ Hỏi, không setMode edit; sang Sửa lần sau vẫn hỏi', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { api } = installNexgraph({ ...consented(), agent: { getMode: vi.fn(async () => 'ask' as const) } })
    render(<AgentPanel {...props()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Sửa' }))
    expect(api.agent.setMode).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Hỏi' })) // đổi qua lại không cảnh báo, không setMode
    expect(api.agent.setMode).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: 'Sửa' }))
    await waitFor(() => expect(api.agent.setMode).toHaveBeenCalledWith('p1', 'edit'))
    confirm.mockRestore()
  })

  it('getMode trả edit thì công tắc ở Sửa ngay, không hỏi lại', async () => {
    installNexgraph({ ...consented(), agent: { getMode: vi.fn(async () => 'edit' as const) } })
    render(<AgentPanel {...props()} />)
    expect(await screen.findByRole('button', { name: 'Sửa' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('approval edit hiện đường dẫn; Duyệt gọi approve(id, true)', async () => {
    const { api, emitAgent } = installNexgraph({ ...consented(), agent: { prompt: pending() } })
    render(<AgentPanel {...props()} />)
    await ask('sửa giúp hàm login')
    act(() => emitAgent('p1', { type: 'approval', request: editReq }))
    expect(await screen.findByText('Sửa tệp lib/auth.dart')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Duyệt' }))
    expect(api.agent.approve).toHaveBeenCalledWith('p1', 'r1', true)
  })

  it('approval bash hiện nguyên lệnh; Từ chối gọi approve(id, false)', async () => {
    const { api, emitAgent } = installNexgraph({ ...consented(), agent: { prompt: pending() } })
    render(<AgentPanel {...props()} />)
    await ask('dọn cache')
    act(() => emitAgent('p1', { type: 'approval', request: bashReq }))
    expect(await screen.findByText(/rm -rf \//)).toBeInTheDocument()
    expect(screen.queryByLabelText('diff')).toBeNull() // bash không có diff
    await userEvent.click(screen.getByRole('button', { name: 'Từ chối' }))
    expect(api.agent.approve).toHaveBeenCalledWith('p1', 'r2', false)
  })

  it('approval_closed gỡ thẻ duyệt đúng id; id lạ bị bỏ qua', async () => {
    const { emitAgent } = installNexgraph({ ...consented(), agent: { prompt: pending() } })
    render(<AgentPanel {...props()} />)
    await ask('sửa giúp')
    act(() => emitAgent('p1', { type: 'approval', request: editReq }))
    act(() => emitAgent('p1', { type: 'approval', request: bashReq }))
    act(() => emitAgent('p1', { type: 'approval_closed', id: 'khong-lam-gi' }))
    expect(screen.getByText('Sửa tệp lib/auth.dart')).toBeInTheDocument() // id lạ không gỡ oan thẻ nào
    act(() => emitAgent('p1', { type: 'approval_closed', id: 'r1' }))
    await waitFor(() => expect(screen.queryByText('Sửa tệp lib/auth.dart')).toBeNull())
    expect(screen.getByText(/rm -rf \//)).toBeInTheDocument()
  })

  it('nút Dừng gọi agent.abort; đang chạy thì ô nhập khoá', async () => {
    const { api } = installNexgraph({ ...consented(), agent: { prompt: pending() } })
    render(<AgentPanel {...props()} />)
    const box = await screen.findByPlaceholderText(/Hỏi về dự án/)
    expect(box).toBeEnabled()
    await userEvent.type(box, 'hỏi{Enter}')
    expect(await screen.findByPlaceholderText(/Hỏi về dự án/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dừng' }))
    expect(api.agent.abort).toHaveBeenCalledWith('p1')
  })

  it('gõ /login mở Settings, không gửi cho mô hình', async () => {
    const { api } = installNexgraph({ ...consented(), agent: { prompt: pending() } })
    const p = props()
    render(<AgentPanel {...p} />)
    await ask('/login')
    expect(p.onOpenSettings).toHaveBeenCalled()
    expect(api.agent.prompt).not.toHaveBeenCalled()
  })

  it('sự kiện error hiện thông báo và mở lại ô nhập với câu hỏi cũ', async () => {
    let emit: (pid: string, e: AgentEvent) => void = () => {}
    emit = installNexgraph({ ...consented(), agent: { prompt: replying(() => emit,
      { type: 'error', code: 'ai_unreachable', message: 'x' }) } }).emitAgent
    render(<AgentPanel {...props()} />)
    await ask('hỏi gì đó')
    expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được tới nhà cung cấp AI.')
    expect(screen.getByPlaceholderText(/Hỏi về dự án/)).toHaveValue('hỏi gì đó')
    expect(screen.getByPlaceholderText(/Hỏi về dự án/)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeInTheDocument()
  })

  it('xung đột khi ghi vẫn hiện sau câu trả lời và được xóa khi gửi câu hỏi mới', async () => {
    const { emitAgent } = installNexgraph({ ...consented(), agent: { prompt: pending() } })
    render(<AgentPanel {...props()} />)
    await ask('sửa hàm login')
    const message = 'Tệp đã thay đổi. Chưa ghi thay đổi. Hãy đọc lại tệp và duyệt bản xem trước mới.'
    act(() => emitAgent('p1', { type: 'write_conflict', message }))
    act(() => emitAgent('p1', done))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    await ask('đọc lại tệp')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('chưa đồng ý gửi mã → hiện ConsentDialog trước khi gửi; Huỷ thì không gửi', async () => {
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => false) } })
    render(<AgentPanel {...props()} projectName="Kho thử nghiệm" />)
    await ask('luồng đăng nhập?')
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('Kho thử nghiệm')
    expect(dlg).toHaveTextContent('provider-one')
    expect(dlg).toHaveTextContent('https://api.example.com/v1')
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(api.agent.prompt).not.toHaveBeenCalled()
    await userEvent.type(await screen.findByPlaceholderText(/Hỏi về dự án/), '{Enter}') // gửi lại lần nữa
    await userEvent.click(await screen.findByRole('button', { name: 'Đồng ý và gửi' }))
    await waitFor(() => expect(api.agent.prompt).toHaveBeenCalledWith('p1', 'luồng đăng nhập?', target))
    expect(api.ai.grantConsent).toHaveBeenCalledWith('p1', target)
  })

  it('nhà cung cấp đổi lúc hộp thoại mở → giữ câu hỏi, không cấp phép hay gửi tới nơi mới', async () => {
    let provider = target.provider
    const getSettings = vi.fn(async () => ({ ...target, provider, model: 'm1', hasKey: true }))
    const { api } = installNexgraph({ ai: { getSettings, hasConsent: vi.fn(async () => false) } })
    render(<AgentPanel {...props()} />)
    await ask('câu hỏi cần đồng ý')
    expect(await screen.findByRole('dialog')).toHaveTextContent('provider-one')
    provider = 'provider-two' // cùng máy chủ nhưng tài khoản khác
    await userEvent.click(screen.getByRole('button', { name: 'Đồng ý và gửi' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nhà cung cấp hoặc model AI đã thay đổi')
    expect(screen.getByPlaceholderText(/Hỏi về dự án/)).toHaveValue('câu hỏi cần đồng ý')
    expect(api.ai.grantConsent).not.toHaveBeenCalled()
    expect(api.agent.prompt).not.toHaveBeenCalled()
    await userEvent.type(screen.getByPlaceholderText(/Hỏi về dự án/), '{Enter}')
    expect(await screen.findByRole('dialog')).toHaveTextContent('provider-two')
  })

  it('đổi dự án khi đang chờ đồng ý → đóng hộp thoại và không gửi câu cũ', async () => {
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => false) } })
    const p = props()
    const view = render(<AgentPanel {...p} projectName="Dự án một" />)
    await ask('câu của dự án một')
    expect(await screen.findByRole('dialog')).toHaveTextContent('Dự án một')
    view.rerender(<AgentPanel {...p} projectId="p2" projectName="Dự án hai" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Hỏi về dự án/)).toHaveValue('')
    expect(api.ai.grantConsent).not.toHaveBeenCalled()
    expect(api.agent.prompt).not.toHaveBeenCalled()
  })

  it('ẩn bảng trong lúc cấp phép thì không gửi câu hỏi sau khi cấp phép hoàn tất', async () => {
    let resolve!: () => void
    const grantConsent = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => false), grantConsent } })
    const p = props()
    const view = render(<AgentPanel {...p} />)
    await ask('câu hỏi bị đóng')
    await userEvent.click(await screen.findByRole('button', { name: 'Đồng ý và gửi' }))
    await waitFor(() => expect(grantConsent).toHaveBeenCalledWith('p1', target))
    view.rerender(<AgentPanel {...p} hidden />)
    await act(async () => resolve())
    expect(api.agent.prompt).not.toHaveBeenCalled()
  })

  it('sự kiện của dự án khác bị bỏ qua (approval, done)', async () => {
    const { emitAgent } = installNexgraph({ ...consented(), agent: { prompt: pending() } })
    render(<AgentPanel {...props()} />)
    await ask('q')
    act(() => emitAgent('p2', { type: 'approval', request: editReq }))
    act(() => emitAgent('p2', done))
    expect(screen.queryByText('Sửa tệp lib/auth.dart')).toBeNull()
    expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument()
  })

  it('unmount khi đang chạy thì dừng lượt', async () => {
    const { api } = installNexgraph({ ...consented(), agent: { prompt: pending() } })
    const view = render(<AgentPanel {...props()} />)
    await ask('hỏi')
    view.unmount()
    expect(api.agent.abort).toHaveBeenCalledWith('p1')
  })
})
