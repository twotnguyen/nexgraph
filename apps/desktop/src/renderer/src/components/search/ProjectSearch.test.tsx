// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TextSearchResult } from '@shared/api'
import { afterEach, expect, it, vi } from 'vitest'
import { runCommand } from '../../state/commands'
import { setLocale } from '../../state/locale'
import { ProjectSearch } from './ProjectSearch'
import { tr } from '../../strings'

afterEach(() => { setLocale('vi'); vi.restoreAllMocks() })

it('thay tất cả bỏ qua tệp đang sửa dở rồi tìm lại', async () => {
  const searchText = vi.fn().mockResolvedValue({ truncated: false, files: [
    { file: 'src/a.ts', matches: [{ line: 3, column: 5, length: 3, preview: '    foo()', previewStart: 0 }] },
    { file: 'src/b.ts', matches: [{ line: 1, column: 1, length: 3, preview: 'foo', previewStart: 0 }] }
  ] })
  const replaceText = vi.fn().mockResolvedValue({ files: 1, replacements: 1, skipped: [] })
  Object.assign(window, { nexgraph: { fs: { searchText, replaceText } } })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const onOpen = vi.fn()
  render(<ProjectSearch projectId="p1" onOpen={onOpen} dirtyFiles={new Set(['src/b.ts'])} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm trong tệp' }), { target: { value: 'foo' } })
  fireEvent.click(screen.getByRole('button', { name: 'Khớp nguyên từ' }))
  await screen.findByText('2 kết quả trong 2 tệp')
  expect(searchText).toHaveBeenLastCalledWith('p1', { query: 'foo', wholeWord: true })

  fireEvent.click(screen.getByTitle('Dòng 3'))
  expect(onOpen).toHaveBeenCalledWith('src/a.ts', 3)

  fireEvent.click(screen.getByRole('button', { name: 'Hiện ô thay' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Thay bằng' }), { target: { value: 'bar' } })
  fireEvent.click(screen.getByRole('button', { name: 'Thay tất cả' }))
  await waitFor(() => expect(replaceText).toHaveBeenCalledWith('p1', { query: 'foo', wholeWord: true }, 'bar', ['src/a.ts']))
  await screen.findByText('Đã thay 1 chỗ trong 1 tệp; bỏ qua 1 tệp đang sửa hoặc vừa đổi.')
  expect(searchText).toHaveBeenCalledTimes(2)
})

it('hiện từng chỗ khớp trên dòng dài trong thanh bên hẹp', async () => {
  const line = `${'x'.repeat(120)}😀${'z'.repeat(23)}foo between targets foo${'y'.repeat(240)}`
  const searchText = vi.fn().mockResolvedValue({ truncated: false, files: [{
    file: 'src/long.ts',
    matches: [
      { line: 8, column: 146, length: 3, preview: line.slice(45, 345), previewStart: 45 },
      { line: 8, column: 166, length: 3, preview: line.slice(65, 365), previewStart: 65 }
    ]
  }] })
  Object.assign(window, { nexgraph: { fs: { searchText } } })
  const onOpen = vi.fn()
  render(<div style={{ width: 120 }}><ProjectSearch projectId="p1" onOpen={onOpen} dirtyFiles={new Set()} /></div>)

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm trong tệp' }), { target: { value: 'foo' } })
  const rows = await screen.findAllByTitle('Dòng 8')
  const marks = rows.map((row) => row.querySelector('mark'))
  expect(marks.map((mark) => mark?.textContent)).toEqual(['foo', 'foo'])
  fireEvent.click(rows[1])
  expect(onOpen).toHaveBeenCalledWith('src/long.ts', 8)
  expect(marks[0]?.previousElementSibling?.textContent).toBe(`…😀${'z'.repeat(23)}`)
  expect(marks[1]?.previousElementSibling?.textContent).toBe(`…${'z'.repeat(4)}foo between targets `)
  for (const mark of marks) {
    expect(mark?.parentElement?.classList.contains('ps-preview')).toBe(true)
    expect(mark?.previousElementSibling?.classList.contains('ps-context-before')).toBe(true)
    expect(mark?.nextElementSibling?.textContent?.endsWith('…')).toBe(true)
  }
})

it('giữ toàn bộ chỗ khớp dài trong preview', async () => {
  const match = 'đ'.repeat(240)
  const preview = `prefix 😀 ${match} tail`
  const searchText = vi.fn().mockResolvedValue({ truncated: false, files: [
    { file: 'src/long.ts', matches: [{ line: 1, column: 11, length: 240, preview, previewStart: 0 }] },
    { file: 'src/short.ts', matches: [{ line: 2, column: 4, length: 240, preview: `abc${match}`, previewStart: 0 }] }
  ] })
  Object.assign(window, { nexgraph: { fs: { searchText } } })
  render(<div style={{ width: 120 }}><ProjectSearch projectId="p1" onOpen={vi.fn()} dirtyFiles={new Set()} /></div>)

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm trong tệp' }), { target: { value: match } })
  const row = await screen.findByTitle('Dòng 1')
  expect(row.querySelector('mark')?.textContent).toBe(match)
  expect(screen.getByTitle('Dòng 2').querySelector('mark')?.nextElementSibling?.textContent).toBe('')
})

it('không cắt đôi ký tự Unicode trong ngữ cảnh sau', async () => {
  const preview = `foo${'x'.repeat(159)}😀${'y'.repeat(140)}`
  const searchText = vi.fn().mockResolvedValue({ truncated: false, files: [{
    file: 'src/unicode.ts', matches: [{ line: 1, column: 1, length: 3, preview: preview.slice(0, 200), previewStart: 0 }]
  }] })
  Object.assign(window, { nexgraph: { fs: { searchText } } })
  render(<ProjectSearch projectId="p1" onOpen={vi.fn()} dirtyFiles={new Set()} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm trong tệp' }), { target: { value: 'foo' } })
  const row = await screen.findByTitle('Dòng 1')
  expect(row.querySelector('mark')?.nextElementSibling?.textContent).toBe(`${'x'.repeat(159)}😀…`)
})

it.each([
  [120, 120, `${'y'.repeat(80)}…`],
  [240, 200, '…']
] as const)('báo phần preview bị cắt với chỗ khớp dài %i', async (length, shown, suffix) => {
  const match = 'a'.repeat(length)
  const line = `${'x'.repeat(120)}${match}${'y'.repeat(240)}`
  const searchText = vi.fn().mockResolvedValue({ truncated: false, files: [{
    file: 'src/long.ts', matches: [{ line: 1, column: 121, length, preview: line.slice(20, 320), previewStart: 20 }]
  }] })
  Object.assign(window, { nexgraph: { fs: { searchText } } })
  render(<ProjectSearch projectId="p1" onOpen={vi.fn()} dirtyFiles={new Set()} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm trong tệp' }), { target: { value: match } })
  const row = await screen.findByTitle('Dòng 1')
  expect(row.querySelector('mark')?.textContent).toBe('a'.repeat(shown))
  expect(row.querySelector('mark')?.nextElementSibling?.textContent).toBe(suffix)
})

it('đặt nút thay tất cả trong ô thay và giữ bộ lọc có thể dùng được', () => {
  Object.assign(window, { nexgraph: { fs: {} } })
  render(<div style={{ width: 180 }}><ProjectSearch projectId="p1" onOpen={vi.fn()} dirtyFiles={new Set()} /></div>)

  fireEvent.click(screen.getByRole('button', { name: 'Hiện ô thay' }))
  const replace = screen.getByRole('textbox', { name: 'Thay bằng' })
  const replaceAll = screen.getByRole('button', { name: 'Thay tất cả' })
  const searchField = screen.getByRole('textbox', { name: 'Tìm trong tệp' }).parentElement
  expect(searchField?.className).toBe(replace.parentElement?.className)
  expect(replace.parentElement).toBe(replaceAll.parentElement)
  expect(replaceAll.querySelector('svg')).not.toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Lọc tệp' }))
  expect(screen.getByRole('textbox', { name: 'Chỉ trong tệp' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Bỏ qua tệp' })).toBeTruthy()
})

const hit = (line: number): TextSearchResult['files'][number]['matches'][number] =>
  ({ line, column: 1, length: 5, preview: 'twice()', previewStart: 0 })

it('ba toggle đổi query gửi đi cả khi bấm nút và khi gọi lệnh', async () => {
  const searchText = vi.fn().mockResolvedValue({ truncated: false, files: [] })
  Object.assign(window, { nexgraph: { fs: { searchText } } })
  render(<ProjectSearch projectId="p1" onOpen={vi.fn()} dirtyFiles={new Set()} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm trong tệp' }), { target: { value: 'foo' } })
  const caseBtn = screen.getByRole('button', { name: 'Phân biệt hoa thường' })
  const wordBtn = screen.getByRole('button', { name: 'Khớp nguyên từ' })
  const regexBtn = screen.getByRole('button', { name: 'Biểu thức chính quy' })
  for (const btn of [caseBtn, wordBtn, regexBtn]) expect(btn).toHaveAttribute('aria-pressed', 'false')
  expect(caseBtn).toHaveAttribute('title', 'Phân biệt hoa thường')

  fireEvent.click(caseBtn)
  expect(caseBtn).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(searchText).toHaveBeenLastCalledWith('p1', { query: 'foo', caseSensitive: true }))
  act(() => { expect(runCommand('search.toggle_whole_word')).toBe(true) })
  expect(wordBtn).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(searchText).toHaveBeenLastCalledWith('p1', { query: 'foo', caseSensitive: true, wholeWord: true }))
  act(() => { expect(runCommand('search.toggle_regex')).toBe(true) })
  expect(regexBtn).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(searchText).toHaveBeenLastCalledWith('p1', { query: 'foo', caseSensitive: true, wholeWord: true, regex: true }))
})

it('summary đếm đúng kết quả/tệp, báo đang tìm và đạt giới hạn', async () => {
  let resolveSearch: (r: TextSearchResult) => void = () => {}
  const searchText = vi.fn().mockImplementation(() => new Promise<TextSearchResult>((resolve) => { resolveSearch = resolve }))
  Object.assign(window, { nexgraph: { fs: { searchText } } })
  render(<ProjectSearch projectId="p1" onOpen={vi.fn()} dirtyFiles={new Set()} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm trong tệp' }), { target: { value: 'twice' } })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Đang tìm…'))
  act(() => resolveSearch({ truncated: true, files: [
    { file: 'src/a.ts', matches: [hit(1), hit(3)] },
    { file: 'src/b.ts', matches: [hit(5), hit(7)] }
  ] }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('4 kết quả trong 2 tệp — Đạt giới hạn'))
})

it('xóa tìm kiếm khi đang tìm thì summary hết “Đang tìm…”', async () => {
  const searchText = vi.fn().mockImplementation(() => new Promise<TextSearchResult>(() => {}))
  Object.assign(window, { nexgraph: { fs: { searchText } } })
  render(<ProjectSearch projectId="p1" onOpen={vi.fn()} dirtyFiles={new Set()} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm trong tệp' }), { target: { value: 'twice' } })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Đang tìm…'))
  fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }))
  await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent('Đang tìm…'))
})

it('summary có bản Anh', async () => {
  setLocale('en')
  const searchText = vi.fn().mockResolvedValue({ truncated: true, files: [
    { file: 'src/a.ts', matches: [hit(1), hit(3)] },
    { file: 'src/b.ts', matches: [hit(5), hit(7)] }
  ] })
  Object.assign(window, { nexgraph: { fs: { searchText } } })
  render(<ProjectSearch projectId="p1" onOpen={vi.fn()} dirtyFiles={new Set()} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Find in files' }), { target: { value: 'twice' } })
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('4 results in 2 files — Limit reached'))
  expect(tr('Xóa tìm kiếm')).toBe('Clear search')
  expect(tr('Mở rộng tất cả')).toBe('Expand all')
  expect(tr('Thu gọn tất cả')).toBe('Collapse all')
  expect(tr('Mở trong editor')).toBe('Open in editor')
  expect(tr('Thay trong tệp này')).toBe('Replace in this file')
  expect(tr('Đạt giới hạn')).toBe('Limit reached')
})

it('thanh summary gọi đúng refresh, clear, collapse-all, mở editor và lọc tệp', async () => {
  const result: TextSearchResult = { truncated: false, files: [
    { file: 'src/a.ts', matches: [hit(3)] },
    { file: 'src/b.ts', matches: [hit(7)] }
  ] }
  const searchText = vi.fn().mockResolvedValue(result)
  const onOpen = vi.fn()
  Object.assign(window, { nexgraph: { fs: { searchText } } })
  render(<ProjectSearch projectId="p1" onOpen={onOpen} dirtyFiles={new Set()} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm trong tệp' }), { target: { value: 'foo' } })
  await screen.findByText('2 kết quả trong 2 tệp')
  const fileA = screen.getByTitle('src/a.ts')
  // search.collapse_all chỉ được đăng ký trong useEffect sau khi có kết quả; chờ React flush effect rồi mới gọi lệnh.
  await act(async () => {})

  act(() => { expect(runCommand('search.collapse_all')).toBe(true) })
  expect(fileA).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTitle('Dòng 3')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Mở rộng tất cả' }))
  expect(fileA).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByTitle('Dòng 3')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Mở trong editor' }))
  expect(onOpen).toHaveBeenCalledWith('src/a.ts', 3)
  fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }))
  await waitFor(() => expect(searchText).toHaveBeenCalledTimes(2))

  fireEvent.click(screen.getByRole('button', { name: 'Lọc tệp' }))
  expect(screen.getByRole('textbox', { name: 'Chỉ trong tệp' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Bỏ qua tệp' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Xóa tìm kiếm' }))
  expect(screen.getByRole('textbox', { name: 'Tìm trong tệp' })).toHaveValue('')
  expect(screen.queryByTitle('src/a.ts')).toBeNull()
})

