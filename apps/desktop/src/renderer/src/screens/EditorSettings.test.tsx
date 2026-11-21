// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getEditorPrefs, setEditorPrefs } from '../state/editorPrefs'
import { installNexgraph } from '../test-utils'
import { SettingsScreen } from './SettingsScreen'

afterEach(() => {
  cleanup()
  setEditorPrefs({ fontSize: 13, terminalFontSize: 12, tabSize: 4, wordWrap: 'off', formatOnSave: false, autoSave: 'off', autoSaveDelay: 1000, iconTheme: 'symbols' })
  localStorage.removeItem('nexgraph.editor.preferences')
})

it('updates editor settings and icon theme from the settings screen', async () => {
  installNexgraph()
  render(<SettingsScreen onBack={vi.fn()} />)
  await act(async () => {})
  fireEvent.change(screen.getByLabelText('Cỡ chữ editor'), { target: { value: '18' } })
  fireEvent.change(screen.getByLabelText('Cỡ chữ terminal'), { target: { value: '17' } })
  fireEvent.change(screen.getByLabelText('Tab size'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('Ngắt dòng'), { target: { value: 'on' } })
  fireEvent.click(screen.getByRole('switch', { name: 'Định dạng khi lưu' }))
  fireEvent.change(screen.getByLabelText('Tự lưu'), { target: { value: 'afterDelay' } })
  fireEvent.change(screen.getByLabelText('Thời gian chờ (ms)'), { target: { value: '1500' } })
  fireEvent.change(screen.getByLabelText('Bộ icon tệp'), { target: { value: 'mono' } })
  expect(getEditorPrefs()).toMatchObject({ fontSize: 18, terminalFontSize: 17, tabSize: 2, wordWrap: 'on', formatOnSave: true, autoSave: 'afterDelay', autoSaveDelay: 1500, iconTheme: 'mono' })
})

it('clamps invalid numeric drafts on blur without overwriting a valid setting while typing', async () => {
  installNexgraph()
  render(<SettingsScreen onBack={vi.fn()} />)
  await act(async () => {})
  const font = screen.getByLabelText('Cỡ chữ editor')
  fireEvent.change(font, { target: { value: '' } })
  expect(getEditorPrefs().fontSize).toBe(13)
  fireEvent.blur(font)
  expect(font).toHaveValue(13)
  fireEvent.change(font, { target: { value: '100' } })
  expect(getEditorPrefs().fontSize).toBe(13)
  fireEvent.blur(font)
  expect(getEditorPrefs().fontSize).toBe(32)
  expect(font).toHaveValue(32)
})
