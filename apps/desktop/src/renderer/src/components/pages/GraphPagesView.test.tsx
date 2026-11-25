// @vitest-environment jsdom
// NG-UI-2: chế độ Đồ thị/Cây/Luồng gọi, chỉ giữ trang đang xem, đồng bộ theme, panel nút đã chọn.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphPageSelection, GraphPagesStatus } from '@shared/graph-pages'
import { setLocale } from '../../state/locale'
import { setTheme } from '../../state/useTheme'
import { GraphPagesView } from './GraphPagesView'

const status = (over: Partial<GraphPagesStatus> = {}): GraphPagesStatus => ({
  dir: '/tmp/demo/.nexgraph', graph: true, tree: true, callflow: 'demo-callflow.html',
  partition: 'nexgraph-pages', preload: 'file:///preload/graphPage.js', ...over
})

let listeners: ((selection: GraphPageSelection) => void)[] = []

beforeEach(() => {
  listeners = []
  ;(window as unknown as { nexgraph: unknown }).nexgraph = {
    graphPages: { onNodeSelected: (cb: (s: GraphPageSelection) => void) => { listeners.push(cb); return () => { listeners = listeners.filter((l) => l !== cb) } } }
  }
})
afterEach(() => setLocale('vi'))

const frame = (): HTMLElement & { send: ReturnType<typeof vi.fn> } => {
  const el = document.querySelector('webview') as (HTMLElement & { send: ReturnType<typeof vi.fn> }) | null
  if (!el) throw new Error('không có webview')
  if (!el.send) el.send = vi.fn()
  return el
}

describe('chế độ xem trang đồ thị', () => {
  it('mặc định mở trang Đồ thị khi có graph.html', () => {
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} />)
    expect(screen.getByRole('tab', { name: 'Đồ thị' }).getAttribute('aria-selected')).toBe('true')
    expect(frame().getAttribute('src')).toBe('nxpage://pid-1/graph.html')
    expect(frame().getAttribute('partition')).toBe('nexgraph-pages')
    expect(frame().getAttribute('preload')).toBe('file:///preload/graphPage.js')
  })

  it('chỉ hiện chế độ có tệp và luôn chỉ giữ một khung nhúng', async () => {
    const first = render(<GraphPagesView projectId="pid-1" status={status({ graph: false, callflow: null })} revision={0} />)
    const tabs = within(first.container).getAllByRole('tab').map((el) => el.textContent)
    expect(tabs).toEqual(['Cây'])
    expect(first.container.querySelector('webview')?.getAttribute('src')).toBe('nxpage://pid-1/GRAPH_TREE.html')
    first.unmount()

    const { container } = render(<GraphPagesView projectId="pid-1" status={status()} revision={0} />)
    expect(container.querySelectorAll('webview')).toHaveLength(1)
    await act(async () => { within(container).getAllByRole('tab').find((el) => el.textContent === 'Luồng gọi')!.click() })
    expect(container.querySelectorAll('webview')).toHaveLength(1)
    expect(container.querySelector('webview')?.getAttribute('src')).toBe('nxpage://pid-1/demo-callflow.html')
  })

  it('đổi theme app → gửi theme cho trang, kể cả khi trang vừa dom-ready', async () => {
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} />)
    const el = frame()
    act(() => { setTheme('dark') })
    await waitFor(() => expect(el.send).toHaveBeenCalledWith('nxpage:theme', 'dark'))
    el.send.mockClear()
    act(() => { el.dispatchEvent(new Event('dom-ready')) })
    expect(el.send).toHaveBeenCalledWith('nxpage:theme', 'dark')
    act(() => { setTheme('light') })
    await waitFor(() => expect(el.send).toHaveBeenCalledWith('nxpage:theme', 'light'))
  })

  it('panel nhỏ hiện nút + tệp: dòng sau khi trang gửi lựa chọn, bỏ qua dự án khác', async () => {
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} />)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-2', id: 'x', label: 'Sai', sourceFile: null, sourceLine: null, sourceLocation: null, via: null })) })
    expect(screen.queryByRole('status', { name: 'Nút đã chọn' })).toBeNull()
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: 'a.ts::run#function', label: 'run()', sourceFile: 'src/a.ts', sourceLine: 12, sourceLocation: 'src/a.ts:12', via: 'showInfo' })) })
    const panel = screen.getByRole('status', { name: 'Nút đã chọn' })
    expect(panel.textContent).toContain('run()')
    expect(panel.textContent).toContain('src/a.ts:12')
    act(() => { screen.getByRole('button', { name: 'Đóng nút đã chọn' }).click() })
    expect(screen.queryByRole('status', { name: 'Nút đã chọn' })).toBeNull()
  })

  it('không có trang nào → không vẽ khung nhúng (giao diện cũ giữ nguyên)', () => {
    const { container } = render(<GraphPagesView projectId="pid-1" status={status({ graph: false, tree: false, callflow: null })} revision={0} />)
    expect(container.querySelector('webview')).toBeNull()
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
  })

  it('EN: nhãn chế độ và panel có bản tiếng Anh', () => {
    setLocale('en')
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} />)
    expect(screen.getByRole('tab', { name: 'Graph' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Tree' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Call flow' })).toBeTruthy()
  })
})
