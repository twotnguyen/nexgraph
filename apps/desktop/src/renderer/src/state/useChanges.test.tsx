// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Changes } from '@nexgraph/contracts/graph-types'
import { emptyChanges, installNexgraph } from '../test-utils'
import { useChanges } from './useChanges'
import { msgText } from './messages'

const changed = (label: string): Changes =>
  emptyChanges({ changed_files: [{ path: `lib/${label}.dart`, status: 'M', old_path: null }] })

describe('useChanges', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  it('loads on mount (with a refresh) and exposes the result', async () => {
    const { api } = installNexgraph({ graph: { changes: vi.fn(async () => changed('a')) } })
    const { result } = renderHook(() => useChanges('p1'))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.changes?.changed_files[0].path).toBe('lib/a.dart'))
    expect(result.current.loading).toBe(false)
    expect(api.graph.changes).toHaveBeenCalledWith('p1', undefined)
  })

  it('ignores changes_updated of another project', async () => {
    const { api, emit } = installNexgraph()
    renderHook(() => useChanges('p1'))
    await waitFor(() => expect(api.graph.changes).toHaveBeenCalledTimes(1))
    act(() => emit({ type: 'changes_updated', project_id: 'other' }))
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)))
    expect(api.graph.changes).toHaveBeenCalledTimes(1)
  })

  it('merges a burst of events into a single reload without asking the engine to refresh again', async () => {
    const { api, emit } = installNexgraph()
    renderHook(() => useChanges('p1'))
    await waitFor(() => expect(api.graph.changes).toHaveBeenCalledTimes(1))
    act(() => {
      emit({ type: 'changes_updated', project_id: 'p1' })
      emit({ type: 'changes_updated', project_id: 'p1' })
      emit({ type: 'changes_updated', project_id: 'p1' })
    })
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)))
    expect(api.graph.changes).toHaveBeenCalledTimes(2)
    expect(api.graph.changes).toHaveBeenLastCalledWith('p1', { refresh: false })
  })

  it('drops a stale answer that arrives after a newer one', async () => {
    let first: (c: Changes) => void = () => {}
    const changes = vi.fn()
      .mockImplementationOnce(() => new Promise<Changes>((r) => (first = r)))
      .mockResolvedValue(changed('new'))
    const { emit } = installNexgraph({ graph: { changes } })
    const { result } = renderHook(() => useChanges('p1'))
    act(() => emit({ type: 'graph_updated', project_id: 'p1' }))
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)))
    await waitFor(() => expect(result.current.changes?.changed_files[0].path).toBe('lib/new.dart'))
    await act(async () => first(changed('old')))
    expect(result.current.changes?.changed_files[0].path).toBe('lib/new.dart')
  })

  it('reports errors and recovers on reload', async () => {
    const changes = vi.fn().mockRejectedValueOnce({ code: 'unknown_project', message: 'Không có dự án' }).mockResolvedValue(changed('a'))
    installNexgraph({ graph: { changes } })
    const { result } = renderHook(() => useChanges('p1'))
    await waitFor(() => expect(msgText(result.current.error)).toBe('Không có dự án'))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.changes?.changed_files).toHaveLength(1)
  })
})
