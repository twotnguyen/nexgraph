// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setLocale } from '../../state/locale'
import type { GitStatus, NexGraphApi } from '@shared/api'
import { installNexgraph } from '../../test-utils'
import { GitPanel } from './GitPanel'

vi.mock('./GitHistory', () => ({ GitHistory: () => <div>Lịch sử commit</div> }))
vi.mock('./BranchPicker', () => ({ BranchPicker: () => null }))
vi.mock('./StashSection', () => ({ StashSection: () => null }))


beforeEach(() => localStorage.clear())
afterEach(() => setLocale('vi'))
const status: GitStatus = {
  repo: true, branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, remote: 'origin',
  staged: [{ path: 'staged.txt', status: 'M', added: 2, deleted: 1 }],
  unstaged: [{ path: 'new.txt', status: '?', added: 3, deleted: 0 }],
  conflicts: [{ path: 'conflict.txt', status: 'U' }],
  lastCommit: { sha: 'abc', subject: 'trước đó', message: 'trước đó', hasParent: true, pushed: false }
}

function setup(next: GitStatus = status, projectId = 'p1') {
  installNexgraph()
  const git = {
    status: vi.fn(async () => next), stage: vi.fn(async () => {}), unstage: vi.fn(async () => {}),
    commit: vi.fn(async () => '123456'), restore: vi.fn(async () => {}),
    remote: vi.fn(async () => 'ok')
  }
  ;(window.nexgraph as NexGraphApi).git = git as unknown as NonNullable<NexGraphApi['git']>
  const onOpenFile = vi.fn()
  const onOpenDiff = vi.fn()
  const view = render(<GitPanel projectId={projectId} onOpenDiff={onOpenDiff} onOpenFile={onOpenFile} />)
  return { git, onOpenFile, onOpenDiff, unmount: view.unmount, rerender: view.rerender }
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
  expect(screen.getByRole('menuitem', { name: 'Sửa commit cuối' })).toBeDisabled()
  expect(git.commit).not.toHaveBeenCalled()
})

it('bật amend và commit dùng thông điệp commit cuối', async () => {
  const { git } = setup({ ...status, conflicts: [] })
  await screen.findByText('staged.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn commit' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sửa commit cuối' }))
  expect(screen.getByLabelText('Thông điệp commit')).toHaveValue('trước đó')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: 'Sửa commit cuối 1 tệp' }))
  expect(git.commit).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: 'Sửa commit cuối 1 tệp' }))
  await waitFor(() => expect(git.commit).toHaveBeenCalledWith('p1', 'trước đó', true, []))
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

it('toast lỗi Git giữ khoá Msg nên đổi ngôn ngữ đổi câu tại chỗ', async () => {
  const { git, rerender } = setup()
  await screen.findByText('new.txt')
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  git.restore.mockRejectedValueOnce({ code: 'git_failed', message: 'Engine chưa sẵn sàng.' })
  fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi new.txt' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Engine chưa sẵn sàng.')
  setLocale('en')
  rerender(<GitPanel projectId="p1" onOpenDiff={vi.fn()} onOpenFile={vi.fn()} />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The engine is not ready yet.'))
  confirm.mockRestore()
})

it('menu remote chỉ cung cấp fetch, pull và push', async () => {
  setup()
  await screen.findByText('staged.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Tác vụ remote' }))
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Lấy về', 'Kéo về', 'Đẩy lên'])
})

it('nhãn Git ở English giữ thuật ngữ Git', async () => {
  setLocale('en')
  setup()
  await screen.findByText('staged.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Remote actions' }))
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Fetch', 'Pull', 'Push'])
})

it('chuyển tab Lịch sử rồi trở lại Tệp thay đổi', async () => {
  setup()
  await screen.findByText('staged.txt')
  fireEvent.click(screen.getByRole('tab', { name: 'Lịch sử' }))
  expect(screen.getByText('Lịch sử commit')).toBeInTheDocument()
  expect(screen.queryByText('staged.txt')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /Tệp thay đổi/ }))
  expect(screen.getByText('staged.txt')).toBeInTheDocument()
})

it('giữ tuỳ chọn hiển thị qua localStorage khi reload panel', async () => {
  const { unmount } = setup()
  await screen.findByText('staged.txt')
  for (const name of ['List', 'Sort: Name', 'Group By: Directory']) {
    fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn hiển thị' }))
    fireEvent.click(screen.getByRole('menuitem', { name }))
  }
  expect(JSON.parse(localStorage.getItem('nexgraph.git.view:p1')!)).toEqual({ layout: 'list', sort: 'name', group: 'directory' })
  unmount()
  setup()
  await screen.findByText('staged.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn hiển thị' }))
  expect(screen.getByRole('menuitem', { name: '✓ List' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: '✓ Sort: Name' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: '✓ Group By: Directory' })).toBeInTheDocument()
})

