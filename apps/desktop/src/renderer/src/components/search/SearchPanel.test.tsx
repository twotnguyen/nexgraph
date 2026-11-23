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
    await user.type(screen.getByLabelText('Tìm trong đồ thị'), 'login')
    expect(search).not.toHaveBeenCalled()
    await tick(120)
    expect(search).not.toHaveBeenCalled()  // chưa đủ 200 ms kể từ lần gõ cuối
    await tick(150)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('p1', 'login', { limit: 30 })
  })

  it('only searches for the final text when typing continues', async () => {
    const { search, user } = setup()
    const input = screen.getByLabelText('Tìm trong đồ thị')
    await user.type(input, 'lo')
    await tick(80)
    await user.type(input, 'gin')
    await tick(300)
    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith('p1', 'login', { limit: 30 })
  })

  it('does not search blank text and clears the results', async () => {
    const { search, user } = setup()
    const input = screen.getByLabelText('Tìm trong đồ thị')
    await user.type(input, 'login')
    await tick(250)
    expect(await screen.findByText('login')).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '   ')
    await tick(250)
    expect(search).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('login')).not.toBeInTheDocument()
  })

  it('Tìm symbol mở tệp tại dòng của symbol, vẫn xem được trên graph (A3 #2)', async () => {
    installNexgraph({ graph: { search: vi.fn(async () => [hit('lib/a.dart::AuthService.login#method', 1, { line_start: 42 })]) } })
    const onOpen = vi.fn()
    const onOpenCode = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SearchPanel projectId="p1" onOpen={onOpen} onOpenCode={onOpenCode} />)
    await user.type(screen.getByLabelText('Tìm trong đồ thị'), 'login')
    await tick(250)
    await user.click(await screen.findByRole('button', { name: /login/ }))
    expect(onOpenCode).toHaveBeenCalledWith('lib/a.dart', 42, 1)
    expect(onOpen).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Xem trên graph' }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'lib/a.dart::AuthService.login#method' }))
  })

  it('Enter mở tệp:dòng của kết quả đầu tiên khi có onOpenCode', async () => {
    installNexgraph({ graph: { search: vi.fn(async () => [hit('lib/a.dart::A.one#method', 1, { line_start: 7 })]) } })
    const onOpenCode = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SearchPanel projectId="p1" onOpen={vi.fn()} onOpenCode={onOpenCode} />)
    await user.type(screen.getByLabelText('Tìm trong đồ thị'), 'one')
    await tick(250)
    await screen.findByText('one')
    await user.type(screen.getByLabelText('Tìm trong đồ thị'), '{Enter}')
    expect(onOpenCode).toHaveBeenCalledWith('lib/a.dart', 7, 1)
  })

  it('shows label, kind and file:line, and opens a result on click', async () => {
    const { onOpen, user } = setup()
    await user.type(screen.getByLabelText('Tìm trong đồ thị'), 'login')
    await tick(250)
    const btn = await screen.findByRole('button', { name: /login/ })
    expect(btn).toHaveTextContent('method')
    expect(btn).toHaveTextContent('lib/a.dart:12')
    await user.click(btn)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'lib/a.dart::AuthService.login#method' }))
  })

  it('Enter opens the first result', async () => {
    const { onOpen, user } = setup(vi.fn(async () => [hit('lib/a.dart::A.one#method'), hit('lib/a.dart::A.two#method')]))
    await user.type(screen.getByLabelText('Tìm trong đồ thị'), 'a')
    await tick(250)
    await screen.findByText('one')
    await user.type(screen.getByLabelText('Tìm trong đồ thị'), '{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'lib/a.dart::A.one#method' }))
  })

  it('does not open the previous result when Enter precedes the new debounced request', async () => {
    const search = vi.fn().mockImplementation(async (_project: string, q: string) => [hit(`lib/a.dart::A.${q}#method`)])
    const { onOpen, user } = setup(search)
    const input = screen.getByLabelText('Tìm trong đồ thị')
    await user.type(input, 'login')
    await tick(250)
    expect(screen.getByText('login')).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, 'logout{Enter}')
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.queryByText('login')).not.toBeInTheDocument()
    await tick(250)
    expect(await screen.findByText('logout')).toBeInTheDocument()
  })

  it('shows "Không có kết quả" for an empty answer', async () => {
    const { user } = setup(vi.fn(async () => []))
    await user.type(screen.getByLabelText('Tìm trong đồ thị'), 'zzz')
    await tick(250)
    expect(await screen.findByText('Không có kết quả')).toBeInTheDocument()
  })

  it('shows engine errors with role=alert', async () => {
    const { user } = setup(vi.fn(async () => { throw Object.assign(new Error('Cần ít nhất một từ'), { code: 'bad_param' }) }))
    await user.type(screen.getByLabelText('Tìm trong đồ thị'), '***')
    await tick(250)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cần ít nhất một từ')
  })

  it('ignores a late answer to an older query', async () => {
    let resolveFirst!: (v: SearchHit[]) => void
    const search = vi.fn()
      .mockImplementationOnce(() => new Promise<SearchHit[]>((r) => (resolveFirst = r)))
      .mockImplementationOnce(async () => [hit('lib/a.dart::New.item#method')])
    const { user } = setup(search)
    const input = screen.getByLabelText('Tìm trong đồ thị')
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

  it('hỏi graph bằng tên trùng nhiều nút thì liệt kê ứng viên để chọn', async () => {
    const a = gnode('a/store.py::Store#class', { kind: 'class', label: 'Store', file: 'a/store.py' })
    const b = gnode('b/store.py::Store#class', { kind: 'class', label: 'Store', file: 'b/store.py' })
    installNexgraph({ graph: { ask: vi.fn(async () => ({ seeds: [], nodes: [], edges: [], truncated: false, ambiguous: [a, b] })) } })
    const onOpen = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<SearchPanel projectId="p1" onOpen={onOpen} onShowSubgraph={vi.fn()} />)
    await user.click(screen.getByRole('radio', { name: 'Hỏi graph' }))
    await user.type(screen.getByLabelText('Câu hỏi cho graph'), 'Store{Enter}')
    expect(await screen.findByText(/trùng với 2 node/)).toBeInTheDocument()
    const choices = screen.getAllByRole('button', { name: /Store/ })
    expect(choices).toHaveLength(2)
    await user.click(choices[1])
    expect(onOpen).toHaveBeenCalledWith(b)
  })
})
