// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TaskPicker } from './TaskPicker'

afterEach(() => vi.unstubAllGlobals())

it('nút Sửa tasks.json gọi configFile rồi onOpenFile, đóng picker, và ẩn khi không có onOpenFile', async () => {
  const configFile = vi.fn(async () => '.vscode/tasks.json')
  const onOpenFile = vi.fn()
  const onClose = vi.fn()
  vi.stubGlobal('nexgraph', { tasks: {
    list: async () => [{ label: 'Build', command: 'make' }],
    configFile
  } })
  const first = render(<TaskPicker projectId="p1" history={[]} onPick={() => {}} onClose={onClose} onOpenFile={onOpenFile} />)
  await screen.findByRole('option', { name: /Build/ })
  fireEvent.click(screen.getByRole('button', { name: 'Sửa tasks.json' }))
  await waitFor(() => expect(configFile).toHaveBeenCalledWith('p1'))
  expect(onOpenFile).toHaveBeenCalledWith('.vscode/tasks.json')
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  first.unmount()

  vi.stubGlobal('nexgraph', { tasks: { list: async () => [], configFile } })
  render(<TaskPicker projectId="p1" history={[]} onPick={() => {}} onClose={() => {}} />)
  expect(screen.queryByRole('button', { name: 'Sửa tasks.json' })).not.toBeInTheDocument()
})

it('chọn Sửa tasks.json bằng Enter thì mở tệp và đóng picker', async () => {
  const onClose = vi.fn()
  const onOpenFile = vi.fn()
  vi.stubGlobal('nexgraph', { tasks: { list: async () => [], configFile: async () => '.vscode/tasks.json' } })
  render(<TaskPicker projectId="p1" history={[]} onPick={() => {}} onClose={onClose} onOpenFile={onOpenFile} />)
  const input = await screen.findByRole('combobox')
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(onOpenFile).toHaveBeenCalledWith('.vscode/tasks.json'))
  expect(onClose).toHaveBeenCalledTimes(1)
})

it('hiện lỗi khi không đọc được danh sách task', async () => {
  vi.stubGlobal('nexgraph', { tasks: { list: async () => { throw new Error('boom-list') } } })
  render(<TaskPicker projectId="p1" history={[]} onPick={() => {}} onClose={() => {}} onOpenFile={() => {}} />)
  expect((await screen.findByRole('alert')).textContent).toBe('boom-list')
})

it('hiện lỗi khi configFile thất bại mà không đóng picker', async () => {
  const onClose = vi.fn()
  vi.stubGlobal('nexgraph', { tasks: {
    list: async () => [],
    configFile: async () => { throw new Error('boom-config') }
  } })
  render(<TaskPicker projectId="p1" history={[]} onPick={() => {}} onClose={onClose} onOpenFile={() => {}} />)
  await screen.findByRole('button', { name: 'Sửa tasks.json' })
  fireEvent.click(screen.getByRole('button', { name: 'Sửa tasks.json' }))
  expect((await screen.findByRole('alert')).textContent).toBe('boom-config')
  expect(onClose).not.toHaveBeenCalled()
})
