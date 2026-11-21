// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileContent, FileRevision, NexGraphApi } from '@shared/api'
import type { EngineEvent } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'

const revealLines = vi.hoisted(() => vi.fn())
const revealPosition = vi.hoisted(() => vi.fn())
const setBookmarks = vi.hoisted(() => vi.fn())
const setEOL = vi.hoisted(() => vi.fn())
const setLanguage = vi.hoisted(() => vi.fn())
const created = vi.hoisted(() => vi.fn())
const cursorPosition = vi.hoisted(() => ({ line: 1, column: 1 }))
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
      getSelection: () => ta.selectionEnd > ta.selectionStart ? {
        text: ta.value.slice(ta.selectionStart, ta.selectionEnd),
        start: ta.value.slice(0, ta.selectionStart).split('\n').length,
        end: ta.value.slice(0, ta.selectionEnd).replace(/\n$/, '').split('\n').length
      } : null,
      setValue: (v: string) => { ta.value = v },
      onChange: (cb: () => void) => ta.addEventListener('input', cb),
      getPosition: () => cursorPosition,
      setBookmarks,
      revealPosition,
      revealLines,
      setEOL,
      setReadOnly: (v: boolean) => { ta.readOnly = v },
      getLanguage: () => opts.language,
      setLanguage,
      dispose: () => ta.remove()
    }
  }
}))

import { EditorTab, type EditorContextGetter } from './EditorTab'
import { setEditorPrefs } from '../../state/editorPrefs'
import { setLocale } from '../../state/locale'
import { listBookmarks, toggleBookmark } from '../../state/bookmarks'
import { getActiveEditor } from '../../state/activeEditor'
import { runCommand } from '../../state/commands'

const revision = (mtimeMs: number): FileRevision => ({ mtimeMs, version: `version-${mtimeMs}` })
const content = (over: Partial<FileContent> = {}): FileContent => ({
  text: 'void a() {}\n', eol: '\r\n', bom: true, ...revision(over.mtimeMs ?? 100), readOnly: false, ...over
})
const rejection = (code: string) => Object.assign(new Error(code), { code })

function setup(over: Partial<FileContent> = {}) {
  const read = vi.fn(async () => content(over))
  const write = vi.fn<NexGraphApi['fs']['write']>(async () => revision(200))
  const { api, emit } = installNexgraph({ fs: { read, write } })
  const onDirtyChange = vi.fn()
  const onClose = vi.fn()
  render(<EditorTab projectId="p1" file="lib/a.dart" line={7} lineEnd={9} onClose={onClose} onDirtyChange={onDirtyChange} />)
  return { read, write, onDirtyChange, onClose, api, emit }
}
const box = () => screen.findByLabelText('editor') as Promise<HTMLTextAreaElement>
const saveKey = () => userEvent.keyboard('{Control>}s{/Control}')
const typeAndSave = async (extra = '!') => {
  const ta = await box()
  await userEvent.type(ta, extra)
  await saveKey()
  return ta
}
const changedOnDisk = (emit: (e: EngineEvent) => void) =>
  act(async () => { emit({ type: 'changes_updated', project_id: 'p1' }) })

function pending<T>() {
  let finish!: (value: T) => void
  const result = new Promise<T>((resolve) => { finish = resolve })
  return { result, finish }
}

beforeEach(() => {
  setLocale('vi')
  localStorage.clear()
  setEditorPrefs({ breadcrumbs: true })
  document.body.innerHTML = '<div id="status-bar-right"></div>'
  cursorPosition.line = 1
  cursorPosition.column = 1
})

