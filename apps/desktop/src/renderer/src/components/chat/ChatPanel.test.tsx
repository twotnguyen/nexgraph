// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@shared/agent-types'
import { installNexgraph } from '../../test-utils'
import { ChatPanel } from './ChatPanel'

const configured = vi.fn(async () => ({ baseUrl: 'https://api.example.com/v1', model: 'm1', hasKey: true }))
const done: AgentEvent = {
  type: 'done',
  text: 'Bước 1 [[app.py:8-9]] rồi [[ma.py:1-2]]',
  citations: [{ raw: '[[app.py:8-9]]', file: 'app.py', start: 8, end: 9, valid: true, reason: null },
    { raw: '[[ma.py:1-2]]', file: 'ma.py', start: 1, end: 2, valid: false, reason: 'file_not_found' }]
}
const props = () => ({ projectId: 'p1', onOpenCode: vi.fn(), onHighlight: vi.fn(), onOpenSettings: vi.fn() })
const ask = async (q: string) => userEvent.type(await screen.findByPlaceholderText(/Hỏi về dự án/), `${q}{Enter}`)
const pending = () => vi.fn(() => new Promise<void>(() => {}))
/** prompt giả phát `events` rồi kết thúc lượt. */
const replying = (emit: () => (pid: string, e: AgentEvent) => void, ...events: AgentEvent[]) =>
  vi.fn(async (pid: string) => { for (const e of events) emit()(pid, e) })

