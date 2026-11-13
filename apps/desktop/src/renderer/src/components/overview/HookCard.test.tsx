// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph, project } from '../../test-utils'
import { HookCard } from './HookCard'

const setup = (status: 'no_git' | 'off' | 'on' | 'outdated') => {
  const h = installNexgraph({ hook: { status: vi.fn(async () => status) } })
  render(<HookCard project={project()} />)
  return h
}

describe('HookCard', () => {
  it('off: hiện "Chưa bật"; bấm thì có xem trước và nút Bật gọi install', async () => {
    const { api } = setup('off')
    expect(await screen.findByText('Chưa bật')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Cập nhật sau mỗi commit/ }))
    expect(await screen.findByText('# >>> nexgraph >>>')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Bật' }))
    expect(api.hook.install).toHaveBeenCalledWith(expect.any(String))
  })

  it('on: hiện nút Tắt gọi uninstall', async () => {
    const { api } = setup('on')
    await userEvent.click(await screen.findByRole('button', { name: /Cập nhật sau mỗi commit/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Tắt' }))
    expect(api.hook.uninstall).toHaveBeenCalled()
  })

  it('no_git: thẻ vô hiệu với câu noGit', async () => {
    setup('no_git')
    expect(await screen.findByText('Dự án không phải kho Git')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Cập nhật sau mỗi commit/ })).toBeDisabled()
  })

  it('outdated: hiện câu cần cài lại', async () => {
    setup('outdated')
    expect(await screen.findByText('Đường dẫn engine đã đổi, cần cài lại')).toBeInTheDocument()
  })
})
