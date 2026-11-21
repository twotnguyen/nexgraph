// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPaletteHost } from '../components/layout/CommandPalette'
import { rankFiles } from '../components/layout/FileFinder'
import { KeymapEditor } from '../components/settings/KeymapEditor'
import { bindingFor, eventToStroke, formatKey, installKeymap, setBinding, useCommand } from './commands'
import { fuzzyMatch } from './fuzzy'

function Probe({ onExport }: { onExport: () => void }) {
  useCommand('graph.export', onExport)
  useCommand('settings.open', () => {})
  return null
}

// jsdom không phải macOS: mod = Ctrl.
const press = (init: KeyboardEventInit & { code?: string }) => fireEvent.keyDown(document.body, init)

describe('bảng lệnh và phím tắt', () => {
  let uninstall: () => void
  beforeEach(() => {
    localStorage.clear()
    setBinding('graph.export', null)
    setBinding('settings.open', null)
    uninstall = installKeymap()
  })
  afterEach(() => uninstall())

  it('Ctrl+Shift+P mở bảng lệnh, gõ mờ không dấu rồi Enter chạy lệnh', () => {
    const exported = vi.fn()
    render(<><Probe onExport={exported} /><CommandPaletteHost /></>)
    press({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true })
    const input = screen.getByRole('combobox', { name: 'Bảng lệnh' })
    // Chỉ lệnh có handler ở màn hiện tại mới hiện.
    expect(screen.getAllByRole('option').map((o) => o.dataset.commandId).sort()).toEqual(['graph.export', 'settings.open'])
    fireEvent.change(input, { target: { value: 'xuat dt' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    vi.useFakeTimers()
    fireEvent.keyDown(input, { key: 'Enter' })
    act(() => vi.runAllTimers())
    vi.useRealTimers()
    expect(exported).toHaveBeenCalledOnce()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('ghi phím mới ở trang Phím tắt thì phím đó chạy lệnh; phím cũ bị gỡ khỏi lệnh khác', () => {
    const exported = vi.fn()
    render(<><Probe onExport={exported} /><KeymapEditor /></>)
    const row = document.querySelector('tr[data-command-id="graph.export"]')!
    fireEvent.click(row.querySelector('button')!)
    const recorder = screen.getByRole('textbox', { name: 'Nhấn tổ hợp phím mới' })
    fireEvent.keyDown(recorder, { key: ',', code: 'Comma', ctrlKey: true })
    fireEvent.keyDown(recorder, { key: 'Enter' })
    expect(bindingFor('graph.export')).toBe('mod+,')
    expect(bindingFor('settings.open')).toBe('') // trước đó giữ mod+,
    press({ key: ',', code: 'Comma', ctrlKey: true })
    expect(exported).toHaveBeenCalledOnce()
    expect(JSON.parse(localStorage.getItem('nexgraph.keybindings')!)).toEqual({ 'graph.export': 'mod+,', 'settings.open': '' })
  })

  it('hợp âm hai bước chỉ chạy khi bấm đủ hai phím', () => {
    const exported = vi.fn()
    setBinding('graph.export', 'mod+k mod+e')
    render(<Probe onExport={exported} />)
    press({ key: 'e', code: 'KeyE', ctrlKey: true })
    expect(exported).not.toHaveBeenCalled()
    press({ key: 'k', code: 'KeyK', ctrlKey: true })
    press({ key: 'e', code: 'KeyE', ctrlKey: true })
    expect(exported).toHaveBeenCalledOnce()
  })
})

describe('khớp mờ', () => {
  it('khớp dãy con không dấu và ưu tiên đầu từ', () => {
    expect(fuzzyMatch('cd', 'Mở cài đặt')?.positions).toEqual([3, 7])
    expect(fuzzyMatch('xyz', 'Mở cài đặt')).toBeNull()
    expect(fuzzyMatch('ws', 'WorkspaceScreen')!.score).toBeGreaterThan(fuzzyMatch('ws', 'blowsup')!.score)
  })

  it('tìm tệp ưu tiên khớp tên tệp hơn khớp thư mục', () => {
    const ranked = rankFiles(['app/main/index.ts', 'src/app.ts', 'docs/main.md'], 'main')
    expect(ranked[0].item).toBe('docs/main.md')
    expect(ranked.map((r) => r.item)).toContain('app/main/index.ts')
    expect(ranked[0].positions).toEqual([5, 6, 7, 8])
  })

  it('định dạng phím theo nền tảng', () => {
    expect(formatKey('mod+shift+p', true)).toBe('⌘⇧P')
    expect(formatKey('mod+k mod+t', false)).toBe('Ctrl+K Ctrl+T')
    expect(eventToStroke({ key: 'Π', code: 'KeyP', metaKey: false, ctrlKey: true, altKey: true, shiftKey: false })).toBe('mod+alt+p')
  })
})
