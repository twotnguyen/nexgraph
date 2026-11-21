// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getEditorPrefs, setBlame, setEditorPrefs } from '../state/editorPrefs'
import { installNexgraph } from '../test-utils'
import { SettingsScreen } from './SettingsScreen'

beforeEach(() => {
  localStorage.clear()
  setBlame(false)
  setEditorPrefs({ blameDelay: 0, blameSummary: true })
})
afterEach(cleanup)

async function open() {
  installNexgraph()
  render(<SettingsScreen onBack={vi.fn()} />)
  await act(async () => {})
}
const navItems = () => screen.getAllByRole('button', { name: /^(Version Control|Panels|Giao diện|Phím tắt)$/ }).map((button) => button.textContent)

it('trang Version Control: bật blame, độ trễ và tóm tắt ghi vào tuỳ chọn thật', async () => {
  await open()
  expect(screen.getByRole('heading', { level: 1, name: 'Version Control' })).toBeInTheDocument()
  // Độ trễ và tóm tắt chỉ có nghĩa khi blame bật.
  expect(screen.queryByLabelText('Độ trễ (ms)')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('switch', { name: 'Hiện blame' }))
  expect(localStorage.getItem('nexgraph.editor.blame')).toBe('1')
  fireEvent.change(screen.getByLabelText('Độ trễ (ms)'), { target: { value: '300' } })
  fireEvent.click(screen.getByRole('switch', { name: 'Kèm tóm tắt commit' }))
  expect(getEditorPrefs()).toMatchObject({ blameDelay: 300, blameSummary: false })
  fireEvent.click(screen.getByRole('switch', { name: 'Hiện blame' }))
  expect(localStorage.getItem('nexgraph.editor.blame')).toBe('0')
  expect(screen.queryByLabelText('Độ trễ (ms)')).not.toBeInTheDocument()
})

it('trang Panels: khung chat, terminal, cây tệp mở sẵn và thanh trạng thái ghi vào kho bố cục', async () => {
  await open()
  expect(screen.getByRole('heading', { level: 1, name: 'Panels' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Vị trí'), { target: { value: 'right' } })
  fireEvent.change(screen.getByLabelText('Độ rộng (px)'), { target: { value: '420' } })
  fireEvent.change(screen.getByLabelText('Chiều cao terminal (px)'), { target: { value: '360' } })
  fireEvent.click(screen.getByRole('switch', { name: 'Mở sẵn cây tệp' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Hiện thanh trạng thái' }))
  expect(localStorage.getItem('nexgraph.chat.dock')).toBe('right')
  expect(localStorage.getItem('nexgraph.chat.width')).toBe('420')
  expect(localStorage.getItem('nexgraph.terminal.height')).toBe('360')
  expect(localStorage.getItem('nexgraph.layout.explorer')).toBe('0')
  expect(localStorage.getItem('nexgraph.layout.statusbar')).toBe('0')
  // Công tắc phản ánh lại giá trị đã lưu.
  expect(screen.getByRole('switch', { name: 'Mở sẵn cây tệp' })).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByLabelText('Vị trí')).toHaveValue('right')
})

it('giá trị ngoài khoảng được kẹp khi rời ô nhập', async () => {
  await open()
  const width = screen.getByLabelText('Độ rộng (px)')
  fireEvent.change(width, { target: { value: '9000' } })
  expect(localStorage.getItem('nexgraph.chat.width')).toBeNull()
  fireEvent.blur(width)
  expect(localStorage.getItem('nexgraph.chat.width')).toBe('640')
  expect(width).toHaveValue(640)
})

it('ô tìm đưa về đúng trang Version Control hoặc Panels', async () => {
  await open()
  const search = screen.getByRole('searchbox', { name: 'Tìm cài đặt' })
  await userEvent.type(search, 'blame')
  expect(navItems()).toEqual(['Version Control'])
  await userEvent.clear(search)
  await userEvent.type(search, 'thanh trạng thái')
  expect(navItems()).toEqual(['Panels'])
  await userEvent.clear(search)
  await userEvent.type(search, 'vscode')
  expect(navItems()).toEqual(['Phím tắt'])
})
