// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ChatAnswer } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { ChatPanel } from './ChatPanel'

const configured = vi.fn(async () => ({ baseUrl: 'https://api.example.com/v1', model: 'm1', hasKey: true }))
const answer: ChatAnswer = {
  text: 'Bước 1 [[app.py:8-9]] rồi [[ma.py:1-2]]',
  citations: [{ raw: '[[app.py:8-9]]', file: 'app.py', start: 8, end: 9, valid: true, reason: null },
    { raw: '[[ma.py:1-2]]', file: 'ma.py', start: 1, end: 2, valid: false, reason: 'file_not_found' }],
  toolCalls: [{ name: 'list_flows', args: '{}', ms: 3 }, { name: 'trace_flow', args: '{"flow_id":1}', ms: 4 }]
}
const props = () => ({ projectId: 'p1', onOpenCode: vi.fn(), onHighlight: vi.fn(), onOpenSettings: vi.fn() })
const ask = async (q: string) => userEvent.type(await screen.findByPlaceholderText(/Hỏi về dự án/), `${q}{Enter}`)

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
    expect(api.ai.send).not.toHaveBeenCalled()
  })

  it('đồng ý thì lưu đồng ý rồi mới gửi', async () => {
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => false), send: vi.fn(async () => answer) } })
    render(<ChatPanel {...props()} />)
    await ask('hỏi')
    await userEvent.click(await screen.findByRole('button', { name: 'Đồng ý và gửi' }))
    await waitFor(() => expect(api.ai.send).toHaveBeenCalled())
    expect(api.ai.grantConsent).toHaveBeenCalledWith('p1')
  })

  it('gửi; hiện tên tool đang gọi; hiện câu trả lời với chip và chân tin; chip mở mã', async () => {
    let emit: (e: { chatId: string; type: 'tool'; name: string }) => void = () => {}
    let finish: (a: ChatAnswer) => void = () => {}
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true),
      onEvent: vi.fn((cb) => { emit = cb; return () => {} }),
      send: vi.fn(() => new Promise<ChatAnswer>((r) => { finish = r })) } })
    const p = props()
    render(<ChatPanel {...p} />)
    await ask('luồng đăng nhập?')
    expect(api.ai.send).toHaveBeenCalledWith('p1', expect.any(String), [{ role: 'user', content: 'luồng đăng nhập?' }])
    const id = (api.ai.send as ReturnType<typeof vi.fn>).mock.calls[0][1]
    emit({ chatId: id, type: 'tool', name: 'list_flows' })
    expect(await screen.findByText('Đang gọi list_flows…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument()
    finish(answer)
    expect(await screen.findByText('1/2 trích dẫn đã xác minh')).toBeInTheDocument()
    expect(screen.getByText('Đã gọi 2 công cụ')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'app.py:8–9' }))
    expect(p.onOpenCode).toHaveBeenCalledWith('app.py', 8, 9)
    expect(screen.getByRole('button', { name: /ma\.py:1–2/ })).toBeDisabled()
  })

  it('câu hỏi thứ hai gửi kèm lịch sử', async () => {
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true), send: vi.fn(async () => ({ ...answer, text: 'ok', citations: [], toolCalls: [] })) } })
    render(<ChatPanel {...props()} />)
    await ask('một')
    await screen.findByText('ok')
    await ask('hai')
    await waitFor(() => expect(api.ai.send).toHaveBeenCalledTimes(2))
    expect((api.ai.send as ReturnType<typeof vi.fn>).mock.calls[1][2]).toEqual([
      { role: 'user', content: 'một' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'hai' }])
  })

  it('Shift+Enter xuống dòng, không gửi; đang chờ thì Dừng gọi ai.cancel', async () => {
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true), send: vi.fn(() => new Promise<ChatAnswer>(() => {})) } })
    render(<ChatPanel {...props()} />)
    const box = await screen.findByPlaceholderText(/Hỏi về dự án/)
    await userEvent.type(box, 'a{Shift>}{Enter}{/Shift}b')
    expect(api.ai.send).not.toHaveBeenCalled()
    await userEvent.type(box, '{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Dừng' }))
    expect(api.ai.cancel).toHaveBeenCalledWith((api.ai.send as ReturnType<typeof vi.fn>).mock.calls[0][1])
  })

  it('hủy lượt chat đang chạy khi panel bị unmount', async () => {
    const { api } = installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true), send: vi.fn(() => new Promise<ChatAnswer>(() => {})) } })
    const view = render(<ChatPanel {...props()} />)
    await ask('hỏi')

    view.unmount()
    expect(api.ai.cancel).toHaveBeenCalledWith(expect.any(String))
  })

  it('"Tô luồng trên graph": locate từng trích dẫn hợp lệ, gọi paths, trả overlay', async () => {
    const node = (id: string) => ({ id, kind: 'function' as const, label: id, qualified_name: id, language: null, file: null, line_start: 1, line_end: 2, is_test: false, origin: 'ast', signature: null, community: null })
    const two = { ...answer, citations: [{ raw: '[[a.py:1-2]]', file: 'a.py', start: 1, end: 2, valid: true, reason: null }, { raw: '[[b.py:3]]', file: 'b.py', start: 3, end: 3, valid: true, reason: null }], text: '[[a.py:1-2]] [[b.py:3]]' } as ChatAnswer
    const locate = vi.fn(async (_p: string, file: string) => ({ node: node(`${file}::f#function`) }))
    const paths = vi.fn(async () => ({  nodes: [node('a.py::f#function'), node('b.py::f#function')], edges: [{ id: 1 }] as never[], unconnected: [] as string[] }))
    const p = props()
    installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true), send: vi.fn(async () => two) }, graph: { locate, paths } })
    render(<ChatPanel {...p} />)
    await ask('q')
    await userEvent.click(await screen.findByRole('button', { name: 'Tô luồng trên graph' }))
    await waitFor(() => expect(p.onHighlight).toHaveBeenCalledWith(expect.any(Array), [{ id: 1 }], null))
    expect(paths).toHaveBeenCalledWith('p1', ['a.py::f#function', 'b.py::f#function'])
  })

  it('lỗi có mã thì hiện câu tương ứng trong role=alert, ô nhập giữ lại câu hỏi', async () => {
    installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true), send: vi.fn(async () => { throw { code: 'ai_unreachable', message: 'x' } }) } })
    render(<ChatPanel {...props()} />)
    await ask('hỏi gì đó')
    expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được tới nhà cung cấp AI.')
    expect(screen.getByPlaceholderText(/Hỏi về dự án/)).toHaveValue('hỏi gì đó')
  })

  it('"Đã gọi N công cụ" mở danh sách tên và tham số', async () => {
    installNexgraph({ ai: { getSettings: configured, hasConsent: vi.fn(async () => true), send: vi.fn(async () => answer) } })
    render(<ChatPanel {...props()} />)
    await ask('q')
    await userEvent.click(await screen.findByRole('button', { name: 'Đã gọi 2 công cụ' }))
    expect(screen.getByText(/trace_flow \{"flow_id":1\}/)).toBeInTheDocument()
  })
})
