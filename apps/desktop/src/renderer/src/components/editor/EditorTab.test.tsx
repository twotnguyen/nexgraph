// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileContent } from '@shared/api'
import { installNexgraph } from '../../test-utils'

const revealLines = vi.hoisted(() => vi.fn())
const created = vi.hoisted(() => vi.fn())

// jsdom không chạy Monaco: thay bằng một <textarea> có cùng giao diện EditorHandle.
vi.mock('./monaco', () => ({
  languageFor: (f: string) => (f.endsWith('.dart') ? 'dart' : 'plaintext'),
  createEditor: (el: HTMLElement, opts: { value: string; language: string; readOnly: boolean }) => {
    created(opts)
    const ta = document.createElement('textarea')
    ta.value = opts.value
    ta.readOnly = opts.readOnly
    ta.setAttribute('aria-label', 'editor')
    el.appendChild(ta)
    return {
      getValue: () => ta.value,
      setValue: (v: string) => { ta.value = v },
      onChange: (cb: () => void) => ta.addEventListener('input', cb),
      revealLines,
      dispose: () => ta.remove()
    }
  }
}))

import { EditorTab } from './EditorTab'

const content = (over: Partial<FileContent> = {}): FileContent => ({
  text: 'void a() {}\n', eol: '\r\n', bom: true, mtimeMs: 100, readOnly: false, ...over
})
const rejection = (code: string) => Object.assign(new Error(code), { code })

function setup(over: Partial<FileContent> = {}, extra: Parameters<typeof installNexgraph>[0] = {}) {
  const read = vi.fn(async () => content(over))
  const write = vi.fn(async () => ({ mtimeMs: 200 }))
  const { api, emit } = installNexgraph({ fs: { read, write }, ...extra })
  const onDirtyChange = vi.fn()
  const onClose = vi.fn()
  render(<EditorTab projectId="p1" file="lib/a.dart" line={7} lineEnd={9} onClose={onClose} onDirtyChange={onDirtyChange} />)
  return { read, write, onDirtyChange, onClose, api, emit }
}
const box = () => screen.findByLabelText('editor') as Promise<HTMLTextAreaElement>
const typeAndSave = async (extra = '!') => {
  const ta = await box()
  await userEvent.type(ta, extra)
  await userEvent.keyboard('{Control>}s{/Control}')
  return ta
}
const changedOnDisk = (emit: (e: never) => void) =>
  act(async () => { (emit as (e: unknown) => void)({ type: 'changes_updated', project_id: 'p1' }) })

beforeEach(() => vi.clearAllMocks())

