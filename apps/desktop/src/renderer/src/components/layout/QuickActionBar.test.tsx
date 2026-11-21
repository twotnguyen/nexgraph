// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../../state/commands'
import { QuickActionBar } from './WorkbenchBar'

vi.mock('../../state/commands', () => ({ runCommand: vi.fn(() => true), useCommand: vi.fn() }))

beforeEach(() => vi.mocked(runCommand).mockClear())

describe('QuickActionBar', () => {
  it('bốn nhóm nút icon; chọn toggle trong menu chạy đúng lệnh', async () => {
    render(<QuickActionBar />)
    expect(screen.getByRole('toolbar', { name: 'Thao tác nhanh' })).toBeInTheDocument()
    for (const label of ['Tìm kiếm nhanh', 'Vùng chọn', 'Điều khiển trình soạn thảo', 'Chẩn đoán']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('title', label)
    }
    await userEvent.click(screen.getByRole('button', { name: 'Điều khiển trình soạn thảo' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Bật/tắt số dòng' }))
    expect(runCommand).toHaveBeenCalledWith('editor.toggle_line_numbers')
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('đóng menu khi bấm ngoài hoặc Esc', async () => {
    render(<QuickActionBar />)
    const button = screen.getByRole('button', { name: 'Chẩn đoán' })
    await userEvent.click(button)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(button)
    await userEvent.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
