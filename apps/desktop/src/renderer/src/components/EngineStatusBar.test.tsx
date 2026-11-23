// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineStatusBar, StatusBarItems } from './EngineStatusBar'
import { isStatusItemHidden, setStatusBar, setStatusItemHidden } from '../state/layoutPrefs'
import { setLocale } from '../state/locale'
import { COMMANDS, registerHandler } from '../state/commands'
import { STATUS_BAR_ITEMS, getStatusBarItem } from '../state/statusBarRegistry'

afterEach(() => { act(() => { setStatusBar(true); setStatusItemHidden('cursor', false); setStatusItemHidden('git', false) }); setLocale('vi') })

const withGlobalHandlers = () => [
  registerHandler('git_panel.toggle', () => {}),
  registerHandler('notifications.toggle', () => {})
]

describe('EngineStatusBar', () => {
  it('shows starting', () => {
    render(<EngineStatusBar status={{ state: 'starting' }} onRestart={() => {}} />)
    expect(screen.getByText('Engine: đang khởi động…')).toBeInTheDocument()
  })

  it('shows ready with version', () => {
    render(
      <EngineStatusBar
        status={{ state: 'ready', engineVersion: '0.1.0', vendorCommit: '86c57be' }}
        onRestart={() => {}}
      />
    )
    expect(screen.getByText('Engine: sẵn sàng (v0.1.0)')).toBeInTheDocument()
  })

  it('EngineStatusBar shows error and restart', async () => {
    const onRestart = vi.fn()
    render(<EngineStatusBar status={{ state: 'error', message: 'exit 5' }} onRestart={onRestart} />)
    expect(screen.getByText('Engine: lỗi — exit 5')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Khởi động lại' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Khởi động lại' }))
    expect(onRestart).toHaveBeenCalled()
  })

  it('dịch thông báo engine thoát sang tiếng Anh bằng messageKey', () => {
    setLocale('en')
    render(<EngineStatusBar status={{ state: 'error', message: 'engine thoát (exit 5)',
      messageKey: 'engine thoát (exit {code})', messageVars: { code: 5 } }} onRestart={() => {}} />)
    expect(screen.getByText('Engine: error — engine exited (exit 5)')).toBeInTheDocument()
  })

  it('clicking the engine item restarts the engine', async () => {
    const onRestart = vi.fn()
    render(<EngineStatusBar status={{ state: 'ready', engineVersion: '1', vendorCommit: 'x' }} onRestart={onRestart} />)
    await userEvent.click(screen.getByText('Engine: sẵn sàng (v1)'))
    expect(onRestart).toHaveBeenCalledOnce()
  })

  it('puts items of the open tab on the right side of the bar', () => {
    // Thẻ (editor) nằm trước thanh trạng thái trong cây, như trong App.
    render(<><StatusBarItems><span>12:4</span></StatusBarItems><EngineStatusBar status={{ state: 'starting' }} onRestart={() => {}} /></>)
    expect(screen.getByLabelText('Thanh trạng thái').querySelector('.status-right')).toHaveTextContent('12:4')
  })

  it('ẩn được bằng tuỳ chọn bố cục nhưng engine lỗi thì vẫn hiện để còn nút Khởi động lại', () => {
    setStatusBar(false)
    const bar = () => screen.getByLabelText('Thanh trạng thái')
    const view = render(<EngineStatusBar status={{ state: 'starting' }} onRestart={() => {}} />)
    expect(bar()).not.toBeVisible()
    view.rerender(<EngineStatusBar status={{ state: 'error', message: 'exit 5' }} onRestart={() => {}} />)
    expect(bar()).toBeVisible()
    view.rerender(<EngineStatusBar status={{ state: 'starting' }} onRestart={() => {}} />)
    expect(bar()).not.toBeVisible()
    act(() => setStatusBar(true))
    expect(bar()).toBeVisible()
  })

  it('bấm chuột phải ẩn một mục rồi reload vẫn ẩn', () => {
    const bar = () => <><StatusBarItems>
      <button type="button" data-status-id="cursor">12:4</button>
      <button type="button" data-status-id="language">TypeScript</button>
    </StatusBarItems><EngineStatusBar status={{ state: 'ready', engineVersion: '1', vendorCommit: 'x' }} onRestart={() => {}} /></>
    render(bar())
    fireEvent.contextMenu(screen.getByText('12:4'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ẩn nút này' }))
    expect(screen.queryByText('12:4')).not.toBeInTheDocument()
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    expect(isStatusItemHidden('cursor')).toBe(true)
    expect(localStorage.getItem('nexgraph.statusbar.hidden:cursor')).toBe('1')
    cleanup()
    render(bar())
    expect(screen.queryByText('12:4')).not.toBeInTheDocument()
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    act(() => setStatusItemHidden('cursor', false))
    expect(screen.getByText('12:4')).toBeInTheDocument()
  })
})