describe('ChatPanel', () => {
  it('chưa cấu hình: hiện thông báo và nút Mở Cài đặt, không có ô nhập', async () => {
    installNexgraph()
    const p = props()
    render(<ChatPanel {...p} />)
    expect(await screen.findByText(/Chưa cấu hình trợ lý AI/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Hỏi về dự án/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Mở Cài đặt' }))
    expect(p.onOpenSettings).toHaveBeenCalled()
  })

  it('lần gửi đầu hỏi đồng ý, nêu máy chủ và model; Huỷ thì không gửi', async () => {
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => false) } })
    render(<ChatPanel {...props()} />)
    await ask('luồng đăng nhập?')
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent('api.example.com')
    expect(dlg).toHaveTextContent('m1')
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(api.agent.prompt).not.toHaveBeenCalled()
  })

  it('đồng ý thì lưu đồng ý rồi mới gửi', async () => {
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => false) } })
    render(<ChatPanel {...props()} />)
    await ask('hỏi')
    await userEvent.click(await screen.findByRole('button', { name: 'Đồng ý và gửi' }))
    await waitFor(() => expect(api.agent.prompt).toHaveBeenCalledWith('p1', 'hỏi'))
    expect(api.ai.grantConsent).toHaveBeenCalledWith('p1')
  })

  it('gửi qua agent.prompt; hiện tên tool, chữ chảy dần; done hiện chip và chân tin; chip mở mã', async () => {
    const { api, emitAgent } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true) }, agent: { prompt: pending() } })
    const p = props()
    render(<ChatPanel {...p} />)
    await ask('luồng đăng nhập?')
    expect(api.agent.prompt).toHaveBeenCalledWith('p1', 'luồng đăng nhập?')
    act(() => emitAgent('p1', { type: 'tool', name: 'list_flows', status: 'start' }))
    expect(await screen.findByText('Đang gọi list_flows…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument()
    act(() => emitAgent('p1', { type: 'text', delta: 'Bước 1 ' }))
    expect(await screen.findByText(/Bước 1/)).toBeInTheDocument()
    act(() => emitAgent('p1', done))
    expect(await screen.findByText('1/2 trích dẫn đã xác minh')).toBeInTheDocument()
    expect(screen.getByText('Đã gọi 1 công cụ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'app.py:8–9' }))
    expect(p.onOpenCode).toHaveBeenCalledWith('app.py', 8, 9)
    expect(screen.getByRole('button', { name: /ma\.py:1–2/ })).toBeDisabled()
  })

  it('sự kiện của dự án khác bị bỏ qua', async () => {
    const { emitAgent } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true) }, agent: { prompt: pending() } })
    render(<ChatPanel {...props()} />)
    await ask('q')
    act(() => emitAgent('p2', done))
    expect(screen.queryByText('1/2 trích dẫn đã xác minh')).toBeNull()
    expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument()
  })

  it('câu hỏi thứ hai gửi tiếp trên cùng phiên (main giữ lịch sử)', async () => {
    let emit: (pid: string, e: AgentEvent) => void = () => {}
    const prompt = replying(() => emit, { type: 'text', delta: 'ok' }, { type: 'done', text: 'ok', citations: [] })
    const r = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true) }, agent: { prompt } })
    emit = r.emitAgent
    render(<ChatPanel {...props()} />)
    await ask('một')
    await screen.findByText('ok')
    await ask('hai')
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    expect(prompt.mock.calls[1]).toEqual(['p1', 'hai'])
  })

  it('Shift+Enter xuống dòng, không gửi; đang chờ thì Dừng gọi agent.abort', async () => {
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true) }, agent: { prompt: pending() } })
    render(<ChatPanel {...props()} />)
    const box = await screen.findByPlaceholderText(/Hỏi về dự án/)
    await userEvent.type(box, 'a{Shift>}{Enter}{/Shift}b')
    expect(api.agent.prompt).not.toHaveBeenCalled()
    await userEvent.type(box, '{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Dừng' }))
    expect(api.agent.abort).toHaveBeenCalledWith('p1')
  })

  it('dừng lượt đang chạy khi panel bị unmount', async () => {
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true) }, agent: { prompt: pending() } })
    const view = render(<ChatPanel {...props()} />)
    await ask('hỏi')
    view.unmount()
    expect(api.agent.abort).toHaveBeenCalledWith('p1')
  })

  it('"Tô luồng trên graph": locate từng trích dẫn hợp lệ, gọi paths, trả overlay', async () => {
    const node = (id: string) => ({ id, kind: 'function' as const, label: id, qualified_name: id, language: null, file: null, line_start: 1, line_end: 2, is_test: false, origin: 'ast', signature: null, community: null })
    const two: AgentEvent = { type: 'done', text: '[[a.py:1-2]] [[b.py:3]]', citations: [{ raw: '[[a.py:1-2]]', file: 'a.py', start: 1, end: 2, valid: true, reason: null }, { raw: '[[b.py:3]]', file: 'b.py', start: 3, end: 3, valid: true, reason: null }] }
    const locate = vi.fn(async (_p: string, file: string) => ({ node: node(`${file}::f#function`) }))
    const paths = vi.fn(async () => ({ nodes: [node('a.py::f#function'), node('b.py::f#function')], edges: [{ id: 1 }] as never[], unconnected: [] as string[] }))
    const p = props()
    let emit: (pid: string, e: AgentEvent) => void = () => {}
    emit = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true) }, agent: { prompt: replying(() => emit, two) }, graph: { locate, paths } }).emitAgent
    render(<ChatPanel {...p} />)
    await ask('q')
    await userEvent.click(await screen.findByRole('button', { name: 'Tô luồng trên graph' }))
    await waitFor(() => expect(p.onHighlight).toHaveBeenCalledWith(expect.any(Array), [{ id: 1 }], null))
    expect(paths).toHaveBeenCalledWith('p1', ['a.py::f#function', 'b.py::f#function'])
  })

  it('sự kiện error có mã thì hiện câu tương ứng trong role=alert, ô nhập giữ lại câu hỏi', async () => {
    let emit: (pid: string, e: AgentEvent) => void = () => {}
    emit = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true) },
      agent: { prompt: replying(() => emit, { type: 'error', code: 'ai_unreachable', message: 'x' }) } }).emitAgent
    render(<ChatPanel {...props()} />)
    await ask('hỏi gì đó')
    expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được tới nhà cung cấp AI.')
    expect(screen.getByPlaceholderText(/Hỏi về dự án/)).toHaveValue('hỏi gì đó')
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeInTheDocument()
  })

  it('agent.prompt ném lỗi (vd. chưa đồng ý) thì hiện message trong role=alert', async () => {
    installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true) },
      agent: { prompt: vi.fn(async () => { throw { code: 'consent_required', message: 'Chưa đồng ý gửi dữ liệu tới nhà cung cấp AI' } }) } })
    render(<ChatPanel {...props()} />)
    await ask('hỏi')
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa đồng ý gửi dữ liệu tới nhà cung cấp AI')
  })

  it('"Đã gọi N công cụ" mở danh sách tên công cụ', async () => {
    let emit: (pid: string, e: AgentEvent) => void = () => {}
    emit = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true) }, agent: { prompt: replying(() => emit,
      { type: 'tool', name: 'list_flows', status: 'start' }, { type: 'tool', name: 'trace_flow', status: 'start' }, done) } }).emitAgent
    render(<ChatPanel {...props()} />)
    await ask('q')
    await userEvent.click(await screen.findByRole('button', { name: 'Đã gọi 2 công cụ' }))
    expect(screen.getByText('trace_flow')).toBeInTheDocument()
  })
})
