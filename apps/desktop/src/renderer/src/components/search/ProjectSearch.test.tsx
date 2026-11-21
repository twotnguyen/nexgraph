// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ProjectSearch } from './ProjectSearch'

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
