// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DebugEvent } from '@shared/api'
import { setDebugProject, toggleBreakpoint } from '../../state/debugState'
import { DebugPanel } from './DebugPanel'

afterEach(() => vi.unstubAllGlobals())

it('bật tắt điểm dừng, tính watch và console theo frame đang dừng', async () => {
  let emit: (event: DebugEvent) => void = () => {}
  const evaluate = vi.fn(async (expression: string) => ({ result: expression === 'items' ? '[1, 2, 3]' : '10', variablesReference: 0 }))
  const api = {
    adapterStatus: async () => ({ node: true, python: true }),
    configs: async () => [],
    onEvent: (handler: (event: DebugEvent) => void) => { emit = handler; return () => {} },
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
  fireEvent.change(screen.getByRole('textbox', { name: 'Biểu thức theo dõi' }), { target: { value: 'total * 10' } })
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
