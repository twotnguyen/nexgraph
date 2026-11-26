// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StashSection } from './StashSection'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function setup(over: {
  stashes?: (projectId: string) => Promise<{ ref: string; message: string }[]>
  stashSave?: (projectId: string, message: string) => Promise<void>
  stashAction?: (projectId: string, ref: string, action: 'apply' | 'pop' | 'drop') => Promise<void>
} = {}) {
  const stashes = vi.fn(over.stashes ?? (async (_projectId: string) => [{ ref: 'stash@{0}', message: 'Làm dở' }]))
  const stashSave = vi.fn(over.stashSave ?? (async (_projectId: string, _message: string) => {}))
  const stashAction = vi.fn(over.stashAction ?? (async (_projectId: string, _ref: string, _action: 'apply' | 'pop' | 'drop') => {}))
  Object.assign(window, { nexgraph: { git: { stashes, stashSave, stashAction } } })
  const onChanged = vi.fn()
  const view = render(<StashSection projectId="p1" onChanged={onChanged} />)
  return { stashes, stashSave, stashAction, onChanged, ...view }
}

async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: 'Thao tác stash@{0}' }))
}

describe('StashSection', () => {
  it('saves an optional message, refreshes the list, and notifies the project', async () => {
    const events = vi.spyOn(window, 'dispatchEvent')
    const { stashes, stashSave, onChanged } = setup()
    await screen.findByText('Làm dở')
    fireEvent.change(screen.getByRole('textbox', { name: 'Thông điệp stash' }), { target: { value: '  đang làm  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Lưu stash' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(stashSave).toHaveBeenCalledWith('p1', 'đang làm')
    expect(stashes).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('textbox', { name: 'Thông điệp stash' })).toHaveValue('')
    const change = events.mock.calls.map(([event]) => event).find((event) => event.type === 'nexgraph:git-changed') as CustomEvent
    expect(change.detail).toBe('p1')
  })

  it.each([['Áp dụng', 'apply'], ['Áp dụng và xóa', 'pop']] as const)('%s a selected stash', async (label, action) => {
    const { stashAction, onChanged } = setup()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: label }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(stashAction).toHaveBeenCalledWith('p1', 'stash@{0}', action)
  })

  it('never drops a stash without confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { stashAction } = setup()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xóa stash' }))
    expect(stashAction).not.toHaveBeenCalled()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Xóa stash' }))
    await waitFor(() => expect(stashAction).toHaveBeenCalledWith('p1', 'stash@{0}', 'drop'))
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('disables and deduplicates saves while one is pending', async () => {
    let finish!: () => void
    const { stashSave, onChanged } = setup({ stashSave: () => new Promise<void>((resolve) => { finish = resolve }) })
    await screen.findByText('Làm dở')
    const button = screen.getByRole('button', { name: 'Lưu stash' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(stashSave).toHaveBeenCalledTimes(1)
    expect(stashSave).toHaveBeenCalledWith('p1', '')
    expect(onChanged).not.toHaveBeenCalled()
    await act(async () => finish())
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('shows errors and refreshes the worktree after a conflicting pop', async () => {
    const { stashes, onChanged } = setup({ stashAction: async () => { throw { message: 'Xung đột khi áp dụng' } } })
    await openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Áp dụng và xóa' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Xung đột khi áp dụng')
    await waitFor(() => expect(stashes).toHaveBeenCalledTimes(2))
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Làm dở')).toBeInTheDocument()
  })

  it('allows retrying a failed list request', async () => {
    let calls = 0
    setup({ stashes: async () => { if (++calls === 1) throw { message: 'Không đọc được stash' }; return [] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Không đọc được stash')
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới stash' }))
    expect(await screen.findByText('Không có stash.')).toBeInTheDocument()
  })

  it('never presents a previous project stash as an action in the next project', async () => {
    let finish!: (items: { ref: string; message: string }[]) => void
    const { rerender, onChanged } = setup({ stashes: (id) => id === 'p1'
      ? Promise.resolve([{ ref: 'stash@{0}', message: 'Dự án cũ' }])
      : new Promise((resolve) => { finish = resolve }) })
    expect(await screen.findByText('Dự án cũ')).toBeInTheDocument()
    rerender(<StashSection projectId="p2" onChanged={onChanged} />)
    expect(screen.queryByText('Dự án cũ')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Thao tác stash@{0}' })).not.toBeInTheDocument()
    await act(async () => finish([{ ref: 'stash@{0}', message: 'Dự án mới' }]))
    expect(await screen.findByText('Dự án mới')).toBeInTheDocument()
  })
})
