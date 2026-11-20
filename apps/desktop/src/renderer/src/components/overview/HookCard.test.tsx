// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph, project } from '../../test-utils'
import { HookCard } from './HookCard'

const PREVIEW = ['post-commit', 'post-checkout', 'post-merge', 'post-rewrite'].map((n) => `/p/.git/hooks/${n}\n# >>> nexgraph >>>`).join('\n')
const setup = (status: 'no_git' | 'off' | 'on' | 'outdated' | 'outside_repo') => {
  const h = installNexgraph({ hook: { status: vi.fn(async () => status), preview: vi.fn(async () => PREVIEW) } })
  render(<HookCard project={project()} />)
  return h
}

describe('HookCard', () => {
  it('off: hiện "Chưa bật"; bấm thì có xem trước và nút Bật gọi install', async () => {
    const { api } = setup('off')
    expect(await screen.findByText('Chưa bật')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Tự cập nhật theo Git/ }))
    expect(await screen.findByText(/\/p\/\.git\/hooks\/post-rewrite/)).toBeInTheDocument()
    expect(screen.getByText(/post-commit, post-checkout, post-merge, post-rewrite/)).toBeInTheDocument()
    expect(screen.getByText(/đổi nhánh, merge và rebase/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Bật' }))
    expect(api.hook.install).toHaveBeenCalledWith(expect.any(String))
  })

  it('on: hiện nút Tắt gọi uninstall', async () => {
    const { api } = setup('on')
    await userEvent.click(await screen.findByRole('button', { name: /Tự cập nhật theo Git/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Tắt' }))
    expect(api.hook.uninstall).toHaveBeenCalled()
  })

  it('no_git: thẻ vô hiệu với câu noGit', async () => {
    setup('no_git')
    expect(await screen.findByText('Dự án không phải kho Git')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tự cập nhật theo Git/ })).toBeDisabled()
  })

  it('outdated: hiện câu cần cài lại', async () => {
    setup('outdated')
    expect(await screen.findByText('Hook cũ, thiếu hoặc đường dẫn engine đã đổi, cần cài lại')).toBeInTheDocument()
  })

  it('outside_repo: câu dễ hiểu, thẻ vô hiệu, không hiện lỗi kỹ thuật', async () => {
    setup('outside_repo')
    expect(await screen.findByText(/core.hooksPath trỏ ra ngoài kho/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tự cập nhật theo Git/ })).toBeDisabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
