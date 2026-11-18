// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { ConnectionDialog } from './ConnectionDialog'

const account = { id: 'openai', label: 'OpenAI', oauth: true, hasKey: false, loggedIn: false, custom: false, authMethods: ['oauth' as const] }
const model = { provider: 'openai', id: 'm', label: 'ChatGPT model', contextWindow: 32000, maxTokens: 4000, pricing: 'subscription' as const }
const settings = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm', accountId: 'account-a', hasKey: true }

describe('ConnectionDialog', () => {
  it('đăng nhập ChatGPT, chọn model, kiểm tra và cấp consent đúng tài khoản cho dự án', async () => {
    const { api } = installNexgraph({
      auth: {
        list: vi.fn(async () => [account]),
        login: vi.fn(async () => {}),
        models: vi.fn(async () => [model]),
        test: vi.fn(async () => ({ ok: true, message: 'Công cụ đã sẵn sàng', capabilities: { streaming: true, tools: true } }))
      },
      ai: { getSettings: vi.fn(async () => settings) }
    })
    const connected = vi.fn()
    render(<ConnectionDialog projectId="project" onConnected={connected} onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Tiếp tục đăng nhập' }))
    expect(api.auth.login).toHaveBeenCalledWith('openai')
    expect(await screen.findByLabelText('Model')).toHaveValue('m')
    expect(screen.getByText(/Context 32,000|Context 32.000/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối và công cụ' }))
    await screen.findByText('Công cụ đã sẵn sàng')
    const finish = screen.getByRole('button', { name: 'Dùng kết nối' })
    expect(finish).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(finish)
    expect(api.ai.grantConsent).toHaveBeenCalledWith('project', {
      provider: 'openai', baseUrl: 'https://api.openai.com/v1', accountId: 'account-a'
    })
    expect(connected).toHaveBeenCalledOnce()
  })

  it('hiện hướng dẫn đăng nhập và hủy OAuth khi đóng hộp thoại', async () => {
    const { api } = installNexgraph({ auth: {
      list: vi.fn(async () => [account]),
      login: vi.fn(() => new Promise<void>(() => {}))
    } })
    let event: (value: { type: 'auth_url'; url: string; instructions: string }) => void = () => {}
    vi.mocked(api.auth.onEvent).mockImplementation((handler) => {
      event = handler
      return vi.fn()
    })
    const { unmount } = render(<ConnectionDialog onConnected={vi.fn()} onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Tiếp tục đăng nhập' }))
    act(() => event({ type: 'auth_url', url: 'https://auth.openai.com/', instructions: 'Hoàn tất ở trình duyệt' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Hoàn tất ở trình duyệt')
    expect(screen.getByRole('link', { name: 'Mở lại trang xác nhận' })).toHaveAttribute('href', 'https://auth.openai.com/')
    unmount()
    expect(api.auth.loginCancel).toHaveBeenCalled()
  })

  it('cho chọn tài khoản hoặc workspace ChatGPT khác trước khi đăng nhập', async () => {
    const { api } = installNexgraph({ auth: { list: vi.fn(async () => [account]) } })
    render(<ConnectionDialog onConnected={vi.fn()} onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Dùng tài khoản hoặc workspace khác' }))
    expect(api.auth.forgetRegistration).toHaveBeenCalledOnce()
    expect(api.auth.login).not.toHaveBeenCalled()
  })

  it('tìm và kết nối Ollama trong lần đầu chưa có cấu hình AI', async () => {
    const { api } = installNexgraph({
      auth: {
        list: vi.fn(async () => []),
        discoverLocal: vi.fn(async () => [{ id: 'coder:7b', label: 'coder:7b', sizeBytes: 4e9 }]),
        connectLocal: vi.fn(async () => {}),
        models: vi.fn(async () => [{ provider: 'ollama-local', id: 'coder:7b', label: 'coder:7b', pricing: 'local' as const }]),
        test: vi.fn(async () => ({ ok: true, message: 'Ollama sẵn sàng' }))
      },
      ai: { getSettings: vi.fn(async () => ({ ...settings, provider: 'ollama-local', model: 'coder:7b', baseUrl: 'http://127.0.0.1:11434/v1' })) }
    })
    const connected = vi.fn()
    render(<ConnectionDialog initialMethod="local" onConnected={connected} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Tìm model local' }))
    expect(await screen.findByLabelText('Model local')).toHaveValue('coder:7b')
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối và công cụ' }))
    expect(api.auth.connectLocal).toHaveBeenCalledWith('http://127.0.0.1:11434/v1', 'coder:7b')
    await screen.findByText('Ollama sẵn sàng')
    await userEvent.click(screen.getByRole('button', { name: 'Dùng kết nối' }))
    expect(connected).toHaveBeenCalledOnce()
  })

  it('tài khoản đổi sau khi kiểm tra cần kiểm tra lại trước khi cấp quyền', async () => {
    const readSettings = vi.fn(async () => settings).mockResolvedValueOnce(settings).mockResolvedValue({ ...settings, accountId: 'account-b' })
    const { api } = installNexgraph({
      auth: {
        list: vi.fn(async () => [{ ...account, loggedIn: true }]),
        models: vi.fn(async () => [model]),
        test: vi.fn(async () => ({ ok: true, message: 'ok' }))
      },
      ai: { getSettings: readSettings }
    })
    render(<ConnectionDialog projectId="project" onConnected={vi.fn()} onClose={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Dùng kết nối đã lưu' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Kiểm tra kết nối và công cụ' }))
    await screen.findByText('ok')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Dùng kết nối' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Kết nối đã thay đổi')
    expect(api.ai.grantConsent).not.toHaveBeenCalled()
  })
})
