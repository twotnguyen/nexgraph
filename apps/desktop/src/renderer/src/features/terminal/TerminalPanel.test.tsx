// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { TerminalEvent } from '@nexgraph/contracts/api'
import { TerminalPanel } from './TerminalPanel'
import { setTerminalHeight } from '../../shared/lib/layoutPrefs'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options = { fontSize: 12, theme: {} }
    host: HTMLElement | null = null
    loadAddon() {}
    open(host: HTMLElement) { this.host = host }
    write(data: string) { if (this.host) this.host.textContent += data }
    onData() { return { dispose() {} } }
    onResize() { return { dispose() {} } }
    registerLinkProvider() { return { dispose() {} } }
    focus() {}
    dispose() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))
vi.mock('@xterm/addon-search', () => ({ SearchAddon: class {} }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('giữ đầu ra và mã lỗi khi task kết thúc trước khi create trả về, kể cả trong StrictMode', async () => {
  const listeners = new Set<(event: TerminalEvent) => void>()
  const create = vi.fn(async () => {
    listeners.forEach((listener) => listener({ id: 42, type: 'data', data: 'Lỗi biên dịch\r\n' }))
    listeners.forEach((listener) => listener({ id: 42, type: 'exit', code: 23 }))
    return { id: 42, shell: 'sh', cwd: '/project' }
  })
  vi.stubGlobal('nexgraph', { terminal: {
    create,
    onEvent: (listener: (event: TerminalEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(), resolvePath: vi.fn()
  } })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))

  render(<StrictMode><TerminalPanel projectId="p1" projectPath="/project" newRequest={0}
    taskRequest={{ seq: 1, task: { label: 'Build', command: 'build' } }} hidden={false}
    onHide={() => {}} onCloseAll={() => {}} onOpenFile={() => {}} /></StrictMode>)

  expect(await screen.findByText('Lỗi biên dịch')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /Build/ })).toHaveTextContent('Thất bại (23)')
  expect(document.querySelector('.terminal-task-icon[data-status="failed"]')).toBeInTheDocument()
  expect(create).toHaveBeenCalledTimes(1)
})

it('lệnh gõ tay trong picker được gõ vào shell, không gửi thành task cho main', async () => {
  // REV-13: task phải khai trong dự án mới có chữ ký; lệnh gõ tay đi qua shell như người dùng gõ.
  const create = vi.fn(async () => ({ id: 9, shell: 'zsh', cwd: '/project' }))
  const write = vi.fn()
  vi.stubGlobal('nexgraph', { terminal: {
    create, onEvent: () => () => {}, write, resize: vi.fn(), kill: vi.fn(), resolvePath: vi.fn()
  } })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))

  render(<TerminalPanel {...baseProps} projectId="p-typed" taskRequest={{ seq: 1, command: 'echo D3-TYPED' }} />)
  await vi.waitFor(() => expect(write).toHaveBeenCalledWith(9, 'echo D3-TYPED\r'))
  expect(create).toHaveBeenCalledTimes(1)
  expect(create.mock.calls[0]).toEqual(['p-typed', expect.any(Number), expect.any(Number), undefined])
})

it('chiều cao theo tuỳ chọn bố cục: đổi từ Cài đặt hoặc kéo thanh chia đều đổi biến CSS và được lưu', () => {
  vi.stubGlobal('nexgraph', { terminal: {
    create: vi.fn(async () => ({ id: 1, shell: 'sh', cwd: '/project' })), onEvent: () => () => {},
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(), resolvePath: vi.fn()
  } })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
  localStorage.removeItem('nexgraph.terminal.height')
  render(<TerminalPanel projectId="p1" projectPath="/project" newRequest={0} taskRequest={null} hidden={false}
    onHide={() => {}} onCloseAll={() => {}} onOpenFile={() => {}} />)
  const height = () => document.querySelector<HTMLElement>('.terminal-panel')!.style.getPropertyValue('--terminal-height')
  expect(height()).toBe('280px')
  act(() => setTerminalHeight(400))
  expect(height()).toBe('400px')
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Chiều cao terminal' }), { key: 'ArrowUp' })
  expect(height()).toBe('420px')
  expect(localStorage.getItem('nexgraph.terminal.height')).toBe('420')
  localStorage.removeItem('nexgraph.terminal.height')
})

function setupTerminalApi() {
  vi.stubGlobal('nexgraph', { terminal: {
    create: vi.fn(async () => ({ id: 7, shell: 'sh', cwd: '/project' })), onEvent: () => () => {},
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(), resolvePath: vi.fn()
  } })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle))
}

