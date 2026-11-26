// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindingFor, formatKey, installKeymap, registerHandler, runCommand, setBinding } from '../../shared/lib/commands'
import { CommandPaletteHost } from './CommandPalette'

describe('CommandPalette recorder', () => {
  let uninstall: () => void
  let unregister: (() => void)[]
  let exported = vi.fn()
  let settings = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    setBinding('graph.export', null)
    setBinding('settings.open', null)
    exported = vi.fn()
    settings = vi.fn()
    unregister = [registerHandler('graph.export', exported), registerHandler('settings.open', settings)]
    uninstall = installKeymap()
    render(<CommandPaletteHost />)
    act(() => { runCommand('command_palette.toggle') })
  })

  afterEach(() => {
    uninstall()
    for (const remove of unregister) remove()
    setBinding('graph.export', null)
    setBinding('settings.open', null)
    vi.useRealTimers()
  })

  it('reflects the selected command and records a two-stroke binding without running it', () => {
    const input = screen.getByRole('combobox', { name: 'Bảng lệnh' })
    fireEvent.mouseMove(screen.getAllByRole('option').find((row) => row.dataset.commandId === 'graph.export')!)
    expect(screen.getByRole('button', { name: /Thêm phím tắt/ })).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', ctrlKey: true })
    const recorder = screen.getByRole('textbox', { name: 'Nhấn tổ hợp phím mới' })
    expect(recorder).toHaveFocus()
    expect(settings).not.toHaveBeenCalled()
    fireEvent.keyDown(recorder, { key: 'k', code: 'KeyK', ctrlKey: true })
    fireEvent.keyDown(recorder, { key: 'e', code: 'KeyE', ctrlKey: true })
    fireEvent.keyDown(recorder, { key: 'Enter', code: 'Enter' })
    expect(bindingFor('graph.export')).toBe('mod+k mod+e')
    expect(JSON.parse(localStorage.getItem('nexgraph.keybindings')!)['graph.export']).toBe('mod+k mod+e')
    expect(screen.getByRole('button', { name: /Đổi phím tắt.*⌘↵/ })).toBeInTheDocument()
    expect(input).toHaveFocus()
    expect(exported).not.toHaveBeenCalled()
  })

  it('updates the footer for mouse selection and opens the recorder with Command+Enter', () => {
    act(() => setBinding('graph.export', 'mod+shift+e'))
    act(() => setBinding('settings.open', ''))
    const input = screen.getByRole('combobox', { name: 'Bảng lệnh' })
    const rows = screen.getAllByRole('option')
    fireEvent.mouseMove(rows.find((row) => row.dataset.commandId === 'graph.export')!)
    expect(screen.getByRole('button', { name: /Đổi phím tắt/ })).toBeInTheDocument()
    fireEvent.mouseMove(rows.find((row) => row.dataset.commandId === 'settings.open')!)
    expect(screen.getByRole('button', { name: /Thêm phím tắt/ })).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', metaKey: true })
    expect(screen.getByRole('textbox', { name: 'Nhấn tổ hợp phím mới' })).toHaveFocus()
    expect(exported).not.toHaveBeenCalled()
    expect(settings).not.toHaveBeenCalled()
  })

  it('cancels the recorder with Escape', () => {
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Bảng lệnh' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('button', { name: /Thêm phím tắt/ }))
    const recorder = screen.getByRole('textbox', { name: 'Nhấn tổ hợp phím mới' })
    fireEvent.keyDown(recorder, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Nhấn tổ hợp phím mới' })).toBeNull()
  })

  it('preserves the global shortcut for closing the palette', () => {
    const input = screen.getByRole('combobox', { name: 'Bảng lệnh' })
    fireEvent.keyDown(input, { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true })
    expect(screen.queryByRole('combobox', { name: 'Bảng lệnh' })).toBeNull()
  })

  it('allows the footer to cancel recording and run the selected command', () => {
    const input = screen.getByRole('combobox', { name: 'Bảng lệnh' })
    const rows = screen.getAllByRole('option')
    fireEvent.mouseMove(rows.find((row) => row.dataset.commandId === 'graph.export')!)
    fireEvent.click(screen.getByRole('button', { name: /Thêm phím tắt/ }))
    const recorder = screen.getByRole('textbox', { name: 'Nhấn tổ hợp phím mới' })
    fireEvent.keyDown(recorder, { key: 'j', code: 'KeyJ', ctrlKey: true })
    fireEvent.keyDown(recorder, { key: 'Escape', code: 'Escape' })
    expect(bindingFor('graph.export')).toBe('')
    expect(screen.queryByRole('textbox', { name: 'Nhấn tổ hợp phím mới' })).toBeNull()
    expect(input).toHaveFocus()
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /Chạy/ }))
    act(() => vi.runAllTimers())
    expect(exported).toHaveBeenCalledOnce()
    expect(settings).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox', { name: 'Bảng lệnh' })).toBeNull()
  })

  it('runs the selected command with plain Enter', () => {
    const input = screen.getByRole('combobox', { name: 'Bảng lệnh' })
    vi.useFakeTimers()
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    act(() => vi.runAllTimers())
    expect(settings).toHaveBeenCalledOnce()
    expect(exported).not.toHaveBeenCalled()
  })

describe('CommandPalette chrome', () => {
  it('shows a keycap from the keymap on every command row without undefined text', () => {
    const rows = screen.getAllByRole('option')
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) {
      expect(row.querySelector('kbd')).not.toBeNull()
      expect(row.textContent).not.toMatch(/undefined/)
    }
    const exportRow = rows.find((row) => row.dataset.commandId === 'graph.export')!
    expect(exportRow.querySelector('kbd')).toHaveTextContent('—')
    const settingsRow = rows.find((row) => row.dataset.commandId === 'settings.open')!
    expect(settingsRow.querySelector('kbd')).toHaveTextContent(formatKey(bindingFor('settings.open')))
  })

  it('offers add, change and run footer actions backed by real handlers', () => {
    vi.useFakeTimers()
    const input = screen.getByRole('combobox', { name: 'Bảng lệnh' })
    const exportRow = screen.getAllByRole('option').find((row) => row.dataset.commandId === 'graph.export')!
    fireEvent.mouseMove(exportRow)
    fireEvent.click(screen.getByRole('button', { name: /Thêm phím tắt/ }))
    const recorder = screen.getByRole('textbox', { name: 'Nhấn tổ hợp phím mới' })
    fireEvent.keyDown(recorder, { key: 'j', code: 'KeyJ', ctrlKey: true })
    fireEvent.keyDown(recorder, { key: 'Enter', code: 'Enter' })
    expect(bindingFor('graph.export')).toBe('mod+j')
    fireEvent.click(screen.getByRole('button', { name: /Đổi phím tắt/ }))
    expect(screen.getByRole('textbox', { name: 'Nhấn tổ hợp phím mới' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Nhấn tổ hợp phím mới' }), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /Chạy/ }))
    act(() => vi.runAllTimers())
    expect(exported).toHaveBeenCalledOnce()
    expect(input).not.toBeInTheDocument()
  })

  it('opens filtered to indent when the indentation selector command runs', () => {
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Bảng lệnh' }), { key: 'Escape' })
    expect(screen.queryByRole('combobox', { name: 'Bảng lệnh' })).toBeNull()
    act(() => { runCommand('editor.indentation_selector') })
    const input = screen.getByRole('combobox', { name: 'Bảng lệnh' }) as HTMLInputElement
    expect(input.value).toBe('indent')
    expect(screen.getAllByRole('option').some((row) => row.dataset.commandId === 'editor.indentation_selector')).toBe(true)
  })
})
})
