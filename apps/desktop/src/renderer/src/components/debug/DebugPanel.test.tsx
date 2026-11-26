// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DebugEvent } from '@nexgraph/contracts/api'
import { setDebugProject, toggleBreakpoint, useDebugLayout } from '../../state/debugState'
import { DebugPanel } from './DebugPanel'


// Bảng chỉ đăng ký sự kiện một lần; dùng chung handler để test thứ hai vẫn phát được sự kiện.
let emit: (event: DebugEvent) => void = () => {}
const onEvent = (handler: (event: DebugEvent) => void) => { emit = handler; return () => {} }
afterEach(() => vi.unstubAllGlobals())

it('bật tắt điểm dừng, tính watch và console theo frame đang dừng', async () => {

  const evaluate = vi.fn(async (expression: string) => ({ result: expression === 'items' ? '[1, 2, 3]' : '10', variablesReference: 0 }))
  const api = {
    adapterStatus: async () => ({ node: true, python: true }),
    configs: async () => [],
    onEvent,
    start: async () => {},
    setBreakpoints: vi.fn(async () => {}),
    stackTrace: async () => [{ id: 7, name: 'main', file: 'a.py', line: 4, column: 1 }],
    scopes: async () => [],
    evaluate
  }
  vi.stubGlobal('nexgraph', { debug: api })
  setDebugProject('panel-test')
  toggleBreakpoint('a.py', 4)
  const open = vi.fn()
  render(<DebugPanel projectId="panel-test" target="a.py" onOpenFile={open} />)
  fireEvent.click(screen.getByRole('button', { name: 'a.py:4' }))
  expect(open).toHaveBeenCalledWith('a.py', 4)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Bật điểm dừng a.py:4' }))
  expect(screen.getByRole('checkbox', { name: 'Bật điểm dừng a.py:4' })).not.toBeChecked()
  fireEvent.change(screen.getByRole('textbox', { name: 'Thêm biểu thức theo dõi' }), { target: { value: 'total * 10' } })
  fireEvent.click(screen.getByRole('button', { name: 'Thêm biểu thức theo dõi' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bắt đầu gỡ lỗi' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu gỡ lỗi' }))
  act(() => emit({ type: 'state', state: 'stopped', threadId: 1 }))
  await waitFor(() => expect(screen.getByText('total * 10')).toBeInTheDocument())
  await waitFor(() => expect(evaluate).toHaveBeenCalledWith('total * 10', 7, 'watch'))
  const consoleInput = screen.getByRole('textbox', { name: 'Tính biểu thức' })
  fireEvent.change(consoleInput, { target: { value: 'items' } })
  fireEvent.submit(consoleInput.closest('form')!)
  await waitFor(() => expect(screen.getByText(/\[1, 2, 3\]/)).toBeInTheDocument())
  fireEvent.keyDown(consoleInput, { key: 'ArrowUp' })
  expect(consoleInput).toHaveValue('items')
  act(() => emit({ type: 'state', state: 'terminated' }))
})

it('hiện module và nguồn đã tải, đồng thời báo lỗi khi danh sách rỗng', async () => {
  vi.stubGlobal('nexgraph', { debug: {
    adapterStatus: async () => ({ node: true, python: true }),
    configs: async () => [],
    onEvent,
    modules: async () => [{ id: 1, name: 'app-module', path: '/proj/app.js', version: '1.0' }],
    loadedSources: async () => [{ path: '/proj/main.js' }]
  } })
  setDebugProject('inventory-test')
  render(<DebugPanel projectId="inventory-test" target="app.js" onOpenFile={() => {}} />)
  act(() => emit({ type: 'state', state: 'stopped', threadId: 1 }))
  await waitFor(() => expect(screen.getByText(/app-module · 1\.0/)).toBeInTheDocument())
  await waitFor(() => expect(screen.getByText('/proj/main.js')).toBeInTheDocument())
  act(() => emit({ type: 'notice', target: 'loadedSources', text: 'Không lấy được nguồn đã tải: lỗi' }))
  await waitFor(() => expect(screen.getByText('Không lấy được nguồn đã tải: lỗi')).toBeInTheDocument())
  expect(screen.queryByText('/proj/main.js')).not.toBeInTheDocument()
  act(() => emit({ type: 'notice', target: 'modules', code: 'debug.modules_failed', detail: 'boom' }))
  await waitFor(() => expect(screen.getByText('Không lấy được modules: boom')).toBeInTheDocument())
  act(() => emit({ type: 'state', state: 'terminated' }))
})

