// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { installNexgraph } from '../../test-utils'
import { FileFinder } from './FileFinder'

function setup(files: string[], recent: string[] = [], createFile: (pid: string, path: string) => Promise<void> = vi.fn(async () => {})) {
  const list = vi.fn(async () => ({ files, truncated: false }))
  installNexgraph({ fs: { files: list, createFile } })
  const onOpen = vi.fn()
  const onClose = vi.fn()
  render(<FileFinder projectId="p1" projectName="demo" recent={recent} onOpen={onOpen} onClose={onClose} />)
  return { onOpen, onClose }
}

const loaded = async () => { await act(async () => {}) }

describe('FileFinder', () => {
  it('shows only recent files in supplied order, with root, directories and history icons', async () => {
    const { onOpen } = setup(['root.ts', 'src/new.ts', 'src/old.ts', 'unopened.ts'], ['src/new.ts', 'root.ts', 'ignored.txt'])
    await loaded()
    const rows = screen.getAllByRole('option')
    expect(rows.map((row) => row.dataset.path)).toEqual(['src/new.ts', 'root.ts', 'ignored.txt'])
    expect(rows[0]).toHaveTextContent('new.tsdemo/src/')
    expect(rows[1]).toHaveTextContent('root.tsdemo/')
    for (const row of rows) expect(within(row).getByLabelText('Mở gần đây')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Tìm tệp' }), { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('src/new.ts')
  })

  it('finds a recent ignored file without offering to recreate it', async () => {
    const { onOpen } = setup([], ['ignored.txt'])
    await loaded()
    const input = screen.getByRole('combobox', { name: 'Tìm tệp' })
    fireEvent.change(input, { target: { value: 'ignored.txt' } })
    expect(screen.getByRole('option')).toHaveAttribute('data-path', 'ignored.txt')
    expect(screen.queryByText(/Tạo tệp/)).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('ignored.txt')
  })

  it('does not fill an empty history with indexed files', async () => {
    setup(['src/main.ts'])
    await loaded()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('Không có tệp khớp')).toBeInTheDocument()
  })

  it('searches indexed files and appends a creation option only for a new path', async () => {
    setup(['src/main.ts', 'src/main.test.ts'], ['src/main.ts'])
    await loaded()
    const input = screen.getByRole('combobox', { name: 'Tìm tệp' })
    fireEvent.change(input, { target: { value: 'src/main.ts' } })
    expect(screen.getAllByRole('option').find((row) => row.dataset.path === 'src/main.ts')).toHaveTextContent('demo/src/')
    expect(screen.queryByText(/Tạo tệp/)).toBeNull()
    fireEvent.change(input, { target: { value: 'main' } })
    const rows = screen.getAllByRole('option')
    expect(rows.at(-1)).toHaveTextContent('Tạo tệp main?')
    expect(rows[0]).not.toHaveTextContent('Tạo tệp')
    expect(within(rows[0]).queryByLabelText('Mở gần đây')).toBeNull()
    for (const invalid of ['../escape.ts', '/absolute.ts', 'src/', 'src//file.ts']) {
      fireEvent.change(input, { target: { value: invalid } })
      expect(screen.queryByText(/Tạo tệp/)).toBeNull()
    }
  })

  it('creates nested files before closing and opening them', async () => {
    let finish!: () => void
    const createFile = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const { onOpen, onClose } = setup(['src/existing.ts'], [], createFile)
    await loaded()
    const input = screen.getByRole('combobox', { name: 'Tìm tệp' })
    fireEvent.change(input, { target: { value: 'new/deep/file.ts' } })
    expect(screen.getByRole('option')).toHaveTextContent('Tạo tệp new/deep/file.ts?')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(createFile).toHaveBeenCalledOnce()
    expect(createFile).toHaveBeenCalledWith('p1', 'new/deep/file.ts')
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => finish())
    expect(onClose).toHaveBeenCalledOnce()
    expect(onOpen).toHaveBeenCalledWith('new/deep/file.ts')
  })

  it('offers creation after indexed matches and allows selecting the appended row', async () => {
    const createFile = vi.fn(async () => {})
    const { onOpen } = setup(['src/a.ts'], [], createFile)
    await loaded()
    const input = screen.getByRole('combobox', { name: 'Tìm tệp' })
    fireEvent.change(input, { target: { value: 'a' } })
    const rows = screen.getAllByRole('option')
    expect(rows[0]).toHaveAttribute('data-path', 'src/a.ts')
    expect(rows[1]).toHaveTextContent('Tạo tệp a?')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(async () => {})
    expect(createFile).toHaveBeenCalledWith('p1', 'a')
    expect(onOpen).toHaveBeenCalledWith('a')
  })

  it('keeps the picker open and displays IPC errors for unindexed collisions', async () => {
    const createFile = vi.fn(async () => { throw { message: 'Tệp đã tồn tại' } })
    const { onOpen, onClose } = setup([], [], createFile)
    await loaded()
    const input = screen.getByRole('combobox', { name: 'Tìm tệp' })
    fireEvent.change(input, { target: { value: '.gitignored' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Tệp đã tồn tại')
    expect(screen.getByRole('combobox', { name: 'Tìm tệp' })).toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