describe('status bar registry', () => {
  it('covers the 11 Wu items plus opt-in vim with commands that exist', () => {
    expect(STATUS_BAR_ITEMS.map((item) => item.id)).toEqual([
      'engine', 'diagnostics', 'diagnosticsDetail', 'git', 'cursor', 'selection',
      'language', 'eol', 'encoding', 'indentation', 'notifications', 'vim'
    ])
    const commandIds = new Set(COMMANDS.map((command) => command.id))
    for (const item of STATUS_BAR_ITEMS) {
      expect(commandIds.has(item.command), `${item.id}: ${item.command}`).toBe(true)
      expect(getStatusBarItem(item.id)).toBe(item)
    }
    expect(getStatusBarItem('missing')).toBeUndefined()
    expect(getStatusBarItem('selection')?.command).toBe('editor.goto_line')
    expect(getStatusBarItem('indentation')?.command).toBe('editor.indentation_selector')
  })

  it('shows a context item only while its provider supplies it and runs the registry command', () => {
    const run = vi.fn()
    const unregister = registerHandler('editor.indentation_selector', run)
    const off = withGlobalHandlers()
    try {
      render(<><StatusBarItems><span data-status-id="indentation">4 spaces</span></StatusBarItems>
        <EngineStatusBar status={{ state: 'ready', engineVersion: '1', vendorCommit: 'x' }} onRestart={() => {}} /></>)
      const item = screen.getByText('4 spaces')
      expect(item).toHaveAttribute('title', 'Thụt lề')
      fireEvent.click(item)
      expect(run).toHaveBeenCalledOnce()
      cleanup()
      render(<EngineStatusBar status={{ state: 'ready', engineVersion: '1', vendorCommit: 'x' }} onRestart={() => {}} />)
      const right = screen.getByLabelText('Thanh trạng thái').querySelector('.status-right')!
      expect(right).not.toHaveTextContent('4 spaces')
      expect(right).toHaveTextContent('Git')
    } finally {
      unregister()
      off.forEach((fn) => fn())
    }
  })

  it('renders global git and notification items and hides them by their own key', () => {
    const off = withGlobalHandlers()
    render(<EngineStatusBar status={{ state: 'ready', engineVersion: '1', vendorCommit: 'x' }} onRestart={() => {}} />)
    const right = () => screen.getByLabelText('Thanh trạng thái').querySelector('.status-right')!
    expect(right()).toHaveTextContent('Git')
    expect(right()).toHaveTextContent('Thông báo')
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Git' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ẩn nút này' }))
    expect(screen.queryByRole('button', { name: 'Git' })).not.toBeInTheDocument()
    expect(localStorage.getItem('nexgraph.statusbar.hidden:git')).toBe('1')
    expect(right()).toHaveTextContent('Thông báo')
    act(() => setStatusItemHidden('git', false))
    off.forEach((fn) => fn())
  })

  it('hiện mục global chỉ khi lệnh có handler ở màn hiện tại', () => {
    render(<EngineStatusBar status={{ state: 'ready', engineVersion: '1', vendorCommit: 'x' }} onRestart={() => {}} />)
    const right = () => screen.getByLabelText('Thanh trạng thái').querySelector('.status-right')!
    expect(right()).not.toHaveTextContent('Git')
    expect(right()).not.toHaveTextContent('Thông báo')
    let offGit = () => {}
    let offNotifications = () => {}
    act(() => { offGit = registerHandler('git_panel.toggle', () => {}) })
    expect(right()).toHaveTextContent('Git')
    act(() => { offNotifications = registerHandler('notifications.toggle', () => {}) })
    expect(right()).toHaveTextContent('Thông báo')
    act(() => { offNotifications(); offGit() })
    expect(right()).not.toHaveTextContent('Git')
    expect(right()).not.toHaveTextContent('Thông báo')
  })
})
