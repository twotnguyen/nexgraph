// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FlowPlayer } from './FlowPlayer'

describe('FlowPlayer', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('phát tự chuyển bước theo tốc độ và dừng ở bước cuối', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const { rerender } = render(<FlowPlayer count={3} index={0} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Phát' }))
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(onChange).toHaveBeenLastCalledWith(1)
    rerender(<FlowPlayer count={3} index={2} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Phát' })).toBeInTheDocument() // tới cuối thì tự dừng
    expect(screen.getByText('Bước 3/3')).toBeInTheDocument()
  })

  it('nút Đầu/Trước bị vô hiệu ở bước 1, Sau/Cuối ở bước cuối; phím mũi tên và Space hoạt động', () => {
    const onChange = vi.fn()
    render(<FlowPlayer count={3} index={0} onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Trước' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('group', { name: 'Bước 1/3' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenCalledWith(1)
    fireEvent.keyDown(screen.getByRole('group', { name: 'Bước 1/3' }), { key: ' ' })
    expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument()
  })

  it('đổi tốc độ 2× thì khoảng cách là 750 ms', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<FlowPlayer count={3} index={0} onChange={onChange} />)
    const radio2x = screen.getByRole('radio', { name: '2×' })
    fireEvent.click(radio2x)
    fireEvent.click(screen.getByRole('button', { name: 'Phát' }))
    act(() => {
      vi.advanceTimersByTime(750)
    })
    expect(onChange).toHaveBeenLastCalledWith(1)
  })
})
