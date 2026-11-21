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
