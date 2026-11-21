// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { TerminalEvent } from '@shared/api'
import { TerminalPanel } from './TerminalPanel'
import { setTerminalHeight } from '../../state/layoutPrefs'

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
  expect(screen.getAllByRole('tab')).toHaveLength(1)
  expect(create).toHaveBeenCalledTimes(1)
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