describe('EditorTab', () => {
  it('nạp tệp và cuộn tới dòng', async () => {
    const { read } = setup()
    const ta = await box()
    expect(read).toHaveBeenCalledWith('p1', 'lib/a.dart')
    expect(ta.value).toBe('void a() {}\n')
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ language: 'dart', readOnly: false }))
    expect(revealLines).toHaveBeenCalledWith(7, 9)
  })

  it('sửa rồi Ctrl+S gọi fs.write với eol, bom, expectedMtimeMs từ lần đọc', async () => {
    const { write, onDirtyChange } = setup()
    await typeAndSave()
    await waitFor(() => expect(write).toHaveBeenCalledWith('p1', 'lib/a.dart', 'void a() {}\n!', { eol: '\r\n', bom: true, expectedMtimeMs: 100 }))
    expect(onDirtyChange).toHaveBeenCalledWith('lib/a.dart', true)
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith('lib/a.dart', false))
  })

  it('lưu lần hai dùng mtime mới của lần ghi trước', async () => {
    const { write, onDirtyChange } = setup()
    await typeAndSave('1')
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith('lib/a.dart', false))
    await userEvent.type(await box(), '2')
    await userEvent.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(write).toHaveBeenLastCalledWith('p1', 'lib/a.dart', 'void a() {}\n12', expect.objectContaining({ expectedMtimeMs: 200 })))
  })

  it('tệp readOnly hiện thông báo và không gọi fs.write khi Ctrl+S', async () => {
    const { write } = setup({ readOnly: true, reason: 'too_large' })
    await box()
    expect(await screen.findByText('Tệp quá lớn nên chỉ xem, không sửa được')).toBeInTheDocument()
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }))
    await userEvent.keyboard('{Control>}s{/Control}')
    expect(write).not.toHaveBeenCalled()
  })

  it('tệp đổi trên đĩa khi thẻ sạch thì tự nạp lại', async () => {
    const { read, emit } = setup()
    const ta = await box()
    read.mockResolvedValueOnce(content({ text: 'từ đĩa\n', mtimeMs: 300 }))
    await changedOnDisk(emit)
    await waitFor(() => expect(ta.value).toBe('từ đĩa\n'))
    expect(screen.queryByRole('button', { name: 'Nạp lại' })).toBeNull()
  })

  it('sự kiện đến khi mtime không đổi (chính mình vừa lưu) thì không làm gì', async () => {
    const { read, emit } = setup()
    const ta = await box()
    await userEvent.type(ta, 'x')
    await changedOnDisk(emit)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    expect(ta.value).toBe('void a() {}\nx')
    expect(screen.queryByRole('button', { name: 'Nạp lại' })).toBeNull()
  })

  it('tệp đổi trên đĩa khi đang sửa thì hiện thanh hai nút, nội dung đang sửa không đổi; Nạp lại lấy bản đĩa', async () => {
    const { read, emit, onDirtyChange } = setup()
    const ta = await box()
    await userEvent.type(ta, 'x')
    read.mockResolvedValue(content({ text: 'từ đĩa\n', mtimeMs: 300 }))
    await changedOnDisk(emit)
    expect(await screen.findByRole('button', { name: 'Giữ bản của tôi' })).toBeInTheDocument()
    expect(ta.value).toBe('void a() {}\nx')
    await userEvent.click(screen.getByRole('button', { name: 'Nạp lại' }))
    expect(ta.value).toBe('từ đĩa\n')
    expect(screen.queryByRole('button', { name: 'Nạp lại' })).toBeNull()
    expect(onDirtyChange).toHaveBeenLastCalledWith('lib/a.dart', false)
  })

  it('Giữ bản của tôi giữ nội dung và lần lưu sau dùng mtime của đĩa', async () => {
    const { read, emit, write } = setup()
    const ta = await box()
    await userEvent.type(ta, 'x')
    read.mockResolvedValue(content({ text: 'từ đĩa\n', mtimeMs: 300 }))
    await changedOnDisk(emit)
    await userEvent.click(await screen.findByRole('button', { name: 'Giữ bản của tôi' }))
    expect(screen.queryByRole('button', { name: 'Nạp lại' })).toBeNull()
    expect(ta.value).toBe('void a() {}\nx')
    await userEvent.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(write).toHaveBeenCalledWith('p1', 'lib/a.dart', 'void a() {}\nx', expect.objectContaining({ expectedMtimeMs: 300 })))
  })

  it('fs.write trả conflict thì hiện cùng thanh đó, không mất nội dung', async () => {
    const write = vi.fn(async () => { throw rejection('conflict') })
    const read = vi.fn(async () => content())
    installNexgraph({ fs: { read, write } })
    render(<EditorTab projectId="p1" file="lib/a.dart" line={1} onClose={vi.fn()} onDirtyChange={vi.fn()} />)
    const ta = await typeAndSave()
    expect(await screen.findByRole('button', { name: 'Nạp lại' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Giữ bản của tôi' })).toBeInTheDocument()
    expect(ta.value).toBe('void a() {}\n!')
  })

  it('lỗi đọc hiện thông báo theo code', async () => {
    installNexgraph({ fs: { read: vi.fn(async () => { throw rejection('file_not_found') }) } })
    render(<EditorTab projectId="p1" file="lib/a.dart" line={1} onClose={vi.fn()} onDirtyChange={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Tệp không còn tồn tại')
  })

  it('đóng thẻ gọi onClose', async () => {
    const { onClose } = setup()
    await box()
    await userEvent.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(onClose).toHaveBeenCalled()
  })
})