it('giữ nhãn và dấu ✓ của tuỳ chọn hiển thị ở cả hai locale', async () => {
  for (const locale of ['vi', 'en'] as const) {
    setLocale(locale)
    const { unmount } = setup()
    await screen.findByText('staged.txt')
    fireEvent.click(screen.getByRole('button', { name: locale === 'vi' ? 'Tuỳ chọn hiển thị' : 'Display options' }))
    for (const name of ['List', 'Tree', 'Sort: Path', 'Sort: Name', 'Group By: None', 'Group By: Status', 'Group By: Directory']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('menuitem').some((item) => item.textContent?.includes('✓'))).toBe(true)
    unmount()
  }
})

it('giữ draft commit theo repo và không tràn sang repo khác', async () => {
  const { rerender, onOpenDiff, onOpenFile } = setup()
  await screen.findByLabelText('Thông điệp commit')
  fireEvent.change(screen.getByLabelText('Thông điệp commit'), { target: { value: 'nhắn p1' } })
  expect(localStorage.getItem('nexgraph.git.draft:p1')).toBe('nhắn p1')
  rerender(<GitPanel projectId="p2" onOpenDiff={onOpenDiff} onOpenFile={onOpenFile} />)
  expect(screen.getByLabelText('Thông điệp commit')).toHaveValue('')
  expect(localStorage.getItem('nexgraph.git.draft:p2')).toBeNull()
  rerender(<GitPanel projectId="p1" onOpenDiff={onOpenDiff} onOpenFile={onOpenFile} />)
  expect(screen.getByLabelText('Thông điệp commit')).toHaveValue('nhắn p1')
})

it('split button Stage All gọi đúng API và menu không có mục Clean', async () => {
  const { git } = setup()
  await screen.findByText('staged.txt')
  const toolbar = document.querySelector('.git-toolbar') as HTMLElement
  fireEvent.click(within(toolbar).getByRole('button', { name: 'Stage tất cả' }))
  await waitFor(() => expect(git.stage).toHaveBeenCalledWith('p1', ['new.txt']))
  fireEvent.click(screen.getByRole('button', { name: 'Tác vụ thay đổi' }))
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).not.toContain('Clean')
  fireEvent.click(screen.getByRole('menuitem', { name: 'Bỏ stage tất cả' }))
  await waitFor(() => expect(git.unstage).toHaveBeenCalledWith('p1', ['staged.txt']))
})

it('Xem diff mở diff mọi thay đổi và đưa xung đột vào editor', async () => {
  const { onOpenDiff, onOpenFile } = setup()
  await screen.findByText('staged.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Xem diff' }))
  expect(onOpenDiff).toHaveBeenCalledWith('staged.txt', true)
  expect(onOpenDiff).toHaveBeenCalledWith('new.txt', false)
  expect(onOpenFile).toHaveBeenCalledWith('conflict.txt')
})

it('chỉ bật nút tạo thông điệp bằng AI sau khi bật trong tuỳ chọn commit', async () => {
  setup()
  await screen.findByText('staged.txt')
  expect(screen.getByRole('button', { name: 'Viết thông điệp commit' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn commit' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Tạo thông điệp bằng AI' }))
  expect(screen.getByRole('button', { name: 'Viết thông điệp commit' })).not.toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn commit' }))
  expect(screen.getByRole('menuitem', { name: '✓ Tạo thông điệp bằng AI' })).toBeInTheDocument()
})

it('phóng to rồi thu nhỏ ô thông điệp commit', async () => {
  setup()
  const editor = await screen.findByLabelText('Thông điệp commit')
  expect(editor).toHaveAttribute('rows', '3')
  fireEvent.click(screen.getByRole('button', { name: 'Phóng to' }))
  expect(screen.getByLabelText('Thông điệp commit')).toHaveAttribute('rows', '10')
  fireEvent.click(screen.getByRole('button', { name: 'Thu nhỏ' }))
  expect(screen.getByLabelText('Thông điệp commit')).toHaveAttribute('rows', '3')
})

const mmStatus: GitStatus = {
  ...status,
  staged: [{ path: 'both.txt', status: 'M', added: 1 }],
  unstaged: [{ path: 'both.txt', status: 'M', added: 2 }],
  conflicts: []
}

