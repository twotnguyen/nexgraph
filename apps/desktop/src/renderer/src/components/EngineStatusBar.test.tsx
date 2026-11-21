// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineStatusBar, StatusBarItems } from './EngineStatusBar'
import { isStatusItemHidden, setStatusBar, setStatusItemHidden } from '../state/layoutPrefs'

afterEach(() => { act(() => { setStatusBar(true); setStatusItemHidden('cursor', false) }) })

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
    await userEvent.click(screen.getByRole('button', { name: 'Khởi động lại' }))
    expect(onRestart).toHaveBeenCalled()
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
    cleanup()
    render(bar())
    expect(screen.queryByText('12:4')).not.toBeInTheDocument()
    expect(screen.getByText('TypeScript')).toBeInTheDocument()
    act(() => setStatusItemHidden('cursor', false))
    expect(screen.getByText('12:4')).toBeInTheDocument()
  })
})