describe('EditorTab', () => {
  it('reads a live selection or unsaved buffer with the current disk version for AI context', async () => {
    const write = vi.fn(async () => revision(200))
    installNexgraph({ fs: { read: vi.fn(async () => content({ text: 'first\nsecond\nthird' })), write } })
    const onContextReady = vi.fn()
    const view = render(<EditorTab projectId="p1" file="lib/a.dart" line={1} onClose={vi.fn()}
      onDirtyChange={vi.fn()} onContextReady={onContextReady} />)
    const ta = await box()
    const getter = onContextReady.mock.calls.findLast((call) => typeof call[1] === 'function')?.[1] as EditorContextGetter
    expect(getter()).toMatchObject({ text: 'first\nsecond\nthird', start: 1, end: 3, version: 'version-100', dirty: false })
    fireEvent.change(ta, { target: { value: 'first\nmodified second\nthird' } })
    fireEvent.input(ta)
    ta.setSelectionRange(6, 22)
    expect(getter()).toMatchObject({ text: 'modified second\n', start: 2, end: 2, dirty: true, version: 'version-100' })
    ta.setSelectionRange(0, 0)
    expect(getter()?.text).toBe('first\nmodified second\nthird')
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }))
    await waitFor(() => expect(getter()).toMatchObject({ dirty: false, version: 'version-200' }))
    view.unmount()
    expect(onContextReady).toHaveBeenLastCalledWith('lib/a.dart', null)
    expect(getter()).toBeNull()
  })

  it('nạp tệp và cuộn tới dòng', async () => {
    const { read } = setup()
    const ta = await box()
    expect(read).toHaveBeenCalledWith('p1', 'lib/a.dart')
    expect(ta.value).toBe('void a() {}\n')
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ language: 'dart', readOnly: false }))
    expect(revealLines).toHaveBeenCalledWith(7, 9)
  })

  it('mở lại cùng dòng (yêu cầu mới) cuộn về lần nữa', async () => {
    installNexgraph({ fs: { read: vi.fn(async () => content()) } })
    const props = { projectId: 'p1', file: 'lib/a.dart', line: 7, onClose: vi.fn(), onDirtyChange: vi.fn() }
    const view = render(<EditorTab {...props} revealRequest={1} />)
    await box()
    await waitFor(() => expect(revealLines).toHaveBeenCalledWith(7, undefined))
    const before = revealLines.mock.calls.length
    view.rerender(<EditorTab {...props} revealRequest={2} />)
    expect(revealLines).toHaveBeenCalledTimes(before + 1)
  })

  it('sửa rồi Ctrl+S gọi fs.write với eol, bom, expectedVersion từ lần đọc', async () => {
    const { write, onDirtyChange } = setup()
    await typeAndSave()
    await waitFor(() => expect(write).toHaveBeenCalledWith('p1', 'lib/a.dart', 'void a() {}\n!', { eol: '\r\n', bom: true, expectedVersion: 'version-100' }))
    expect(onDirtyChange).toHaveBeenCalledWith('lib/a.dart', true)
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith('lib/a.dart', false))
  })

  it('nút Lưu báo tiến độ rồi báo đã lưu theo phiên bản trả về', async () => {
    const { write } = setup()
    const saving = pending<FileRevision>()
    write.mockReturnValueOnce(saving.result)
    await userEvent.type(await box(), '!')
    const save = screen.getByRole('button', { name: 'Lưu' })
    expect(screen.getByText('Chưa lưu')).toBeInTheDocument()
    await userEvent.click(save)
    expect(screen.getByText('Đang lưu…')).toBeInTheDocument()
    await act(async () => saving.finish(revision(200)))
    expect(await screen.findByText('Đã lưu')).toBeInTheDocument()
    expect(save).toBeDisabled()
  })

  it('lưu lần hai dùng phiên bản mới của lần ghi trước', async () => {
    const { write, onDirtyChange } = setup()
    await typeAndSave('1')
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith('lib/a.dart', false))
    await userEvent.type(await box(), '2')
    await userEvent.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(write).toHaveBeenLastCalledWith('p1', 'lib/a.dart', 'void a() {}\n12', expect.objectContaining({ expectedVersion: 'version-200' })))
  })

  it('xếp Ctrl+S nối tiếp và giữ dấu chưa lưu cho nội dung gõ sau yêu cầu thứ hai', async () => {
    const { write, onDirtyChange } = setup()
    const first = pending<FileRevision>()
    const second = pending<FileRevision>()
    write.mockImplementationOnce(() => first.result).mockImplementationOnce(() => second.result)
    const ta = await typeAndSave('1')
    await userEvent.type(ta, '2')
    await saveKey()
    await userEvent.type(ta, '3')
    expect(write).toHaveBeenCalledTimes(1)

    await act(async () => first.finish(revision(200)))
    expect(write).toHaveBeenNthCalledWith(2, 'p1', 'lib/a.dart', 'void a() {}\n12', { eol: '\r\n', bom: true, expectedVersion: 'version-200' })
    await act(async () => second.finish(revision(300)))
    expect(onDirtyChange).toHaveBeenLastCalledWith('lib/a.dart', true)
    expect(ta.value).toBe('void a() {}\n123')

    write.mockResolvedValueOnce(revision(400))
    await saveKey()
    expect(write).toHaveBeenNthCalledWith(3, 'p1', 'lib/a.dart', 'void a() {}\n123', { eol: '\r\n', bom: true, expectedVersion: 'version-300' })
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith('lib/a.dart', false))
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

  it('Ctrl+S trên thẻ sạch trong lúc đọc đĩa không ghi đè bản mới', async () => {
    const { read, write, emit } = setup()
    const ta = await box()
    const delayed = pending<FileContent>()
    read.mockImplementationOnce(() => delayed.result)
    await changedOnDisk(emit)
    await saveKey()
    await act(async () => delayed.finish(content({ text: 'bản của agent\n', version: 'agent-version' })))
    expect(ta.value).toBe('bản của agent\n')
    expect(write).not.toHaveBeenCalled()
  })

  it('sự kiện đến khi phiên bản không đổi thì không làm gì', async () => {
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
    read.mockResolvedValue(content({ text: 'từ đĩa\n', version: 'agent-version' })) // cùng mtime nhưng khác nội dung
    await changedOnDisk(emit)
    expect(await screen.findByRole('button', { name: 'Giữ bản của tôi' })).toBeInTheDocument()
    expect(ta.value).toBe('void a() {}\nx')
    read.mockResolvedValue(content({ text: 'bản mới nhất\n', version: 'later-version' }))
    await userEvent.click(screen.getByRole('button', { name: 'Nạp lại' }))
    await waitFor(() => expect(ta.value).toBe('bản mới nhất\n'))
    expect(screen.queryByRole('button', { name: 'Nạp lại' })).toBeNull()
    expect(onDirtyChange).toHaveBeenLastCalledWith('lib/a.dart', false)
  })

  it('Giữ bản của tôi giữ nội dung và lần lưu sau dùng phiên bản của đĩa', async () => {
    const { read, emit, write } = setup()
    const ta = await box()
    await userEvent.type(ta, 'x')
    read.mockResolvedValue(content({ text: 'từ đĩa\n', mtimeMs: 300 }))
    await changedOnDisk(emit)
    await userEvent.click(await screen.findByRole('button', { name: 'Giữ bản của tôi' }))
    expect(screen.queryByRole('button', { name: 'Nạp lại' })).toBeNull()
    expect(ta.value).toBe('void a() {}\nx')
    await userEvent.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(write).toHaveBeenCalledWith('p1', 'lib/a.dart', 'void a() {}\nx', expect.objectContaining({ expectedVersion: 'version-300' })))
  })

  it('Giữ bản của tôi đổi baseline về bản đĩa: undo về nội dung mở ban đầu vẫn còn dấu ●', async () => {
    const { read, emit, onDirtyChange } = setup()
    const ta = await box()
    await userEvent.type(ta, 'x')
    read.mockResolvedValue(content({ text: 'từ đĩa\n', mtimeMs: 300 }))
    await changedOnDisk(emit)
    await userEvent.click(await screen.findByRole('button', { name: 'Giữ bản của tôi' }))
    expect(ta.value).toBe('void a() {}\nx') // không mất nội dung đang giữ
    await userEvent.type(ta, '{backspace}') // "undo" về đúng nội dung mở ban đầu
    expect(ta.value).toBe('void a() {}\n')
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith('lib/a.dart', true)) // đĩa vẫn là bản khác
  })

  it('nạp lại bản đĩa thì áp lại readOnly/reason theo FileContent (không chỉ lúc mở thẻ)', async () => {
    const { read, emit } = setup()
    const ta = await box()
    expect(ta.readOnly).toBe(false)
    read.mockResolvedValue(content({ text: '', mtimeMs: 300, readOnly: true, reason: 'too_large' }))
    await changedOnDisk(emit)
    await waitFor(() => expect(ta.readOnly).toBe(true))
    expect(await screen.findByText('Tệp quá lớn nên chỉ xem, không sửa được')).toBeInTheDocument()
    expect(ta.value).toBe('')
    read.mockResolvedValue(content({ text: 'nhỏ lại\n', mtimeMs: 400 }))
    await changedOnDisk(emit)
    await waitFor(() => expect(ta.readOnly).toBe(false))
    expect(screen.queryByText('Tệp quá lớn nên chỉ xem, không sửa được')).toBeNull()
    expect(ta.value).toBe('nhỏ lại\n')
  })

  it('agent ghi cùng mtime thì xung đột giữ cả bản đĩa và buffer, bỏ lượt lưu chờ', async () => {
    let disk = content()
    const gate = pending<void>()
    const write = vi.fn<NexGraphApi['fs']['write']>(async (_project, _file, text, opts) => {
      await gate.result
      if (opts.expectedVersion !== disk.version) throw rejection('conflict')
      disk = { ...disk, ...revision(200), text }
      return revision(200)
    })
    const read = vi.fn(async () => disk)
    installNexgraph({ fs: { read, write } })
    const onDirtyChange = vi.fn()
    render(<EditorTab projectId="p1" file="lib/a.dart" line={1} onClose={vi.fn()} onDirtyChange={onDirtyChange} />)
    const ta = await typeAndSave()
    await userEvent.type(ta, '?')
    await saveKey()
    disk = content({ text: 'bản của agent\n', version: 'agent-version' })
    await act(async () => gate.finish())
    expect(await screen.findByRole('button', { name: 'Nạp lại' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Giữ bản của tôi' })).toBeInTheDocument()
    expect(onDirtyChange).toHaveBeenLastCalledWith('lib/a.dart', true)
    expect(ta.value).toBe('void a() {}\n!?')
    expect(disk.text).toBe('bản của agent\n')
    await saveKey()
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('Nạp lại giữ nội dung gõ thêm sau khi bấm nút trong lúc đọc đĩa', async () => {
    const { read, emit } = setup()
    const ta = await box()
    await userEvent.type(ta, 'x')
    read.mockResolvedValue(content({ text: 'bản đã đổi\n', version: 'agent-version' }))
    await changedOnDisk(emit)
    const reload = await screen.findByRole('button', { name: 'Nạp lại' })
    const delayed = pending<FileContent>()
    read.mockImplementationOnce(() => delayed.result)
    await userEvent.click(reload)
    expect(reload).toBeDisabled()
    await userEvent.type(ta, 'y')
    await act(async () => delayed.finish(content({ text: 'bản mới nhất\n', version: 'later-version' })))
    expect(ta.value).toBe('void a() {}\nxy')
    expect(reload).toBeEnabled()
  })

  it('sự kiện đổi tệp đến giữa lúc đang lưu không bị coi là xung đột', async () => {
    const { read, write, emit } = setup()
    const ta = await box()
    await userEvent.type(ta, '!')
    const saving = pending<FileRevision>()
    write.mockImplementationOnce(() => saving.result)
    read.mockResolvedValue(content({ text: 'void a() {}\n!', mtimeMs: 200 })) // đĩa đã mang bản vừa ghi
    await userEvent.keyboard('{Control>}s{/Control}')
    await changedOnDisk(emit)
    await act(async () => saving.finish(revision(200)))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2)) // một lần kiểm lại sau khi lưu xong
    expect(screen.queryByRole('button', { name: 'Nạp lại' })).toBeNull()
    expect(ta.value).toBe('void a() {}\n!')
  })

  it('tệp bị xoá trên đĩa thì báo và giữ nội dung', async () => {
    const { read, emit } = setup()
    const ta = await box()
    read.mockRejectedValue(rejection('file_not_found'))
    await changedOnDisk(emit)
    expect(await screen.findByRole('alert')).toHaveTextContent('Tệp đã bị xoá hoặc đổi tên trên đĩa')
    expect(ta.value).toBe('void a() {}\n')
  })

  it('thẻ ẩn không nhận Ctrl+S, thẻ hiện thì có', async () => {
    const write = vi.fn(async () => revision(200))
    installNexgraph({ fs: { read: vi.fn(async () => content()), write } })
    const base = { projectId: 'p1', line: 1, onClose: vi.fn(), onDirtyChange: vi.fn() }
    render(<><EditorTab {...base} file="lib/a.dart" active={false} /><EditorTab {...base} file="lib/b.dart" /></>)
    const [a, b] = (await screen.findAllByLabelText('editor')) as HTMLTextAreaElement[]
    await userEvent.type(a, 'A')
    await userEvent.type(b, 'B')
    await userEvent.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledWith('p1', 'lib/b.dart', 'void a() {}\nB', expect.anything())
  })
  it('picker commands open only on the visible tab', async () => {
    installNexgraph({ fs: { read: vi.fn(async () => content()) } })
    const base = { projectId: 'p-pickers', line: 1, onClose: vi.fn(), onDirtyChange: vi.fn() }
    render(<><EditorTab {...base} file="lib/hidden.dart" active={false} /><EditorTab {...base} file="lib/shown.dart" /></>)
    await screen.findAllByLabelText('editor')
    await act(async () => {})
    expect(runCommand('editor.select_line_ending')).toBe(true)
    expect(await screen.findByRole('dialog', { name: 'Kiểu xuống dòng' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Kiểu xuống dòng' }), { key: 'Escape' })
    expect(runCommand('editor.select_language')).toBe(true)
    expect(await screen.findByRole('dialog', { name: 'Ngôn ngữ' })).toBeTruthy()
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
  it('nút bookmark bật/tắt mốc của đúng dự án và tệp trên thẻ đang hiện', async () => {
    const projectId = 'p-bookmark-ui'
    installNexgraph({ fs: { read: vi.fn(async () => content()) } })
    const base = { projectId, line: 1, onClose: vi.fn(), onDirtyChange: vi.fn() }
    const hidden = render(<EditorTab {...base} file="lib/other.dart" active={false} />)
    const view = render(<EditorTab {...base} file="lib/a.dart" />)
    await within(view.container).findByLabelText('editor')
    await act(async () => {})
    expect(within(hidden.container).getByRole('button', { name: 'Đánh dấu dòng', hidden: true })).toBeInTheDocument()

    await userEvent.click(within(view.container).getByRole('button', { name: 'Đánh dấu dòng' }))
    await waitFor(() => expect(listBookmarks(projectId)).toEqual([{ file: 'lib/a.dart', line: 1 }]))
    expect(setBookmarks).toHaveBeenCalledWith([1])

    await userEvent.click(await within(view.container).findByRole('button', { name: 'Bỏ đánh dấu dòng' }))
    await waitFor(() => expect(listBookmarks(projectId)).toEqual([]))
  })

  it('lệnh next/previous bookmark nhảy dòng rồi wrap', async () => {
    const projectId = 'p-bookmark-nav'
    toggleBookmark(projectId, 'lib/a.dart', 3)
    toggleBookmark(projectId, 'lib/a.dart', 7)
    installNexgraph({ fs: { read: vi.fn(async () => content()) } })
    render(<EditorTab projectId={projectId} file="lib/a.dart" line={1} onClose={vi.fn()} onDirtyChange={vi.fn()} />)
    await box()
    await act(async () => {})

    cursorPosition.line = 1
    expect(runCommand('editor.next_bookmark')).toBe(true)
    expect(revealPosition).toHaveBeenLastCalledWith(3, 1)
    cursorPosition.line = 3
    runCommand('editor.next_bookmark')
    expect(revealPosition).toHaveBeenLastCalledWith(7, 1)
    cursorPosition.line = 7
    runCommand('editor.next_bookmark')
    expect(revealPosition).toHaveBeenLastCalledWith(3, 1)
    cursorPosition.line = 3
    runCommand('editor.previous_bookmark')
    expect(revealPosition).toHaveBeenLastCalledWith(7, 1)
  })
})

describe('EditorTab view controls', () => {
  const open = (over: Parameters<typeof installNexgraph>[0] = {}, column = 1) => {
    const write = vi.fn<NexGraphApi['fs']['write']>(async () => revision(200))
    installNexgraph({ fs: { read: vi.fn(async () => content()), write }, ...over })
    if (over.lsp) (window.nexgraph as unknown as { lsp: unknown }).lsp = over.lsp
    render(<EditorTab projectId="p1" file="src/math.ts" line={1} column={column} active onClose={vi.fn()} onDirtyChange={vi.fn()} />)
    return { write }
  }
  const ready = async () => {
    await box()
    await waitFor(() => expect(document.querySelector('#status-bar-right')?.childElementCount).toBeGreaterThan(0))
  }

  it('shows the symbol at the cursor in the breadcrumb and hides it when toggled', async () => {
    const symbol = { name: 'twice', kind: 6, range: { start: { line: 0, character: 0 }, end: { line: 4, character: 0 } },
      selectionRange: { start: { line: 0, character: 9 }, end: { line: 0, character: 14 } } }
    cursorPosition.line = 1
    cursorPosition.column = 12
    const documentSymbols = vi.fn(async () => [symbol])
    open({ lsp: { documentSymbols, open: vi.fn(async () => {}), close: vi.fn(async () => {}) } }, 12)
    expect((window.nexgraph as unknown as { lsp: { documentSymbols: unknown } }).lsp.documentSymbols).toBe(documentSymbols)
    await waitFor(() => expect(getActiveEditor()?.file).toBe('src/math.ts'))
    await waitFor(() => expect(documentSymbols).toHaveBeenCalled())
    expect(await screen.findByText('twice()')).toBeTruthy()
    expect(screen.getByLabelText('Đường dẫn tệp src/math.ts').textContent).toContain('math.ts')
    await act(async () => { setEditorPrefs({ breadcrumbs: false }) })
    expect(screen.queryByLabelText('Đường dẫn tệp src/math.ts')).toBeNull()
    expect(screen.queryByText('twice()')).toBeNull()
  })

  it('changes the buffer EOL from the status bar picker and saves it', async () => {
    const { write } = open()
    await ready()
    await userEvent.click(screen.getByTitle('Kiểu xuống dòng'))
    expect(screen.getByRole('dialog', { name: 'Kiểu xuống dòng' })).toBeTruthy()
    await userEvent.click(screen.getByText('LF'))
    expect(setEOL).toHaveBeenCalledWith('\n')
    expect(screen.getByTitle('Kiểu xuống dòng').textContent).toBe('LF')
    expect(screen.getByText('Chưa lưu')).toBeTruthy()
    await userEvent.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(write).toHaveBeenCalledWith('p1', 'src/math.ts', 'void a() {}\n', { eol: '\n', bom: true, expectedVersion: 'version-100' }))
    expect(await screen.findByText('Đã lưu')).toBeTruthy()
  })

  it('changes the model language from the status bar picker', async () => {
    open()
    await ready()
    await userEvent.click(screen.getByTitle('Ngôn ngữ'))
    const dialog = screen.getByRole('dialog', { name: 'Ngôn ngữ' })
    await userEvent.click(within(dialog).getByText('TypeScript'))
    expect(setLanguage).toHaveBeenCalledWith('typescript')
    expect(screen.getByTitle('Ngôn ngữ').textContent).toBe('TypeScript')
  })
  it('translates language options after switching locale', async () => {
    setLocale('en')
    open()
    await ready()
    act(() => { expect(runCommand('editor.select_language')).toBe(true) })
    const dialog = screen.getByRole('dialog', { name: 'Language' })
    expect(within(dialog).getByText('Plain text')).toBeTruthy()
  })

  it('explains why the encoding cannot be changed', async () => {
    open()
    await ready()
    await userEvent.click(screen.getByTitle('Bảng mã'))
    expect((await screen.findByRole('status')).textContent).toContain('engine chỉ lưu UTF-8')
  })
})
