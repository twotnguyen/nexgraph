// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { DebugEvent } from '@nexgraph/contracts/api'
import { addWatch, clearAllBreakpoints, setBreakpoint, setDebugProject, startDebugging, toggleBreakpoint, useDebugState } from './debugState'

beforeEach(() => { localStorage.clear(); setDebugProject('test') })

it('lưu điểm dừng theo dự án và khôi phục đủ thuộc tính', () => {
  const { result } = renderHook(() => useDebugState())
  act(() => {
    setDebugProject('first')
    toggleBreakpoint('src/a.py', 5)
    setBreakpoint('src/a.py', 5, { enabled: false, condition: 'n == 2', hitCondition: '3', logMessage: 'n={n}' })
    toggleBreakpoint('src/a.py', 2)
  })
  expect(result.current.breakpoints['src/a.py']).toEqual([
    { line: 2, enabled: true },
    { line: 5, enabled: false, condition: 'n == 2', hitCondition: '3', logMessage: 'n={n}' }
  ])
  act(() => setDebugProject('second'))
  expect(result.current.breakpoints).toEqual({})
  act(() => setDebugProject('first'))
  expect(result.current.breakpoints['src/a.py'][1]).toMatchObject({ enabled: false, condition: 'n == 2', hitCondition: '3', logMessage: 'n={n}' })
  act(() => clearAllBreakpoints())
  act(() => { setDebugProject('second'); setDebugProject('first') })
  expect(result.current.breakpoints).toEqual({})
})

it('bỏ qua dữ liệu lưu không hợp lệ thay vì hỏng bảng gỡ lỗi', () => {
  localStorage.setItem('nexgraph.debug.breakpoints.bad', '{invalid')
  const { result } = renderHook(() => useDebugState())
  act(() => setDebugProject('bad'))
  expect(result.current.breakpoints).toEqual({})
})

it('tính lại biểu thức theo dõi trong frame mới mỗi lần dừng', async () => {
  let sendEvent: (event: DebugEvent) => void = () => {}
  let frame = 1
  let finishStart: () => void = () => {}
  const start = new Promise<void>((resolve) => { finishStart = resolve })
  const setBreakpoints = vi.fn(async () => {})
  const evaluate = vi.fn(async (_expression: string, frameId: number, context: string) => ({ result: `${frameId * 10}`, variablesReference: 0, context }))
  vi.stubGlobal('nexgraph', { debug: {
    onEvent: (handler: (event: DebugEvent) => void) => { sendEvent = handler; return () => {} },
    start: () => start,
    setBreakpoints,
    stackTrace: async () => [{ id: frame, name: 'main', file: 'a.py', line: 4, column: 1 }],
    scopes: async () => [],
    evaluate
  } })
  const { result } = renderHook(() => useDebugState())
  try {
    act(() => addWatch('total * 10'))
    await act(async () => {
      const running = startDebugging('test', 'python', 'a.py')
      toggleBreakpoint('a.py', 7)
      finishStart()
      await running
    })
    expect(setBreakpoints).toHaveBeenLastCalledWith('a.py', [{ line: 7, enabled: true }])
    act(() => sendEvent({ type: 'state', state: 'stopped', threadId: 1 }))
    await waitFor(() => expect(result.current.watches[0].value).toBe('10'))
    expect(evaluate).toHaveBeenCalledWith('total * 10', 1, 'watch')
    frame = 2
    act(() => { sendEvent({ type: 'state', state: 'running' }); sendEvent({ type: 'state', state: 'stopped', threadId: 1 }) })
    await waitFor(() => expect(result.current.watches[0].value).toBe('20'))
    expect(evaluate).toHaveBeenCalledWith('total * 10', 2, 'watch')
    act(() => sendEvent({ type: 'state', state: 'terminated' }))
  } finally { vi.unstubAllGlobals() }
})