it('giữ trạng thái thu gọn của section theo từng adapter/kind', () => {
  localStorage.removeItem('nexgraph.debug.layout.node')
  localStorage.removeItem('nexgraph.debug.layout.python')
  vi.stubGlobal('nexgraph', { debug: {
    adapterStatus: async () => ({ node: true, python: true }),
    configs: async () => [],
    onEvent,
    modules: async () => [],
    loadedSources: async () => []
  } })
  setDebugProject('layout-test')
  const view = render(<DebugPanel projectId="layout-test" target="a.js" onOpenFile={() => {}} />)
  expect(view.container.querySelector('.dbg-output')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Thu gọn Debug console' }))
  expect(view.container.querySelector('.dbg-output')).toBeNull()
  expect(localStorage.getItem('nexgraph.debug.layout.node')).toBe(JSON.stringify({ collapsed: { console: true }, heights: {} }))

  view.rerender(<DebugPanel projectId="layout-test" target="a.py" onOpenFile={() => {}} />)
  expect(view.container.querySelector('.dbg-output')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Thu gọn Nguồn đã tải' }))
  expect(localStorage.getItem('nexgraph.debug.layout.python')).toBe(JSON.stringify({ collapsed: { sources: true }, heights: {} }))

  view.rerender(<DebugPanel projectId="layout-test" target="a.js" onOpenFile={() => {}} />)
  expect(view.container.querySelector('.dbg-output')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Mở rộng Debug console' }))
  expect(view.container.querySelector('.dbg-output')).not.toBeNull()
  expect(localStorage.getItem('nexgraph.debug.layout.node')).toBe(JSON.stringify({ collapsed: {}, heights: {} }))
  expect(localStorage.getItem('nexgraph.debug.layout.python')).toBe(JSON.stringify({ collapsed: { sources: true }, heights: {} }))
  act(() => emit({ type: 'state', state: 'terminated' }))
})

it('lưu layout dạng {collapsed, heights} và đọc được state boolean cũ', () => {
  localStorage.removeItem('nexgraph.debug.layout.node')
  const view = renderHook(() => useDebugLayout('node'))
  act(() => view.result.current.toggle('console'))
  expect(JSON.parse(localStorage.getItem('nexgraph.debug.layout.node')!)).toEqual({ collapsed: { console: true }, heights: {} })
  act(() => view.result.current.setHeight('console', 184))
  expect(JSON.parse(localStorage.getItem('nexgraph.debug.layout.node')!)).toEqual({ collapsed: { console: true }, heights: { console: 184 } })
  expect(view.result.current.collapsed.console).toBe(true)
  expect(view.result.current.heights.console).toBe(184)

  localStorage.setItem('nexgraph.debug.layout.node', JSON.stringify({ stack: true, variables: false }))
  view.rerender()
  expect(view.result.current.collapsed).toEqual({ stack: true })
  expect(view.result.current.heights).toEqual({})

  localStorage.setItem('nexgraph.debug.layout.node', JSON.stringify({ collapsed: { sources: true }, heights: { sources: 208 } }))
  view.unmount()
  const reloaded = renderHook(() => useDebugLayout('node'))
  expect(reloaded.result.current.collapsed).toEqual({ sources: true })
  expect(reloaded.result.current.heights.sources).toBe(208)
})

it('resize section console bằng phím và lưu chiều cao theo kind', () => {
  localStorage.removeItem('nexgraph.debug.layout.node')
  vi.stubGlobal('nexgraph', { debug: {
    adapterStatus: async () => ({ node: true, python: true }),
    configs: async () => [],
    onEvent,
    modules: async () => [],
    loadedSources: async () => []
  } })
  setDebugProject('resize-test')
  render(<DebugPanel projectId="resize-test" target="a.js" onOpenFile={() => {}} />)
  const separator = screen.getByRole('separator', { name: 'Chiều cao Debug console' })
  separator.focus()
  fireEvent.keyDown(separator, { key: 'ArrowUp' })
  expect(separator).toHaveAttribute('aria-valuenow', '184')
  expect(JSON.parse(localStorage.getItem('nexgraph.debug.layout.node')!)).toEqual({ collapsed: {}, heights: { console: 184 } })
  expect(document.activeElement).toBe(separator)
  act(() => emit({ type: 'state', state: 'terminated' }))
})
