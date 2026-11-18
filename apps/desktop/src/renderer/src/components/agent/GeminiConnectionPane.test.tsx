// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { emptyGeminiStatus, installNexgraph } from '../../test-utils'
import { GeminiConnectionPane } from './GeminiConnectionPane'
import { ConnectionDialog } from './ConnectionDialog'

const connectedStatus = () => emptyGeminiStatus({ state: 'connected', installed: true, authenticated: true })
const accountSettings = { runtime: 'antigravity-cli' as const, provider: 'google-antigravity', connectionId: 'gemini-test-connection', baseUrl: '', model: 'auto', hasKey: false }
const googleModel = { runtime: 'antigravity-cli' as const, provider: 'google-antigravity', id: 'auto', label: 'Auto', pricing: 'subscription' as const }
const pane = (done = vi.fn()) => render(<GeminiConnectionPane projectId="p1" onConnected={done} onClose={vi.fn()} />)
const probe = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Kiểm tra kết nối và công cụ' }))
  await screen.findByText('Gemini đã sẵn sàng')
}

describe('Gemini Google account connection', () => {
  it('gọi danh sách là Model Antigravity khi tài khoản cung cấp model ngoài Gemini', async () => {
    installNexgraph({ gemini: {
      status: vi.fn(async () => ({ ...connectedStatus(), model: 'claude-sonnet' })),
      models: vi.fn(async () => [{ ...googleModel, id: 'claude-sonnet', label: 'Claude Sonnet' }])
    } })
    pane()
    expect(await screen.findByLabelText('Model Antigravity')).toHaveDisplayValue('Claude Sonnet')
    expect(screen.queryByLabelText('Model Gemini')).not.toBeInTheDocument()
  })

  it('cho thiết lập lại công cụ sau lỗi tải bản chính thức', async () => {
    let status = emptyGeminiStatus({ state: 'error', error: 'Không tải được công cụ Google' })
    const { api } = installNexgraph({ gemini: {
      status: vi.fn(async () => status),
      setup: vi.fn(async () => (status = emptyGeminiStatus({ state: 'signed_out', installed: true })))
    } })
    pane()
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được công cụ Google')
    await userEvent.click(screen.getByRole('button', { name: 'Thiết lập Antigravity CLI' }))
    expect(api.gemini.setup).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Đăng nhập Google' })).toBeInTheDocument()
  })

  it('cho đăng nhập lại phiên Google có lỗi, giữ hồ sơ và yêu cầu kiểm tra kết nối mới', async () => {
    let status = { ...connectedStatus(), state: 'error' as 'error' | 'connected', error: 'Phiên Google cần xác nhận lại' as string | undefined }
    const { api } = installNexgraph({ gemini: {
      status: vi.fn(async () => status),
      login: vi.fn(async () => (status = { ...connectedStatus(), connectionId: 'reauthorized-account', state: 'connected', error: undefined }))
    } })
    pane()
    expect(await screen.findByText('Cần kiểm tra lại kết nối')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Phiên Google cần xác nhận lại')
    expect(screen.queryByText('Google đã kết nối')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập lại Google' }))
    expect(api.gemini.login).toHaveBeenCalledOnce()
    expect(await screen.findByText('Google đã kết nối')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dùng tài khoản Google' })).toBeDisabled()
    expect(api.gemini.forget).not.toHaveBeenCalled()
  })

  it('thiết lập, đăng nhập, kiểm tra công cụ rồi cấp quyền đúng kết nối CLI; không gọi luồng API key', async () => {
    let status = emptyGeminiStatus()
    const { api } = installNexgraph({
      gemini: {
        status: vi.fn(async () => status),
        setup: vi.fn(async () => (status = emptyGeminiStatus({ state: 'signed_out', installed: true }))),
        login: vi.fn(async () => (status = connectedStatus())),
        models: vi.fn(async () => [googleModel])
      },
      ai: { getSettings: vi.fn(async () => accountSettings) }
    })
    const done = vi.fn()
    pane(done)
    await userEvent.click(await screen.findByRole('button', { name: 'Thiết lập Antigravity CLI' }))
    expect(api.gemini.setup).toHaveBeenCalledOnce()
    await userEvent.click(await screen.findByRole('button', { name: 'Đăng nhập Google' }))
    expect(api.gemini.login).toHaveBeenCalledOnce()
    expect(await screen.findByLabelText('Model Antigravity')).toHaveDisplayValue('Tự động')
    await probe()
    const finish = screen.getByRole('button', { name: 'Dùng tài khoản Google' })
    expect(finish).toBeDisabled()
    expect(screen.getByRole('checkbox')).toHaveAccessibleName(/ngữ cảnh và lịch sử hội thoại.*tài khoản Google hiện đang được Antigravity quản lý/)
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(finish)
    expect(api.gemini.activate).toHaveBeenCalledOnce()
    expect(api.ai.grantConsent).toHaveBeenCalledWith('p1', {
      runtime: 'antigravity-cli', provider: 'google-antigravity', connectionId: 'gemini-test-connection'
    })
    expect(done).toHaveBeenCalledOnce()
    expect(api.auth.setKey).not.toHaveBeenCalled()
    expect(api.auth.login).not.toHaveBeenCalled()
    expect(api.auth.test).not.toHaveBeenCalled()
  })

  it('thiếu xác nhận công cụ thì không tuyên bố sẵn sàng và không tự chuyển sang API key', async () => {
    const { api } = installNexgraph({ gemini: {
      status: vi.fn(async () => connectedStatus()),
      test: vi.fn(async () => ({ ok: true, message: 'Đã trả lời', capabilities: { streaming: true, tools: false } }))
    } })
    pane()
    await userEvent.click(await screen.findByRole('button', { name: 'Kiểm tra kết nối và công cụ' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác nhận được cả trả lời trực tiếp và công cụ')
    expect(screen.getByRole('button', { name: 'Dùng tài khoản Google' })).toBeDisabled()
    expect(api.gemini.activate).not.toHaveBeenCalled()
    expect(api.auth.test).not.toHaveBeenCalled()
  })

  it('kết nối đổi sau kiểm tra không được kích hoạt hoặc cấp consent cũ', async () => {
    let status = connectedStatus()
    const { api } = installNexgraph({ gemini: { status: vi.fn(async () => status) } })
    pane()
    await probe()
    await userEvent.click(screen.getByRole('checkbox'))
    status = { ...status, connectionId: 'different-account' }
    await userEvent.click(screen.getByRole('button', { name: 'Dùng tài khoản Google' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Kết nối Google đã thay đổi')
    expect(screen.queryByText('Gemini đã sẵn sàng')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dùng tài khoản Google' })).toBeDisabled()
    expect(api.gemini.activate).not.toHaveBeenCalled()
    expect(api.ai.grantConsent).not.toHaveBeenCalled()
  })

  it('đổi model phải kiểm tra và đồng ý lại trước khi dùng', async () => {
    let status = connectedStatus()
    const { api } = installNexgraph({ gemini: {
      status: vi.fn(async () => status),
      models: vi.fn(async () => [googleModel, { ...googleModel, id: 'gemini-flash', label: 'Gemini Flash' }]),
      selectModel: vi.fn(async (model) => { status = { ...status, model } })
    } })
    pane()
    await probe()
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.selectOptions(screen.getByLabelText('Model Antigravity'), 'gemini-flash')
    expect(api.gemini.selectModel).toHaveBeenCalledWith('gemini-flash')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dùng tài khoản Google' })).toBeDisabled())
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await probe()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('không mất danh sách model khi CLI công bố model thực trong lúc đang khám phá', async () => {
    let status = connectedStatus()
    let emit: ReturnType<typeof installNexgraph>['emitGemini'] = () => {}
    const fixture = installNexgraph({ gemini: {
      status: vi.fn(async () => status),
      models: vi.fn(async () => {
        status = { ...status, model: 'actual-google-model' }
        emit({ type: 'status', status })
        return [{ ...googleModel, id: 'actual-google-model', label: 'Gemini thực tế' }]
      })
    } })
    emit = fixture.emitGemini
    pane()
    expect(await screen.findByLabelText('Model Antigravity')).toHaveDisplayValue('Gemini thực tế')
    expect(screen.getByRole('option', { name: 'Gemini thực tế' })).toHaveValue('actual-google-model')
  })

  it('cập nhật trạng thái tài khoản làm mất kết quả kiểm tra cũ', async () => {
    const { emitGemini } = installNexgraph({ gemini: { status: vi.fn(async () => connectedStatus()) } })
    pane()
    await probe()
    await userEvent.click(screen.getByRole('checkbox'))
    act(() => emitGemini({ type: 'status', status: { ...connectedStatus(), connectionId: 'account-b' } }))
    expect(screen.getByRole('button', { name: 'Dùng tài khoản Google' })).toBeDisabled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('đóng hộp thoại đang đăng nhập sẽ hủy đúng luồng Gemini và gỡ đăng ký sự kiện', async () => {
    const { api, emitGemini } = installNexgraph({ gemini: {
      status: vi.fn(async () => emptyGeminiStatus({ state: 'signed_out', installed: true })),
      login: vi.fn(() => new Promise<ReturnType<typeof connectedStatus>>(() => {}))
    } })
    const view = pane()
    await userEvent.click(await screen.findByRole('button', { name: 'Đăng nhập Google' }))
    act(() => emitGemini({ type: 'auth', event: { type: 'auth_url', url: 'https://accounts.google.com/', instructions: 'Chọn tài khoản trong trình duyệt' } }))
    expect(screen.getByRole('link', { name: 'Mở lại trang xác nhận' })).toHaveAttribute('href', 'https://accounts.google.com/')
    await userEvent.click(screen.getByRole('button', { name: 'Hủy đăng nhập Google' }))
    expect(api.gemini.loginCancel).toHaveBeenCalledOnce()
    view.unmount()
    expect(api.auth.loginCancel).not.toHaveBeenCalled()
  })

  it('lỗi hạn mức tài khoản hiển thị rõ và giữ nguyên lựa chọn Google', async () => {
    const { api } = installNexgraph({ gemini: {
      status: vi.fn(async () => connectedStatus()),
      test: vi.fn(async () => ({ ok: false, message: 'Tài khoản Google đã hết hạn mức. Hãy thử lại sau.' }))
    } })
    pane()
    await userEvent.click(await screen.findByRole('button', { name: 'Kiểm tra kết nối và công cụ' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('đã hết hạn mức')
    expect(api.auth.selectModel).not.toHaveBeenCalled()
    expect(api.gemini.activate).not.toHaveBeenCalled()
  })
})

describe('Gemini connection methods', () => {
  it('API key Google vẫn lưu, chọn model, kiểm tra và dùng consent API riêng', async () => {
    const { api } = installNexgraph({
      auth: {
        list: vi.fn(async () => [{ id: 'google', label: 'Google', oauth: false, hasKey: false, loggedIn: false, custom: false, authMethods: ['api_key' as const] }]),
        models: vi.fn(async () => [{ provider: 'google', id: 'gemini-api', label: 'Gemini API' }]),
        test: vi.fn(async () => ({ ok: true, message: 'API key đã sẵn sàng' }))
      },
      ai: { getSettings: vi.fn(async () => ({ runtime: 'pi' as const, provider: 'google', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-api', hasKey: true })) }
    })
    const done = vi.fn()
    render(<ConnectionDialog projectId="p1" onConnected={done} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Gemini bằng API key' }))
    await userEvent.type(await screen.findByLabelText('API key'), 'google-test-key')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu API key' }))
    expect(api.auth.setKey).toHaveBeenCalledWith('google', 'google-test-key')
    expect(await screen.findByLabelText('Model')).toHaveValue('gemini-api')
    await userEvent.click(screen.getByRole('button', { name: 'Kiểm tra kết nối và công cụ' }))
    await screen.findByText('API key đã sẵn sàng')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Dùng kết nối' }))
    expect(api.ai.grantConsent).toHaveBeenCalledWith('p1', { provider: 'google', baseUrl: 'https://generativelanguage.googleapis.com' })
    expect(done).toHaveBeenCalledOnce()
    expect(api.gemini.login).not.toHaveBeenCalled()
    expect(api.gemini.test).not.toHaveBeenCalled()
  })
})