it('nút Replace trên dòng kết quả thay đúng tệp khi hover', async () => {
  const searchText = vi.fn().mockResolvedValue({ truncated: false, files: [
    { file: 'src/a.ts', matches: [hit(3), hit(5)] },
    { file: 'src/b.ts', matches: [hit(7)] }
  ] })
  const replaceText = vi.fn().mockResolvedValue({ files: 1, replacements: 2, skipped: [] })
  Object.assign(window, { nexgraph: { fs: { searchText, replaceText } } })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<ProjectSearch projectId="p1" onOpen={vi.fn()} dirtyFiles={new Set(['src/b.ts'])} />)

  fireEvent.change(screen.getByRole('textbox', { name: 'Tìm trong tệp' }), { target: { value: 'foo' } })
  await screen.findByText('3 kết quả trong 2 tệp')
  fireEvent.click(screen.getByRole('button', { name: 'Hiện ô thay' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Thay bằng' }), { target: { value: 'bar' } })

  const replaceButtons = screen.getAllByRole('button', { name: 'Thay trong tệp này' })
  const row = screen.getByTitle('Dòng 3').closest('li')
  fireEvent.mouseEnter(row as Element)
  expect(row?.classList.contains('ps-hit')).toBe(true)
  expect(replaceButtons[0].closest('li')).toBe(row)
  fireEvent.click(replaceButtons[0])
  await waitFor(() => expect(replaceText).toHaveBeenCalledWith('p1', { query: 'foo' }, 'bar', ['src/a.ts']))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Đã thay 2 chỗ trong 1 tệp.'))
  expect(replaceButtons[2]).toBeDisabled()
})
