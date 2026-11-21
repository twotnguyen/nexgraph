// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitWorktree } from '@shared/api'
import { WorktreePicker } from './WorktreePicker'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const wt = (over: Partial<GitWorktree>): GitWorktree => ({
  path: '/code/app', head: 'a'.repeat(40), branch: 'main', detached: false, locked: false, prunable: false, main: true, current: true, ...over
})
const main = wt({})
const feat = wt({ path: '/code/app-worktrees/feat-x', head: 'b'.repeat(40), branch: 'feat/x', main: false, current: false })

function setup(over: Record<string, unknown> = {}) {
  const git = {
    worktrees: vi.fn(async () => [main, feat]), branches: vi.fn(async () => ['main', 'feat/x', 'topic']),
    worktreeAdd: vi.fn(async () => '/code/app-worktrees/topic'), worktreeRemove: vi.fn(async () => {}), ...over
  }
  Object.assign(window, { nexgraph: { git } })
  const onOpen = vi.fn()
  const onClose = vi.fn()
  render(<WorktreePicker projectId="p1" onOpen={onOpen} onClose={onClose} />)
  return { git, onOpen, onClose }
}

describe('WorktreePicker', () => {
  it('mở worktree khác làm dự án rồi đóng; chọn worktree đang mở chỉ đóng', async () => {
    const { onOpen, onClose } = setup()
    fireEvent.click(await screen.findByRole('option', { name: /đang mở/ }))
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('option', { name: /feat-x/ }))
    expect(onOpen).toHaveBeenCalledWith('/code/app-worktrees/feat-x')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('không mở worktree đã mất thư mục, báo lỗi và giữ picker', async () => {
    const { onOpen, onClose } = setup({ worktrees: vi.fn(async () => [main, { ...feat, prunable: true }]) })
    fireEvent.click(await screen.findByRole('option', { name: /feat-x/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('không còn trên đĩa')
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('gõ tên: nhánh có sẵn → tạo cho nhánh đó, tên mới (dấu cách thành -) → nhánh mới, nhánh đã ở worktree khác → không có dòng tạo', async () => {
    const { git, onOpen, onClose } = setup()
    await screen.findByRole('option', { name: /feat-x/ })
    const input = screen.getByRole('combobox', { name: 'Worktree' })
    fireEvent.change(input, { target: { value: 'feat/x' } })
    expect(screen.queryByText(/Tạo worktree/)).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'feat y' } })
    expect(screen.getByRole('option', { name: /nhánh mới “feat-y” từ HEAD/ })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'topic' } })
    expect(screen.queryByText(/nhánh mới/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /nhánh có sẵn “topic”/ }))
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('/code/app-worktrees/topic'))
    expect(git.worktreeAdd).toHaveBeenCalledWith('p1', 'topic', true)
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.change(input, { target: { value: 'fresh' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(git.worktreeAdd).toHaveBeenLastCalledWith('p1', 'fresh', false))
  })

  it('đang tạo thì Enter và Esc không làm gì thêm, xong mới mở và đóng', async () => {
    let finish!: (path: string) => void
    const worktreeAdd = vi.fn(() => new Promise<string>((resolve) => { finish = resolve }))
    const { onOpen, onClose } = setup({ worktreeAdd })
    await screen.findByRole('option', { name: /feat-x/ })
    const input = screen.getByRole('combobox', { name: 'Worktree' })
    fireEvent.change(input, { target: { value: 'topic' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(worktreeAdd).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(onOpen).not.toHaveBeenCalled()
    await act(async () => finish('/code/app-worktrees/topic'))
    expect(onOpen).toHaveBeenCalledWith('/code/app-worktrees/topic')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lỗi khi tạo hiện trong hộp, không mở và không đóng', async () => {
    const worktreeAdd = vi.fn(async () => { throw { code: 'git_failed', message: 'fatal: branch exists' } })
    const { onOpen, onClose } = setup({ worktreeAdd })
    await screen.findByRole('option', { name: /feat-x/ })
    fireEvent.change(screen.getByRole('combobox', { name: 'Worktree' }), { target: { value: 'topic' } })
    fireEvent.click(screen.getByRole('option', { name: /nhánh có sẵn “topic”/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('fatal: branch exists')
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('xóa cần xác nhận; lỗi dirty hiện trong hộp và giữ dòng; thử lại thành công thì tải lại danh sách', async () => {
    const worktrees = vi.fn().mockResolvedValueOnce([main, feat]).mockResolvedValue([main])
    const worktreeRemove = vi.fn()
      .mockRejectedValueOnce({ code: 'worktree_dirty', message: 'Worktree còn thay đổi chưa commit' })
      .mockResolvedValueOnce(undefined)
    const { onClose } = setup({ worktrees, worktreeRemove })
    fireEvent.mouseMove(await screen.findByRole('option', { name: /feat-x/ }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Xóa worktree' }))
    expect(worktreeRemove).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Xóa worktree' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Worktree còn thay đổi chưa commit')
    expect(screen.getByRole('option', { name: /feat-x/ })).toBeInTheDocument()
    expect(worktrees).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Xóa worktree' }))
    await waitFor(() => expect(screen.queryByRole('option', { name: /feat-x/ })).not.toBeInTheDocument())
    expect(worktreeRemove).toHaveBeenLastCalledWith('p1', '/code/app-worktrees/feat-x')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('không cho xóa worktree chính, worktree đang mở hoặc đang bị khóa', async () => {
    const locked = wt({ path: '/code/app-worktrees/lock', branch: 'lock', main: false, current: false, locked: true })
    setup({ worktrees: vi.fn(async () => [main, locked]) })
    await screen.findByRole('option', { name: /lock/ })
    expect(screen.getByRole('button', { name: 'Xóa worktree' })).toBeDisabled()
    fireEvent.mouseMove(screen.getByRole('option', { name: /lock/ }))
    expect(screen.getByRole('button', { name: 'Xóa worktree' })).toBeDisabled()
  })

  it('không đưa ra dòng tạo khi chưa tải được danh sách', async () => {
    setup({ worktrees: vi.fn(async () => { throw { message: 'fatal: not a git repository' } }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('not a git repository')
    fireEvent.change(screen.getByRole('combobox', { name: 'Worktree' }), { target: { value: 'new-branch' } })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })
})
