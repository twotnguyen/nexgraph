// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { setLocale } from '../../shared/lib/locale'
import { NexAccountsPane } from './NexAccountsPane'
import type { NexAccountsView } from '@nexgraph/contracts/agent-types'

const view = (over: Partial<NexAccountsView> = {}): NexAccountsView => ({
  available: true,
  selected: null,
  providers: [
    {
      id: 'openai', name: 'OpenAI', connected: false, connections: [],
      methods: [
        { id: 'chatgpt-token-sharing', type: 'oauth', label: 'Sign in with ChatGPT' },
        { id: 'key', type: 'key', label: 'API key' }
      ],
      models: [{ id: 'gpt-x', label: 'GPT X' }]
    },
    {
      id: 'github-copilot', name: 'GitHub Copilot', connected: true,
      connections: [{ id: 'cred_1', label: 'octocat', method: 'oauth' }],
      methods: [{ id: 'device', type: 'oauth', label: 'Login with GitHub Copilot' }],
      models: [{ id: 'gpt-4.1', label: 'GPT-4.1' }]
    }
  ],
  ...over
})

afterEach(() => { act(() => setLocale('vi')) })

describe('NexAccountsPane', () => {
  it('hiện nhà cung cấp + trạng thái, bắt đầu đăng nhập, hiện mã device và huỷ được', async () => {
    const { api } = installNexgraph({ nex: {
      accounts: vi.fn(async () => view({ selected: { provider: 'github-copilot', id: 'gpt-4.1' } })),
      authStart: vi.fn(async () => ({ kind: 'oauth' as const, integrationId: 'github-copilot', attemptId: 'con_1', url: 'https://github.com/login/device', instructions: 'Enter code: 520C-1E7F', userCode: '520C-1E7F', opened: true })),
      authCancel: vi.fn(async () => {})
    } })
    render(<NexAccountsPane onConnected={vi.fn()} onClose={vi.fn()} onBusyChange={vi.fn()} />)
    expect(await screen.findByText('OpenAI / ChatGPT')).toBeInTheDocument()
    expect(screen.getByText('Chưa kết nối')).toBeInTheDocument()
    expect(screen.getByText('Đã kết nối')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model mặc định GitHub Copilot' })).toHaveValue('gpt-4.1')

    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập GitHub Copilot' }))
    expect(api.nex.authStart).toHaveBeenCalledWith('github-copilot', 'device', undefined)
    expect(await screen.findByText('520C-1E7F')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Mở trang xác nhận' })).toHaveAttribute('href', 'https://github.com/login/device')

    await userEvent.click(screen.getByRole('button', { name: 'Huỷ' }))
    expect(api.nex.authCancel).toHaveBeenCalledWith('oauth', 'github-copilot', 'con_1')
  })

  it('chọn model mặc định gửi provider/id; model của nhà cung cấp chưa kết nối bị khoá', async () => {
    const { api } = installNexgraph({ nex: { accounts: vi.fn(async () => view()) } })
    render(<NexAccountsPane onConnected={vi.fn()} onClose={vi.fn()} onBusyChange={vi.fn()} />)
    const openai = await screen.findByRole('combobox', { name: 'Model mặc định OpenAI / ChatGPT' })
    expect(openai).toBeDisabled()
    const copilot = screen.getByRole('combobox', { name: 'Model mặc định GitHub Copilot' })
    expect(copilot).toBeEnabled()
    await userEvent.selectOptions(copilot, 'gpt-4.1')
    expect(api.nex.selectModel).toHaveBeenCalledWith('github-copilot', 'gpt-4.1')
  })

  it('nhập API key đi vào kho bí mật của app, không gọi authStart', async () => {
    const { api } = installNexgraph({ nex: { accounts: vi.fn(async () => view()) } })
    render(<NexAccountsPane onConnected={vi.fn()} onClose={vi.fn()} onBusyChange={vi.fn()} />)
    await screen.findByText('OpenAI / ChatGPT')
    await userEvent.click(screen.getByRole('button', { name: 'Nhập API key OpenAI / ChatGPT' }))
    await userEvent.type(screen.getByLabelText('API key'), 'sk-test')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu API key' }))
    expect(api.nex.saveKey).toHaveBeenCalledWith('openai', 'sk-test')
    expect(api.nex.authStart).not.toHaveBeenCalled()
  })

  it('đăng xuất gọi logout và tải lại danh sách; nhãn English đầy đủ', async () => {
    const accounts = vi.fn(async () => view())
    const { api } = installNexgraph({ nex: { accounts, logout: vi.fn(async () => {}) } })
    act(() => setLocale('en'))
    render(<NexAccountsPane onConnected={vi.fn()} onClose={vi.fn()} onBusyChange={vi.fn()} />)
    expect(await screen.findByText('AI accounts for Nex')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out GitHub Copilot' }))
    expect(api.nex.logout).toHaveBeenCalledWith('github-copilot')
    expect(accounts).toHaveBeenCalledTimes(2)
  })

  it('báo thiếu runtime Nex thay vì danh sách rỗng', async () => {
    installNexgraph({ nex: { accounts: vi.fn(async () => ({ available: false, reason: 'no_runtime' as const, providers: [], selected: null })) } })
    render(<NexAccountsPane onConnected={vi.fn()} onClose={vi.fn()} onBusyChange={vi.fn()} />)
    expect(await screen.findByText('Chưa tìm thấy runtime Nex trên máy này.')).toBeInTheDocument()
  })
})