it('MM: dòng chưa stage mở diff unstaged và gọi stage, dòng đã stage mở diff staged', async () => {
  const { git, onOpenDiff } = setup(mmStatus)
  await screen.findAllByText('both.txt')
  const staged = screen.getByRole('region', { name: 'Đã stage' })
  const unstaged = screen.getByRole('region', { name: 'Tệp thay đổi' })
  const stagedBox = within(staged).getByRole('checkbox')
  const unstagedBox = within(unstaged).getByRole('checkbox')
  expect(stagedBox).toBeChecked()
  expect(unstagedBox).not.toBeChecked()
  expect(within(unstaged).getByRole('button', { name: 'Bỏ thay đổi both.txt' })).toBeInTheDocument()
  expect(within(staged).queryByRole('button', { name: 'Bỏ thay đổi both.txt' })).not.toBeInTheDocument()

  fireEvent.click(within(unstaged).getByRole('button', { name: 'both.txt' }))
  expect(onOpenDiff).toHaveBeenLastCalledWith('both.txt', false)
  fireEvent.click(within(staged).getByRole('button', { name: 'both.txt' }))
  expect(onOpenDiff).toHaveBeenLastCalledWith('both.txt', true)

  fireEvent.click(unstagedBox)
  await waitFor(() => expect(git.stage).toHaveBeenCalledWith('p1', ['both.txt']))
  expect(git.unstage).not.toHaveBeenCalled()
  await waitFor(() => expect(stagedBox).not.toBeDisabled())
  fireEvent.click(stagedBox)
  await waitFor(() => expect(git.unstage).toHaveBeenCalledWith('p1', ['both.txt']))
})

it('Xem diff mở cả hai diff đã stage và chưa stage cho cùng một path MM', async () => {
  const { onOpenDiff } = setup(mmStatus)
  await screen.findAllByText('both.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Xem diff' }))
  expect(onOpenDiff).toHaveBeenCalledWith('both.txt', true)
  expect(onOpenDiff).toHaveBeenCalledWith('both.txt', false)
  expect(onOpenDiff).toHaveBeenCalledTimes(2)
})

it('Group By None giữ hai dòng MM với khoá riêng và mở đúng diff từng dòng', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { onOpenDiff } = setup(mmStatus)
  await screen.findAllByText('both.txt')
  fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn hiển thị' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Group By: None' }))
  const group = screen.getByRole('region', { name: 'Tệp thay đổi' })
  const boxes = within(group).getAllByRole('checkbox')
  expect(boxes).toHaveLength(2)
  expect(boxes[0]).toBeChecked()
  expect(boxes[1]).not.toBeChecked()
  const fileButtons = within(group).getAllByRole('button', { name: 'both.txt' })
  expect(fileButtons).toHaveLength(2)
  fireEvent.click(fileButtons[0])
  expect(onOpenDiff).toHaveBeenLastCalledWith('both.txt', true)
  fireEvent.click(fileButtons[1])
  expect(onOpenDiff).toHaveBeenLastCalledWith('both.txt', false)
  expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/i)
  errors.mockRestore()
})

it('bật đồng tác giả thì commit gửi đúng danh sách và giữ nhập liệu theo repo', async () => {
  const { git, unmount } = setup({ ...status, conflicts: [] })
  await screen.findByText('staged.txt')
  fireEvent.change(screen.getByLabelText('Thông điệp commit'), { target: { value: 'msg' } })
  fireEvent.click(screen.getByLabelText('Thêm đồng tác giả'))
  fireEvent.change(screen.getByLabelText('Tên và email đồng tác giả'), { target: { value: 'Bình <b@example.com>' } })
  fireEvent.click(screen.getByRole('button', { name: /^Tạo commit/ }))
  await waitFor(() => expect(git.commit).toHaveBeenCalledWith('p1', 'msg', false, ['Bình <b@example.com>']))
  unmount()
  setup({ ...status, conflicts: [] })
  expect(screen.getByLabelText('Thêm đồng tác giả')).toBeChecked()
  expect(screen.getByLabelText('Tên và email đồng tác giả')).toHaveValue('Bình <b@example.com>')
})

it('tắt đồng tác giả thì commit không gửi co-author dù ô nhập có giá trị', async () => {
  const { git } = setup({ ...status, conflicts: [] })
  await screen.findByText('staged.txt')
  fireEvent.change(screen.getByLabelText('Thông điệp commit'), { target: { value: 'msg' } })
  fireEvent.change(screen.getByLabelText('Tên và email đồng tác giả'), { target: { value: 'Bình <b@example.com>' } })
  fireEvent.click(screen.getByRole('button', { name: /^Tạo commit/ }))
  await waitFor(() => expect(git.commit).toHaveBeenCalledWith('p1', 'msg', false, []))
})
