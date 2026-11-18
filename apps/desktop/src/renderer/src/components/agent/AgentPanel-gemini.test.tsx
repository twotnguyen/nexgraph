// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { AgentPanel } from './AgentPanel'

const settings = { runtime: 'antigravity-cli' as const, provider: 'google-antigravity', baseUrl: '', model: 'auto', connectionId: 'google-account-a', hasKey: false }
const target = { runtime: 'antigravity-cli' as const, provider: 'google-antigravity', connectionId: 'google-account-a' }
const props = { projectId: 'p1', projectName: 'Cửa hàng', onOpenCode: vi.fn(), onHighlight: vi.fn(), onOpenSettings: vi.fn() }
const models = [{ runtime: 'antigravity-cli' as const, provider: 'google-antigravity', id: 'auto', label: 'Auto' },
  { runtime: 'pi' as const, provider: 'google', id: 'api-gemini', label: 'Gemini API trả phí' }]

describe('AgentPanel Gemini runtime', () => {
  it('hiện Antigravity cho model khác Gemini nhưng vẫn dùng kết nối tài khoản Google', async () => {
    installNexgraph({
      ai: { getSettings: vi.fn(async () => ({ ...settings, model: 'claude-sonnet' })) },
      auth: { models: vi.fn(async () => [{ runtime: 'antigravity-cli' as const, provider: 'google-antigravity', id: 'claude-sonnet', label: 'Claude Sonnet' }]) }
    })
    render(<AgentPanel {...props} />)
    expect(await screen.findByText('Antigravity · Tài khoản Google')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Mô hình AI' })).toHaveDisplayValue('Claude Sonnet')
    expect(screen.queryByText('Gemini · API key')).not.toBeInTheDocument()
  })

  it('hiện tài khoản Google, model tự động và chỉ cho chọn model trong kết nối hiện tại', async () => {
    const { api } = installNexgraph({ ai: { getSettings: vi.fn(async () => settings), hasConsent: vi.fn(async () => true) }, auth: { models: vi.fn(async () => models) } })
    render(<AgentPanel {...props} />)
    expect(await screen.findByText('Gemini · Tài khoản Google')).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Mô hình AI' })).toHaveDisplayValue('Tự động')
    expect(screen.queryByRole('option', { name: 'Gemini API trả phí' })).not.toBeInTheDocument()
    const composer = screen.getByPlaceholderText(/Hỏi về dự án/)
    await waitFor(() => expect(composer).toBeEnabled())
    await userEvent.type(composer, 'Giải thích dự án{Enter}')
    expect(api.agent.prompt).toHaveBeenCalledWith('p1', 'Giải thích dự án', target)
  })

  it('consent Google không cần Base URL giả và gửi lại câu hỏi sau đồng ý', async () => {
    const { api } = installNexgraph({ ai: { getSettings: vi.fn(async () => settings) } })
    render(<AgentPanel {...props} />)
    const composer = screen.getByPlaceholderText(/Hỏi về dự án/)
    await waitFor(() => expect(composer).toBeEnabled())
    await userEvent.type(composer, 'Luồng xác thực?{Enter}')
    const consent = await screen.findByRole('dialog')
    expect(consent).toHaveTextContent('Antigravity CLI chính thức')
    expect(consent).toHaveTextContent('Cửa hàng')
    expect(consent).toHaveTextContent('tới Google')
    expect(consent).toHaveTextContent('ngữ cảnh và lịch sử hội thoại')
    expect(consent).toHaveTextContent('tài khoản Google hiện đang được Antigravity quản lý')
    expect(consent).toHaveTextContent('Nếu bạn đổi tài khoản Google ngoài NexGraph')
    await userEvent.click(within(consent).getByRole('button', { name: 'Đồng ý và gửi' }))
    expect(api.ai.grantConsent).toHaveBeenCalledWith('p1', target)
    expect(api.agent.prompt).toHaveBeenCalledWith('p1', 'Luồng xác thực?', target)
  })

  it('nhãn API key Gemini riêng biệt và model picker không trộn tài khoản Google', async () => {
    installNexgraph({ ai: { getSettings: vi.fn(async () => ({ ...settings, runtime: 'pi' as const, provider: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'api-gemini', hasKey: true })) }, auth: { models: vi.fn(async () => models) } })
    render(<AgentPanel {...props} />)
    expect(await screen.findByText('Gemini · API key')).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'Mô hình AI' })).toHaveDisplayValue('Gemini API trả phí')
    expect(screen.queryByRole('option', { name: 'Tự động' })).not.toBeInTheDocument()
  })
})
