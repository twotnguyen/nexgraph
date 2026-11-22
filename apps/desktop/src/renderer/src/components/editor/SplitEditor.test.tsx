// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setLocale } from '../../state/locale'
import { SplitEditor } from './SplitEditor'

const mirrors = vi.hoisted(() => ({ createMirror: vi.fn() }))
vi.mock('./monaco', () => ({ createMirror: mirrors.createMirror }))
const prefs = vi.hoisted(() => ({ vim: false }))
vi.mock('../../state/editorPrefs', async (importOriginal) => ({ ...(await importOriginal()), useVimMode: () => prefs.vim }))

const mirror = () => ({ setVim: vi.fn(), setReadOnly: vi.fn(), onDisposeModel: vi.fn(), dispose: vi.fn() })

beforeEach(() => {
  prefs.vim = false
  mirrors.createMirror.mockReset()
  mirrors.createMirror.mockReturnValue(mirror())
  setLocale('vi')
})
afterEach(() => setLocale('vi'))

it('mở mirror ở chế độ chỉ đọc và áp cả khi toggle sau khi đã mở', () => {
  const view = render(<SplitEditor projectId="p1" file="src/a.ts" locked onClose={vi.fn()} />)
  expect(mirrors.createMirror).toHaveBeenCalledWith(expect.anything(), 'src/a.ts', 'p1', true)
  const handle = mirrors.createMirror.mock.results[0].value
  view.rerender(<SplitEditor projectId="p1" file="src/a.ts" locked={false} onClose={vi.fn()} />)
  expect(handle.setReadOnly).toHaveBeenCalledWith(false)
  view.rerender(<SplitEditor projectId="p1" file="src/a.ts" locked onClose={vi.fn()} />)
  expect(handle.setReadOnly).toHaveBeenLastCalledWith(true)
})

it('bật Vim mode thì mirror.setVim nhận node trạng thái', () => {
  prefs.vim = true
  render(<SplitEditor projectId="p1" file="src/a.ts" onClose={vi.fn()} />)
  const handle = mirrors.createMirror.mock.results[0].value
  expect(handle.setVim).toHaveBeenLastCalledWith(expect.any(HTMLElement))
})

it('giữ dấu \\ trong nhãn tiếng Anh của nút đóng khung chia đôi', () => {
  setLocale('en')
  render(<SplitEditor projectId="p1" file="src/a.ts" onClose={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Close split pane' }).title).toBe('Close split pane (⌘\\)')
})
