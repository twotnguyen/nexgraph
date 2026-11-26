// @vitest-environment jsdom
// NG-UI-2: chế độ Đồ thị/Cây/Luồng gọi, chỉ giữ trang đang xem, đồng bộ theme, panel nút đã chọn.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphPageSelection, GraphPagesStatus } from '@nexgraph/contracts/graph-pages'
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
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-2', id: 'x', label: 'Sai', sourceFile: null, sourceLine: null, sourceLocation: null, via: null, community: null, memberCount: null })) })
    expect(screen.queryByRole('status', { name: 'Nút đã chọn' })).toBeNull()
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: 'a.ts::run#function', label: 'run()', sourceFile: 'src/a.ts', sourceLine: 12, sourceLocation: 'src/a.ts:12', via: 'showInfo', community: null, memberCount: null })) })
    const panel = screen.getByRole('status', { name: 'Nút đã chọn' })
    expect(panel.textContent).toContain('run()')
    expect(panel.textContent).toContain('src/a.ts:12')
    act(() => { screen.getByRole('button', { name: 'Đóng nút đã chọn' }).click() })
    expect(screen.queryByRole('status', { name: 'Nút đã chọn' })).toBeNull()
  })

  it('panel có 3 hành động: Mở mã đúng tệp:dòng, Vùng ảnh hưởng đúng node, Hỏi Nex điền câu hỏi', async () => {
    const onOpenCode = vi.fn()
    const onImpact = vi.fn()
    const onAsk = vi.fn()
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} onOpenCode={onOpenCode} onImpact={onImpact} onAsk={onAsk} />)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: 'a.ts::run#function', label: 'run()', sourceFile: 'src/a.ts', sourceLine: 12, sourceLocation: 'src/a.ts:12', via: 'showInfo', community: null, memberCount: null })) })
    await userEvent.click(screen.getByRole('button', { name: 'Mở mã' }))
    expect(onOpenCode).toHaveBeenCalledWith('src/a.ts', 12)
    await userEvent.click(screen.getByRole('button', { name: 'Vùng ảnh hưởng' }))
    expect(onImpact).toHaveBeenCalledWith('a.ts::run#function')
    await userEvent.click(screen.getByRole('button', { name: 'Hỏi Nex' }))
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('run()'))
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('src/a.ts:12'))
  })

  it('nút không có tệp thật (nguồn ảo/ngoài dự án) → tắt Mở mã', () => {
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} onOpenCode={vi.fn()} onImpact={vi.fn()} onAsk={vi.fn()} />)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: 'nguon://cargo#x', label: 'x', sourceFile: 'nguon://cargo', sourceLine: null, sourceLocation: null, via: 'showInfo', community: null, memberCount: null })) })
    expect((screen.getByRole('button', { name: 'Mở mã' }) as HTMLButtonElement).disabled).toBe(true)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: 'abs', label: 'abs', sourceFile: '/etc/passwd', sourceLine: 1, sourceLocation: '/etc/passwd:1', via: 'showInfo', community: null, memberCount: null })) })
    expect((screen.getByRole('button', { name: 'Mở mã' }) as HTMLButtonElement).disabled).toBe(true)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: 'no-file', label: 'no file', sourceFile: null, sourceLine: null, sourceLocation: null, via: 'showInfo', community: null, memberCount: null })) })
    expect((screen.getByRole('button', { name: 'Mở mã' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('EN: nhãn 3 hành động', () => {
    setLocale('en')
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} onOpenCode={vi.fn()} onImpact={vi.fn()} onAsk={vi.fn()} />)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: 'a', label: 'a', sourceFile: 'src/a.ts', sourceLine: 1, sourceLocation: 'src/a.ts:1', via: null, community: null, memberCount: null })) })
    expect(screen.getByRole('button', { name: 'Open code' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Impact' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ask Nex' })).toBeTruthy()
  })

  it('chọn nút cộng đồng → "Mở cộng đồng" mở đồ thị thành viên, quay lại trang tổng', async () => {
    const { container } = render(<GraphPagesView projectId="pid-1" status={status()} revision={0} onOpenCode={vi.fn()} onImpact={vi.fn()} onAsk={vi.fn()} />)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: '12', label: 'Thanh toán', sourceFile: null, sourceLine: null, sourceLocation: null, via: 'showInfo', community: 12, memberCount: 44 })) })
    await userEvent.click(screen.getByRole('button', { name: 'Mở cộng đồng' }))
    expect(container.querySelector('webview')?.getAttribute('src')).toBe('nxpage://pid-1/community.html?c=12')
    expect(screen.getByText('Cộng đồng: Thanh toán')).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Nút đã chọn' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '← Quay lại trang tổng' }))
    expect(container.querySelector('webview')?.getAttribute('src')).toBe('nxpage://pid-1/graph.html')
    expect(screen.queryByRole('button', { name: '← Quay lại trang tổng' })).toBeNull()
  })

  it('nút thường không có "Mở cộng đồng"; nút cộng đồng tắt Vùng ảnh hưởng', () => {
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} onOpenCode={vi.fn()} onImpact={vi.fn()} onAsk={vi.fn()} />)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: 'a', label: 'a', sourceFile: 'src/a.ts', sourceLine: 1, sourceLocation: 'src/a.ts:1', via: null, community: 3, memberCount: null })) })
    expect(screen.queryByRole('button', { name: 'Mở cộng đồng' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Vùng ảnh hưởng' }) as HTMLButtonElement).disabled).toBe(false)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: '12', label: 'C12', sourceFile: null, sourceLine: null, sourceLocation: null, via: 'showInfo', community: 12, memberCount: 44 })) })
    expect((screen.getByRole('button', { name: 'Vùng ảnh hưởng' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('trong trang cộng đồng: chọn hàm → 3 hành động vẫn chạy; đổi chế độ thì về trang tổng', async () => {
    const onOpenCode = vi.fn()
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} onOpenCode={onOpenCode} onImpact={vi.fn()} onAsk={vi.fn()} />)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: '12', label: 'Thanh toán', sourceFile: null, sourceLine: null, sourceLocation: null, via: 'showInfo', community: 12, memberCount: 44 })) })
    await userEvent.click(screen.getByRole('button', { name: 'Mở cộng đồng' }))
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: 'fn-1', label: 'charge()', sourceFile: 'src/pay.ts', sourceLine: 9, sourceLocation: 'src/pay.ts:9', via: 'showInfo', community: 12, memberCount: null })) })
    await userEvent.click(screen.getByRole('button', { name: 'Mở mã' }))
    expect(onOpenCode).toHaveBeenCalledWith('src/pay.ts', 9)
    await userEvent.click(screen.getByRole('tab', { name: 'Cây' }))
    expect(screen.queryByRole('button', { name: '← Quay lại trang tổng' })).toBeNull()
    expect(document.querySelector('webview')?.getAttribute('src')).toBe('nxpage://pid-1/GRAPH_TREE.html')
  })

  it('đổi ngôn ngữ khi đang mở → nhãn chế độ và panel đổi ngay', async () => {
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} onOpenCode={vi.fn()} onImpact={vi.fn()} onAsk={vi.fn()} />)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: 'a', label: 'a', sourceFile: 'src/a.ts', sourceLine: 1, sourceLocation: 'src/a.ts:1', via: null, community: null, memberCount: null })) })
    expect(screen.getByRole('tab', { name: 'Đồ thị' })).toBeTruthy()
    act(() => { setLocale('en') })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Graph' })).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Mở mã' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open code' })).toBeTruthy()
  })

  it('EN: nhãn mở cộng đồng và quay lại', async () => {
    setLocale('en')
    render(<GraphPagesView projectId="pid-1" status={status()} revision={0} onOpenCode={vi.fn()} onImpact={vi.fn()} onAsk={vi.fn()} />)
    act(() => { listeners.forEach((cb) => cb({ projectId: 'pid-1', id: '12', label: 'Payments', sourceFile: null, sourceLine: null, sourceLocation: null, via: null, community: 12, memberCount: 44 })) })
    await userEvent.click(screen.getByRole('button', { name: 'Open community' }))
    expect(screen.getByText('Community: Payments')).toBeTruthy()
    expect(screen.getByRole('button', { name: '← Back to overview' })).toBeTruthy()
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
