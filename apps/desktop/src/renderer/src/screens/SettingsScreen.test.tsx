// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../test-utils'
import { SettingsScreen } from './SettingsScreen'

const configured = { getSettings: vi.fn(async () => ({ baseUrl: 'https://a/v1', model: 'm', hasKey: true })) }

describe('SettingsScreen', () => {
  it('nạp cấu hình, lưu, không bao giờ hiển thị lại key', async () => {
    const { api } = installNexgraph({ ai: { ...configured, saveSettings: vi.fn(async (s) => ({ ...s, hasKey: true })) } })
    render(<SettingsScreen onBack={() => {}} />)
    expect(await screen.findByDisplayValue('https://a/v1')).toBeInTheDocument()
    expect(screen.getByText('Đã lưu key')).toBeInTheDocument()
    expect(screen.queryByLabelText('API key')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Thay' }))
    await userEvent.type(screen.getByLabelText('API key'), 'sk-1')
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(api.ai.saveSettings).toHaveBeenCalledWith({ baseUrl: 'https://a/v1', model: 'm', apiKey: 'sk-1' })
    expect(await screen.findByText('Đã lưu')).toBeInTheDocument()
  })

  it('không đổi key thì không gửi trường apiKey', async () => {
    const { api } = installNexgraph({ ai: { ...configured, saveSettings: vi.fn(async (s) => ({ ...s, hasKey: true })) } })
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Lưu' }))
    expect(api.ai.saveSettings).toHaveBeenCalledWith({ baseUrl: 'https://a/v1', model: 'm' })
  })

  it('để trống key khi thay thế sẽ gửi yêu cầu xoá rõ ràng', async () => {
    const { api } = installNexgraph({ ai: { ...configured, saveSettings: vi.fn(async (s) => ({ ...s, hasKey: false })) } })
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Thay' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(api.ai.saveSettings).toHaveBeenCalledWith({ baseUrl: 'https://a/v1', model: 'm', apiKey: '' })
  })

  it('kiểm tra kết nối hiện thời gian hoặc lỗi', async () => {
    const test = vi.fn().mockResolvedValueOnce({ ok: true, ms: 420, error: null }).mockResolvedValueOnce({ ok: false, ms: 5, error: 'x' })
    installNexgraph({ ai: { ...configured, test } })
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Kiểm tra kết nối' }))
    expect(await screen.findByText('Kết nối được, 420 ms')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }))
    expect(await screen.findByText('Không kết nối được: x')).toBeInTheDocument()
  })

  it('lỗi no_keychain hiện câu noKeychain', async () => {
    installNexgraph({ ai: { saveSettings: vi.fn(async () => { throw { code: 'no_keychain', message: 'x' } }) } })
    render(<SettingsScreen onBack={() => {}} />)
    await userEvent.type(await screen.findByLabelText('API key'), 'k')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('không có kho khoá an toàn')
  })
})
