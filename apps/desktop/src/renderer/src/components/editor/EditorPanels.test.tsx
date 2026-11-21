// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LspDiagnosticsEvent, LspDocumentSymbol, LspRange } from '@shared/api'
import type { ActiveEditor } from '../../state/activeEditor'
import { startDiagnostics } from '../../state/diagnostics'
import { setLocale } from '../../state/locale'
import { DiagnosticsPanel, OutlinePanel } from './EditorPanels'

const range = (startLine: number, endLine: number): LspRange => ({
  start: { line: startLine, character: 0 }, end: { line: endLine, character: 0 }
})
const symbol = (name: string, startLine: number, endLine: number, children: LspDocumentSymbol[] = []): LspDocumentSymbol => ({
  name, kind: 5, range: range(startLine, endLine), selectionRange: range(startLine, endLine), children
})
function editorAt(file: string, line: number): { editor: ActiveEditor; cursor: (line: number, column: number) => void; off: () => void } {
  let cursor: (line: number, column: number) => void = () => {}
  const off = vi.fn()
  const editor: ActiveEditor = {
    file, text: () => '', handle: {
      getValue: () => '', setValue: vi.fn(), onChange: vi.fn(), setReadOnly: vi.fn(), dispose: vi.fn(),
      revealLines: vi.fn(), revealPosition: vi.fn(),
      getPosition: () => ({ line, column: 1 }),
      onCursor: (cb) => { cursor = cb; return off }
    }
  }
  return { editor, cursor: (nextLine, column) => cursor(nextLine, column), off }
}

const symbols = [symbol('outer', 0, 4, [symbol('childFn', 1, 3)]), symbol('zzz', 10, 12)]

beforeEach(() => setLocale('vi'))

