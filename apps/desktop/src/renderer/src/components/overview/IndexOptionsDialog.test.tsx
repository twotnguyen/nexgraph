// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { IndexOptionsDialog } from './IndexOptionsDialog'

describe('IndexOptionsDialog', () => {
  it('mặc định: số tiến trình tự chọn, không index lại từ đầu, không gồm tệp cấu hình', async () => {
    installNexgraph()
    const onSubmit = vi.fn()
    render(<IndexOptionsDialog onSubmit={onSubmit} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Index lại với tuỳ chọn này' }))
    expect(onSubmit).toHaveBeenCalledWith({ exclude: [], includeDocs: false, includeMedia: false, includeConfig: false, force: false })
  })

  it('gửi số tiến trình, index lại từ đầu và tệp cấu hình khi người dùng chọn', async () => {
    installNexgraph()
    const onSubmit = vi.fn()
    render(<IndexOptionsDialog onSubmit={onSubmit} onClose={() => {}} />)
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Số tiến trình' }), '2')
    await userEvent.click(screen.getByRole('checkbox', { name: /Index lại từ đầu/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Tệp cấu hình/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Index lại với tuỳ chọn này' }))
    expect(onSubmit).toHaveBeenCalledWith({ exclude: [], includeDocs: false, includeMedia: false, includeConfig: true, force: true, workers: 2 })
  })

  it('chỉ dẫn ánh xạ đuôi tệp qua .graphifyrc', () => {
    installNexgraph()
    render(<IndexOptionsDialog onSubmit={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/\.graphifyrc/)).toBeInTheDocument()
  })
})
