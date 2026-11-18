// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { emptyGeminiStatus, installNexgraph } from '../../test-utils'
import { GeminiAccountSettingsCard } from './GeminiAccountSettingsCard'

describe('GeminiAccountSettingsCard', () => {
  it('không báo đang dùng khi có thông tin đăng nhập cũ nhưng kết nối Google đang lỗi', async () => {
    installNexgraph({ gemini: { status: vi.fn(async () => emptyGeminiStatus({ state: 'error', authenticated: true, installed: true, error: 'Phiên Google cần xác nhận lại' })) } })
    render(<GeminiAccountSettingsCard active onConnect={vi.fn()} onApiKey={vi.fn()} onDisconnected={vi.fn()} />)
    expect(await screen.findByText('Cần kiểm tra lại kết nối')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Phiên Google cần xác nhận lại')
    expect(screen.queryByText('Đang dùng tài khoản Google')).not.toBeInTheDocument()
  })

  it('phân biệt rõ tài khoản Google với API key và không tuyên bố đã xác minh gói Pro', async () => {
    installNexgraph({ gemini: { status: vi.fn(async () => emptyGeminiStatus({ state: 'connected', authenticated: true, installed: true })) } })
    const connect = vi.fn(), apiKey = vi.fn()
    render(<GeminiAccountSettingsCard active onConnect={connect} onApiKey={apiKey} onDisconnected={vi.fn()} />)
    expect(await screen.findByText('Đang dùng tài khoản Google')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Quản lý kết nối Google' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dùng Gemini API key' }))
    expect(connect).toHaveBeenCalledOnce()
    expect(apiKey).toHaveBeenCalledOnce()
    expect(screen.getByText(/Model và hạn mức do Google quyết định theo tài khoản/)).toBeInTheDocument()
  })

  it('ngắt phiên Gemini không xóa hồ sơ Google và không đăng xuất nhà cung cấp API', async () => {
    const { api } = installNexgraph({ gemini: { status: vi.fn(async () => emptyGeminiStatus({ state: 'connected', authenticated: true, installed: true })) } })
    const disconnected = vi.fn()
    render(<GeminiAccountSettingsCard active onConnect={vi.fn()} onApiKey={vi.fn()} onDisconnected={disconnected} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ngắt kết nối NexGraph' }))
    expect(api.gemini.disconnect).toHaveBeenCalledOnce()
    expect(disconnected).toHaveBeenCalledOnce()
    expect(api.gemini.forget).not.toHaveBeenCalled()
    expect(api.auth.logout).not.toHaveBeenCalled()
    expect(api.auth.removeKey).not.toHaveBeenCalled()
  })

  it('khôi phục sau lỗi trạng thái khi nhận kết nối mới', async () => {
    const { emitGemini } = installNexgraph({ gemini: { status: vi.fn(async () => { throw new Error('Không đọc được công cụ Gemini') }) } })
    render(<GeminiAccountSettingsCard active={false} onConnect={vi.fn()} onApiKey={vi.fn()} onDisconnected={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được công cụ Gemini')
    act(() => emitGemini({ type: 'status', status: emptyGeminiStatus({ state: 'connected', authenticated: true, installed: true }) }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Đã có kết nối Google')).toBeInTheDocument()
  })
})
