// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { AgentPanel } from './AgentPanel'

vi.mock('../editor/monaco', () => ({ createDiffEditor: () => ({ dispose: vi.fn() }) }))

const target = { provider: 'openai', baseUrl: 'https://api.example.com/v1' }
const props = { projectId: 'composer-test', onOpenCode: vi.fn(), onHighlight: vi.fn(), onOpenSettings: vi.fn() }
const ai = { getSettings: vi.fn(async () => ({ ...target, model: 'm', hasKey: true })), hasConsent: vi.fn(async () => true) }
const box = async () => { const input = screen.getByRole('textbox', { name: 'Tin nhắn cho trợ lý AI' }); await waitFor(() => expect(input).toBeEnabled()); return input }

describe('AgentPanel composer', () => {
  it('xếp tin khi đang chạy, gửi lần lượt sau khi lượt trước thật sự kết thúc', async () => {
    let finish!: () => void
    const prompt = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve })).mockResolvedValue(undefined)
    const { emitAgent } = installNexgraph({ ai, agent: { prompt } })
    render(<AgentPanel {...props} />)
    const input = await box()
    await userEvent.type(input, 'câu đầu{Enter}')
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    await userEvent.type(input, 'câu sau{Enter}')
    expect(screen.getByLabelText('Hàng đợi tin nhắn')).toHaveTextContent('câu sau')
    act(() => emitAgent(props.projectId, { type: 'done', text: 'xong', citations: [] }))
    expect(prompt).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    expect(prompt).toHaveBeenLastCalledWith(props.projectId, 'câu sau', target)
  })

  it('Gửi ngay đợi lượt cũ dọn xong, giữ bản nháp đang soạn', async () => {
    let finish!: () => void
    const prompt = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve })).mockResolvedValue(undefined)
    const abort = vi.fn(async () => {})
    installNexgraph({ ai, agent: { prompt, abort } })
    render(<AgentPanel {...props} />)
    const input = await box()
    await userEvent.type(input, 'đầu{Enter}')
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
    await userEvent.type(input, 'gửi ngay{Enter}bản nháp')
    await userEvent.click(screen.getByRole('button', { name: 'Gửi ngay' }))
    expect(abort).toHaveBeenCalledWith(props.projectId)
    expect(prompt).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    await waitFor(() => expect(prompt).toHaveBeenCalledTimes(2))
    expect(prompt).toHaveBeenLastCalledWith(props.projectId, 'gửi ngay', target)
    expect(input).toHaveValue('bản nháp')
  })

  it('cho sửa tin chờ, hủy trả lại bản nháp đang soạn', async () => {
    const prompt = vi.fn(() => new Promise<void>(() => {}))
    installNexgraph({ ai, agent: { prompt } })
    render(<AgentPanel {...props} />)
    const input = await box()
    await userEvent.type(input, 'đầu{Enter}')
    await waitFor(() => expect(prompt).toHaveBeenCalled())
    await userEvent.type(input, 'chờ{Enter}bản nháp')
    await userEvent.click(screen.getByRole('button', { name: 'Sửa tin trong hàng đợi' }))
    expect(input).toHaveValue('chờ')
    await userEvent.click(within(screen.getByLabelText('Hàng đợi tin nhắn')).getByRole('button', { name: 'Hủy' }))
    expect(input).toHaveValue('bản nháp')
    expect(screen.getByLabelText('Hàng đợi tin nhắn')).toHaveTextContent('chờ')
  })

  it('gợi ý slash và mention; tệp được chọn gửi kèm làm ngữ cảnh', async () => {
    const prompt = vi.fn(() => new Promise<void>(() => {}))
    installNexgraph({ ai, fs: { files: vi.fn(async () => ({ files: ['src/dbg_demo.py', 'src/main.ts'], truncated: false })) }, agent: { prompt } })
    render(<AgentPanel {...props} />)
    const input = await box()
    await userEvent.type(input, '/')
    expect(screen.getByRole('option', { name: /\/new/ })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.clear(input)
    await userEvent.type(input, 'Đọc @dbg')
    const option = await screen.findByRole('option', { name: /dbg_demo\.py/ })
    await userEvent.click(option)
    expect(screen.getByText('@src/dbg_demo.py')).toBeInTheDocument()
    await userEvent.type(input, '{Enter}')
    await waitFor(() => expect(prompt).toHaveBeenCalledWith(props.projectId, 'Đọc', target, { context: [{ kind: 'file', file: 'src/dbg_demo.py' }] }))
  })

  it('dán ảnh hiển thị thumbnail và gửi payload ảnh', async () => {
    const prompt = vi.fn(() => new Promise<void>(() => {}))
    installNexgraph({ ai, agent: { prompt } })
    render(<AgentPanel {...props} />)
    const input = await box()
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'demo.png', { type: 'image/png' })
    fireEvent.paste(input, { clipboardData: { items: [{ kind: 'file', getAsFile: () => image }] } })
    expect(await screen.findByRole('img', { name: 'demo.png' })).toBeInTheDocument()
    await userEvent.type(input, 'xem ảnh{Enter}')
    await waitFor(() => expect(prompt).toHaveBeenCalledWith(props.projectId, 'xem ảnh', target, { images: [{ mimeType: 'image/png', data: 'iVBORw==' }] }))
  })

  it('không gửi ảnh tới model không hỗ trợ và hiện lý do rõ ràng', async () => {
    const prompt = vi.fn()
    installNexgraph({ ai, auth: { models: vi.fn(async () => [{ provider: 'openai', id: 'm', label: 'm', supportsImages: false }]) }, agent: { prompt } })
    render(<AgentPanel {...props} />)
    const input = await box()
    const image = new File([new Uint8Array([137, 80, 78, 71])], 'demo.png', { type: 'image/png' })
    fireEvent.paste(input, { clipboardData: { items: [{ kind: 'file', getAsFile: () => image }] } })
    await screen.findByRole('img', { name: 'demo.png' })
    await userEvent.type(input, 'xem ảnh{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Model hiện tại không nhận ảnh')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('nhận câu hỏi "Hỏi Nex" từ ngoài: điền ô soạn kèm ngữ cảnh, focus, không tự gửi', async () => {
    const prompt = vi.fn()
    installNexgraph({ ai, agent: { prompt } })
    const { rerender } = render(<AgentPanel {...props} />)
    const input = await box()
    rerender(<AgentPanel {...props} ask={{ text: 'Giải thích nút "run()" (src/a.ts:12) trong đồ thị này.', nonce: 1 }} />)
    await waitFor(() => expect(input).toHaveValue('Giải thích nút "run()" (src/a.ts:12) trong đồ thị này.'))
    await waitFor(() => expect(input).toHaveFocus())
    expect(prompt).not.toHaveBeenCalled()
  })
})
