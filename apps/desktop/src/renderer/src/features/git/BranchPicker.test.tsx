// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BranchPicker } from './BranchPicker'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function setup(
  branches: (projectId: string) => Promise<string[]> = vi.fn(async () => ['main', 'feature/existing']),
  switchBranch: (projectId: string, name: string, create: boolean) => Promise<void> = vi.fn(async () => {})
) {
  Object.assign(window, { nexgraph: { git: { branches, switchBranch } } })
  const onChanged = vi.fn()
  const onClose = vi.fn()
  const view = render(<BranchPicker projectId="p1" onClose={onClose} onChanged={onChanged} />)
  return { branches, switchBranch, onChanged, onClose, ...view }
}

describe('BranchPicker', () => {
  it('switches an existing branch only once and notifies after it finishes', async () => {
    let finish!: () => void
    const switchBranch = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const events = vi.spyOn(window, 'dispatchEvent')
    const { onChanged, onClose } = setup(undefined, switchBranch)
    fireEvent.click(await screen.findByRole('option', { name: 'main' }))
    const input = screen.getByRole('combobox', { name: 'Chuyển nhánh' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(switchBranch).toHaveBeenCalledTimes(1)
    expect(switchBranch).toHaveBeenCalledWith('p1', 'main', false)
    expect(onClose).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
    await act(async () => finish())
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    const change = events.mock.calls.map(([event]) => event).find((event) => event.type === 'nexgraph:git-changed') as CustomEvent
    expect(change.detail).toBe('p1')
  })

  it('offers creation from HEAD even when other branches match, but not for an exact branch', async () => {
    const { switchBranch } = setup()
    await screen.findByRole('option', { name: 'main' })
    const input = screen.getByRole('combobox', { name: 'Chuyển nhánh' })
    fireEvent.change(input, { target: { value: 'feature/existing' } })
    expect(screen.queryByText(/Tạo nhánh/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('feature/existing')
    fireEvent.change(input, { target: { value: 'feature' } })
    fireEvent.click(screen.getByRole('option', { name: /Tạo nhánh.*feature.*HEAD/ }))
    await waitFor(() => expect(switchBranch).toHaveBeenCalledWith('p1', 'feature', true))
  })

  it('shows dirty-worktree switch errors without closing or reporting success', async () => {
    const switchBranch = vi.fn(async () => { throw { message: 'Thay đổi chưa commit sẽ bị ghi đè' } })
    const { onChanged, onClose } = setup(undefined, switchBranch)
    fireEvent.click(await screen.findByRole('option', { name: 'main' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Thay đổi chưa commit sẽ bị ghi đè')
    expect(screen.getByRole('combobox', { name: 'Chuyển nhánh' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('does not offer creation when branches cannot be loaded', async () => {
    const branches = vi.fn(async () => { throw { message: 'Không đọc được nhánh' } })
    setup(branches)
    expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được nhánh')
    fireEvent.change(screen.getByRole('combobox', { name: 'Chuyển nhánh' }), { target: { value: 'new-branch' } })
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('does not close or notify the new project when an old switch finishes', async () => {
    let finish!: () => void
    const switchBranch = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const branches = vi.fn(async (id: string) => id === 'p1' ? ['main'] : ['other'])
    const { rerender, onChanged, onClose } = setup(branches, switchBranch)
    fireEvent.click(await screen.findByRole('option', { name: 'main' }))
    rerender(<BranchPicker projectId="p2" onClose={onClose} onChanged={onChanged} />)
    await act(async () => finish())
    expect(await screen.findByRole('option', { name: 'other' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })
})