describe('OutlinePanel', () => {
  it('filters symbols and clears the filter', () => {
    const { editor } = editorAt('a.ts', 30)
    render(<OutlinePanel editor={editor} symbols={symbols} error={null} />)
    fireEvent.change(screen.getByLabelText('Tìm ký hiệu'), { target: { value: 'childFn' } })
    expect(screen.queryByRole('button', { name: 'zzz' })).toBeNull()
    expect(screen.getByRole('button', { name: 'childFn' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Xóa bộ lọc' }))
    expect(screen.getByRole('button', { name: 'zzz' })).toBeTruthy()
  })

  it('pins the active editor and unpins back to the live one', () => {
    const first = editorAt('a.ts', 30)
    const second = editorAt('b.ts', 30)
    const secondSymbols = [symbol('secondFn', 0, 4)]
    const view = render(<OutlinePanel editor={first.editor} symbols={symbols} error={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ghim editor' }))
    expect(screen.getByRole('button', { name: 'Bỏ ghim' }).getAttribute('aria-pressed')).toBe('true')
    view.rerender(<OutlinePanel editor={second.editor} symbols={secondSymbols} error={null} />)
    expect(screen.getByRole('button', { name: 'outer' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'secondFn' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ ghim' }))
    expect(screen.getByRole('button', { name: 'secondFn' })).toBeTruthy()
  })

  it('collapses and expands every symbol', () => {
    const { editor } = editorAt('a.ts', 30)
    render(<OutlinePanel editor={editor} symbols={symbols} error={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn tất cả' }))
    expect(screen.queryByRole('button', { name: 'childFn' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng tất cả' }))
    expect(screen.getByRole('button', { name: 'childFn' })).toBeTruthy()
  })

  it('reveals the symbol under the cursor and reopens its ancestors', () => {
    const { editor, cursor } = editorAt('a.ts', 30)
    render(<OutlinePanel editor={editor} symbols={symbols} error={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn tất cả' }))
    act(() => cursor(2, 1))
    const active = screen.getByRole('button', { name: 'childFn' })
    expect(active.className).toContain('outline-active')
    expect(active.getAttribute('data-symbol-key')).toContain('childFn')
  })

  it('disposes the cursor subscription when the editor changes or unmounts', () => {
    const first = editorAt('a.ts', 30)
    const second = editorAt('b.ts', 30)
    const view = render(<OutlinePanel editor={first.editor} symbols={symbols} error={null} />)
    view.rerender(<OutlinePanel editor={second.editor} symbols={symbols} error={null} />)
    expect(first.off).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(second.off).toHaveBeenCalledTimes(1)
  })

  it('scrolls to the active symbol after reopening its collapsed group', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { editor, cursor } = editorAt('a.ts', 30)
    render(<OutlinePanel editor={editor} symbols={symbols} error={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn tất cả' }))
    act(() => cursor(2, 1))
    expect(screen.getByRole('button', { name: 'childFn' }).className).toContain('outline-active')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('keeps a branch collapsed when the cursor stays in the same symbol', () => {
    const { editor, cursor } = editorAt('a.ts', 30)
    render(<OutlinePanel editor={editor} symbols={symbols} error={null} />)
    act(() => cursor(2, 1))
    fireEvent.click(screen.getByRole('button', { name: 'Thu gọn outer' }))
    expect(screen.queryByRole('button', { name: 'childFn' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mở rộng outer' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('reveals the picked symbol in the editor', () => {
    const { editor } = editorAt('a.ts', 30)
    render(<OutlinePanel editor={editor} symbols={symbols} error={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'childFn' }))
    expect(editor.handle.revealPosition).toHaveBeenCalledWith(2, 1)
  })
})

describe('DiagnosticsPanel', () => {
  let emit: (event: LspDiagnosticsEvent) => void = () => {}
  let stop: () => void = () => {}
  let open = vi.fn(async () => {})

  beforeEach(() => {
    localStorage.clear()
    open = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    Object.assign(window, { nexgraph: {
      fs: { read: vi.fn(async () => ({ text: 'nội dung từ đĩa' })) },
      lsp: { onDiagnostics: (cb: (event: LspDiagnosticsEvent) => void) => { emit = cb; return () => {} }, open, close }
    } })
    stop = startDiagnostics()
  })
  afterEach(() => stop())

  it('acknowledges a diagnostic and keeps it acknowledged after reload', () => {
    act(() => emit({ projectId: 'p1', file: 'ack.ts', diagnostics: [
      { range: range(4, 4), severity: 1, message: 'Lỗi đầu' },
      { range: range(8, 8), severity: 2, message: 'Cảnh báo sau' }
    ] }))
    const view = render(<DiagnosticsPanel projectId="p1" onOpen={vi.fn()} />)
    expect(within(screen.getByRole('list', { name: 'Chưa xem' })).getByText('Lỗi: Lỗi đầu')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Đã xem' })[0])
    const unseen = screen.getByRole('list', { name: 'Chưa xem' })
    expect(within(unseen).queryByText('Lỗi: Lỗi đầu')).toBeNull()
    expect(within(unseen).getByText('Cảnh báo: Cảnh báo sau')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Đã xem' })).getByText('Lỗi: Lỗi đầu')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /ack\.ts/ }).textContent).toContain('(1)')
    expect(JSON.parse(localStorage.getItem('nexgraph.diagnostics.ack:p1') ?? '[]')).toEqual(['ack.ts:4'])

    view.unmount()
    render(<DiagnosticsPanel projectId="p1" onOpen={vi.fn()} />)
    expect(within(screen.getByRole('list', { name: 'Chưa xem' })).queryByText('Lỗi: Lỗi đầu')).toBeNull()
    expect(within(screen.getByRole('list', { name: 'Đã xem' })).getByText('Lỗi: Lỗi đầu')).toBeTruthy()
  })
  it('ẩn và hiện cảnh báo bằng nút toggle', () => {
    act(() => emit({ projectId: 'p1', file: 'warn.ts', diagnostics: [
      { range: range(1, 1), severity: 1, message: 'Lỗi giữ lại' },
      { range: range(2, 2), severity: 2, message: 'Cảnh báo ẩn' }
    ] }))
    render(<DiagnosticsPanel projectId="p1" onOpen={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: 'Bao gồm cảnh báo' })
    expect(screen.getByText('Cảnh báo: Cảnh báo ẩn')).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.queryByText('Cảnh báo: Cảnh báo ẩn')).toBeNull()
    expect(screen.getByText('Lỗi: Lỗi giữ lại')).toBeTruthy()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByText('Cảnh báo: Cảnh báo ẩn')).toBeTruthy()
  })

  it('refresh mở lại đúng tệp của project hiện tại', async () => {
    act(() => {
      emit({ projectId: 'p1', file: 'a.ts', diagnostics: [{ range: range(0, 0), severity: 1, message: 'Lỗi A' }] })
      emit({ projectId: 'p2', file: 'b.ts', diagnostics: [{ range: range(0, 0), severity: 1, message: 'Lỗi B' }] })
    })
    render(<DiagnosticsPanel projectId="p1" onOpen={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới chẩn đoán' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('p1', 'a.ts', 'nội dung từ đĩa'))
    expect(open).not.toHaveBeenCalledWith('p2', 'b.ts', expect.anything())
  })
})
