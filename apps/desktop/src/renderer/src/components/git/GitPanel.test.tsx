// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { GitStatus, NexGraphApi } from '@shared/api'
import { installNexgraph } from '../../test-utils'
import { GitPanel } from './GitPanel'

vi.mock('./GitHistory', () => ({ GitHistory: () => <div>Lịch sử commit</div> }))
vi.mock('./BranchPicker', () => ({ BranchPicker: () => null }))
vi.mock('./StashSection', () => ({ StashSection: () => null }))

const status: GitStatus = {
  repo: true, branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, remote: 'origin',
  staged: [{ path: 'staged.txt', status: 'M', added: 2, deleted: 1 }],
  unstaged: [{ path: 'new.txt', status: '?', added: 3, deleted: 0 }],
  conflicts: [{ path: 'conflict.txt', status: 'U' }],
  lastCommit: { sha: 'abc', subject: 'trước đó', message: 'trước đó', hasParent: true, pushed: false }
}

function setup(next: GitStatus = status) {
  installNexgraph()
  const git = {
    status: vi.fn(async () => next), stage: vi.fn(async () => {}), unstage: vi.fn(async () => {}),
    commit: vi.fn(async () => '123456'), restore: vi.fn(async () => {}),
    remote: vi.fn(async () => 'ok')
  }
  ;(window.nexgraph as NexGraphApi).git = git as unknown as NonNullable<NexGraphApi['git']>
  const onOpenFile = vi.fn()
  const onOpenDiff = vi.fn()
  render(<GitPanel projectId="p1" onOpenDiff={onOpenDiff} onOpenFile={onOpenFile} />)
  return { git, onOpenFile, onOpenDiff }
}

it('stage tất cả bỏ qua xung đột và mở tệp xung đột trong editor', async () => {
  const { git, onOpenFile } = setup()
  await screen.findByText('conflict.txt')
  const toolbar = document.querySelector('.git-toolbar') as HTMLElement
  fireEvent.click(within(toolbar).getByRole('button', { name: 'Stage tất cả' }))
  await waitFor(() => expect(git.stage).toHaveBeenCalledWith('p1', ['new.txt']))
  fireEvent.click(screen.getByText('conflict.txt'))
  expect(onOpenFile).toHaveBeenCalledWith('conflict.txt')
  expect(screen.getByText('+3')).toBeInTheDocument()
})

it('giữ tuỳ chọn Amend tắt khi commit cuối đã biết trên remote', async () => {
  const { git } = setup({ ...status, conflicts: [], lastCommit: { ...status.lastCommit!, pushed: true } })
  await screen.findByText('staged.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn commit' }))
  expect(screen.getByRole('menuitem', { name: 'Amend' })).toBeDisabled()
  expect(git.commit).not.toHaveBeenCalled()
})

it('bật amend và commit dùng thông điệp commit cuối', async () => {
  const { git } = setup({ ...status, conflicts: [] })
  await screen.findByText('staged.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn commit' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Amend' }))
  expect(screen.getByLabelText('Thông điệp commit')).toHaveValue('trước đó')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Amend 1 tệp' }))
  expect(git.commit).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Amend 1 tệp' }))
  await waitFor(() => expect(git.commit).toHaveBeenCalledWith('p1', 'trước đó', true))
  confirm.mockRestore()
})

it('yêu cầu xác nhận trước khi bỏ thay đổi và đưa lỗi IPC ra toast', async () => {
  const { git } = setup()
  await screen.findByText('new.txt')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi new.txt' }))
  expect(git.restore).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  git.restore.mockRejectedValueOnce({ code: 'git_failed', message: 'không thể chuyển vào Thùng rác' })
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi new.txt' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('không thể chuyển vào Thùng rác')
  confirm.mockRestore()
})

it('menu remote chỉ cung cấp fetch, pull và push', async () => {
  setup()
  await screen.findByText('staged.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Tác vụ remote' }))
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Fetch', 'Pull', 'Push'])
})