const baseProps = {
  projectId: 'p1', projectPath: '/project', newRequest: 0, taskRequest: null, hidden: false,
  onHide: () => {}, onCloseAll: () => {}, onOpenFile: () => {}
}

it('terminal mới và chia bốn hướng gọi callback, badge đếm đúng số tab', () => {
  setupTerminalApi()
  const onNewTerminal = vi.fn()
  const onSplitTerminal = vi.fn()
  const onTabCountChange = vi.fn()
  render(<TerminalPanel {...baseProps} projectId="p-new" onNewTerminal={onNewTerminal} onSplitTerminal={onSplitTerminal} onTabCountChange={onTabCountChange} />)
  const badge = () => screen.getByLabelText('Số terminal').textContent
  expect(badge()).toBe('1')
  expect(onTabCountChange).toHaveBeenLastCalledWith(1)

  fireEvent.click(screen.getByRole('button', { name: 'Terminal mới' }))
  expect(onNewTerminal).toHaveBeenCalledTimes(1)
  expect(badge()).toBe('2')

  fireEvent.click(screen.getByRole('button', { name: 'Chia terminal' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Chia sang trái' }))
  expect(onSplitTerminal).toHaveBeenCalledWith('left')
  expect(badge()).toBe('3')
  expect(onTabCountChange).toHaveBeenLastCalledWith(3)
})

it('phóng to/thu nhỏ và đổi tên tab gọi đúng callback', () => {
  setupTerminalApi()
  const onZoomChange = vi.fn()
  const onRenameTerminal = vi.fn()
  render(<TerminalPanel {...baseProps} projectId="p-zoom" onZoomChange={onZoomChange} onRenameTerminal={onRenameTerminal} />)

  fireEvent.click(screen.getByRole('button', { name: 'Phóng to terminal' }))
  expect(onZoomChange).toHaveBeenLastCalledWith(true)
  expect(document.querySelector('.terminal-panel')).toHaveAttribute('data-maximized', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Khôi phục terminal' }))
  expect(onZoomChange).toHaveBeenLastCalledWith(false)

  fireEvent.click(screen.getByRole('button', { name: 'Đổi tên terminal' }))
  const input = screen.getByRole('textbox', { name: 'Tên terminal' })
  fireEvent.change(input, { target: { value: 'Terminal A' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(onRenameTerminal).toHaveBeenCalledWith('Terminal A')
  expect(screen.getByRole('tab', { name: /Terminal A/ })).toBeInTheDocument()
})

it('chạy lại task và đóng tab đang chạy gọi callback sau khi xác nhận', () => {
  setupTerminalApi()
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const onRerunTask = vi.fn()
  const onCloseTerminal = vi.fn()
  const task = { label: 'Build', command: 'build' }
  render(<TerminalPanel {...baseProps} projectId="p-rerun" taskRequest={{ seq: 1, task }} onRerunTask={onRerunTask} onCloseTerminal={onCloseTerminal} />)
  const badge = () => screen.getByLabelText('Số terminal').textContent
  expect(document.querySelector('.terminal-task-icon[data-status="running"]')).toBeInTheDocument()

  fireEvent.contextMenu(screen.getAllByRole('tab')[0])
  fireEvent.click(screen.getByRole('menuitem', { name: 'Chạy lại' }))
  expect(onRerunTask).toHaveBeenCalledWith(task)
  expect(badge()).toBe('2')

  fireEvent.contextMenu(screen.getAllByRole('tab')[0])
  fireEvent.click(screen.getByRole('menuitem', { name: 'Đóng' }))
  expect(confirm).toHaveBeenCalled()
  expect(onCloseTerminal).toHaveBeenCalledWith(true)
  expect(badge()).toBe('1')
  confirm.mockRestore()
})

it('hướng chia đặt axis đúng và reset horizontal khi còn một terminal', () => {
  setupTerminalApi()
  render(<TerminalPanel {...baseProps} projectId="p-axis" />)
  const body = () => document.querySelector('.terminal-body')
  const badge = () => screen.getByLabelText('Số terminal').textContent
  expect(body()).toHaveAttribute('data-axis', 'horizontal')

  fireEvent.click(screen.getByRole('button', { name: 'Chia terminal' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Chia sang trên' }))
  expect(body()).toHaveAttribute('data-axis', 'vertical')
  expect(badge()).toBe('2')

  fireEvent.click(document.querySelectorAll('.terminal-tab-close')[1])
  expect(badge()).toBe('1')
  expect(body()).toHaveAttribute('data-axis', 'horizontal')

  fireEvent.click(screen.getByRole('button', { name: 'Chia terminal' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Chia sang phải' }))
  expect(body()).toHaveAttribute('data-axis', 'horizontal')
})
