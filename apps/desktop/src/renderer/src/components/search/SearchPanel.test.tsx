// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphNode, SearchHit } from '@shared/graph-types'
import { installNexgraph } from '../../test-utils'
import { SearchPanel } from './SearchPanel'

const gnode = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id, kind: 'method', label: id.split('::').pop()!.split('#')[0].split('.').pop()!, qualified_name: id, language: 'dart', file: 'lib/a.dart',
  line_start: 12, line_end: 20, is_test: false, origin: 'ast', signature: null, community: null, ...over
})
const hit = (id: string, score = 1, over: Partial<GraphNode> = {}): SearchHit => ({ node: gnode(id, over), score })

// shouldAdvanceTime: để findBy*/waitFor của Testing Library (dùng setTimeout) không bị treo dưới đồng hồ giả
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

const setup = (search = vi.fn(async (): Promise<SearchHit[]> => [hit('lib/a.dart::AuthService.login#method')])) => {
  installNexgraph({ graph: { search } })
  const onOpen = vi.fn()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<SearchPanel projectId="p1" onOpen={onOpen} />)
  return { search, onOpen, user }
}
const tick = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))

describe('SearchPanel', () => {
  it('waits 200 ms after the last keystroke, then searches once', async () => {
    const { search, user } = setup()
    await user.type(screen.getByLabelText('Tìm kiếm'), 'login')
    expect(search).not.toHaveBeenCalled()
    await tick(120)
    expect(search).not.toHaveBeenCalled()  // chưa đủ 200 ms kể từ lần gõ cuối
    await tick(150)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('p1', 'login', { limit: 30 })
  })

  it('only searches for the final text when typing continues', async () => {
    const { search, user } = setup()
    const input = screen.getByLabelText('Tìm kiếm')
    await user.type(input, 'lo')
    await tick(80)
    await user.type(input, 'gin')
    await tick(300)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('p1', 'login', { limit: 30 })
  })

  it('does not search blank text and clears the results', async () => {
    const { search, user } = setup()
    const input = screen.getByLabelText('Tìm kiếm')
    await user.type(input, 'login')
    await tick(250)
    expect(await screen.findByText('login')).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '   ')
    await tick(250)
    expect(search).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('login')).not.toBeInTheDocument()
  })

  it('shows label, kind and file:line, and opens a result on click', async () => {
    const { onOpen, user } = setup()
    await user.type(screen.getByLabelText('Tìm kiếm'), 'login')
    await tick(250)
    const btn = await screen.findByRole('button', { name: /login/ })
    expect(btn).toHaveTextContent('method')
    expect(btn).toHaveTextContent('lib/a.dart:12')
    await user.click(btn)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'lib/a.dart::AuthService.login#method' }))
  })

  it('Enter opens the first result', async () => {
    const { onOpen, user } = setup(vi.fn(async () => [hit('lib/a.dart::A.one#method'), hit('lib/a.dart::A.two#method')]))
    await user.type(screen.getByLabelText('Tìm kiếm'), 'a')
    await tick(250)
    await screen.findByText('one')
    await user.type(screen.getByLabelText('Tìm kiếm'), '{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'lib/a.dart::A.one#method' }))
  })

  it('shows "Không có kết quả" for an empty answer', async () => {
    const { user } = setup(vi.fn(async () => []))
    await user.type(screen.getByLabelText('Tìm kiếm'), 'zzz')
    await tick(250)
    expect(await screen.findByText('Không có kết quả')).toBeInTheDocument()
  })

  it('shows engine errors with role=alert', async () => {
    const { user } = setup(vi.fn(async () => { throw Object.assign(new Error('Cần ít nhất một từ'), { code: 'bad_param' }) }))
    await user.type(screen.getByLabelText('Tìm kiếm'), '***')
    await tick(250)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cần ít nhất một từ')
  })

  it('ignores a late answer to an older query', async () => {
    let resolveFirst!: (v: SearchHit[]) => void
    const search = vi.fn()
      .mockImplementationOnce(() => new Promise<SearchHit[]>((r) => (resolveFirst = r)))
      .mockImplementationOnce(async () => [hit('lib/a.dart::New.item#method')])
    const { user } = setup(search)
    const input = screen.getByLabelText('Tìm kiếm')
    await user.type(input, 'old')
    await tick(250)
    await user.clear(input)
    await user.type(input, 'new')
    await tick(250)
    expect(await screen.findByText('item')).toBeInTheDocument()
    await act(async () => resolveFirst([hit('lib/a.dart::Old.stale#method')]))
    await waitFor(() => expect(screen.queryByText('stale')).not.toBeInTheDocument())
    expect(screen.getByText('item')).toBeInTheDocument()
  })

  it('hỏi graph gọi ask và hiện hạt giống, cho xem trên graph', async () => {
    const seed = { id: 'lib/a.dart::login#function', kind: 'function' as const, label: 'login', qualified_name: 'login', language: 'dart',
      file: 'lib/a.dart', line_start: 1, line_end: 2, is_test: false, origin: 'ast', signature: null, community: null }
    const result = { seeds: [seed], nodes: [seed], edges: [], truncated: true }
    const { api } = installNexgraph({ graph: { ask: vi.fn(async () => result) } })
    const onShowSubgraph = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SearchPanel projectId="p1" onOpen={vi.fn()} onShowSubgraph={onShowSubgraph} />)
    await user.click(screen.getByRole('radio', { name: 'Hỏi graph' }))
    await user.type(screen.getByLabelText('Câu hỏi cho graph'), 'login flow{Enter}')
    expect(api.graph.ask).toHaveBeenCalledWith('p1', 'login flow')
    expect(await screen.findByRole('button', { name: /login/ })).toBeInTheDocument()
    expect(screen.getByText(/ngân sách 2\.000 token/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Xem trên graph' }))
    expect(onShowSubgraph).toHaveBeenCalledWith({ nodes: [seed], edges: [] })
  })
})
