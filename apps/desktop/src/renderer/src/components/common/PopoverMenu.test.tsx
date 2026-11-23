// @vitest-environment jsdom
// PR #49 (N1): PopoverMenu mở rộng cho menu File (id, phím tắt, separator, checked, menu con).
// Bàn phím phải đi được: ↑/↓ trong menu, → mở menu con, ← đóng menu con, Esc đóng menu con
// trước rồi mới đóng menu — và cấu trúc ARIA phải hợp lệ (menuitem là con trực tiếp của menu).
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PopoverMenu, type MenuItem } from './PopoverMenu'

const build = () => {
  const pick = vi.fn()
  const sub = vi.fn()
  const items: MenuItem[] = [
    { id: 'open', label: 'Mở tệp…', icon: 'folder', onSelect: () => pick('open'), keys: '⌘O' },
    { id: 'locked', label: 'Bị khoá', icon: 'folder', onSelect: () => pick('locked'), disabled: true, title: 'chưa có backend' },
    { id: 'save', label: 'Tự lưu', icon: 'check', onSelect: () => pick('save'), checked: true },
    { id: 'prefs', label: 'Tuỳ chọn', icon: 'gear', onSelect: () => pick('prefs'), items: [
      { id: 'settings', label: 'Cài đặt', icon: 'gear', onSelect: () => sub('settings') },
      { id: 'keys', label: 'Phím tắt', icon: 'gear', onSelect: () => sub('keys') }
    ] }
  ]
  return { items, pick, sub }
}

const openMenu = async () => {
  const user = userEvent.setup()
  render(<PopoverMenu label="Tệp" trigger={<span>Tệp</span>} items={build().items} />)
  await user.click(screen.getByRole('button', { name: 'Tệp' }))
  return user
}

describe('PopoverMenu bàn phím và ARIA', () => {
  it('↑/↓ đi qua mục bật, bỏ qua mục disabled và quay vòng', async () => {
    await openMenu()
    const open = screen.getByRole('menuitem', { name: /Mở tệp/ })
    const save = screen.getByRole('menuitemcheckbox', { name: /Tự lưu/ })
    const prefs = screen.getByRole('menuitem', { name: /Tuỳ chọn/ })
    // Mở menu là focus sẵn mục đầu; ↓ bỏ qua mục disabled.
    expect(document.activeElement).toBe(open)
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(save)
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(prefs)
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(open)
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(prefs)
  })

  it('→ mở menu con và focus mục đầu; ← đóng menu con, menu cha còn mở', async () => {
    await openMenu()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Tuỳ chọn/ }))
    await userEvent.keyboard('{ArrowRight}')
    const settings = screen.getByRole('menuitem', { name: 'Cài đặt' })
    expect(settings).toBeInTheDocument()
    expect(document.activeElement).toBe(settings)
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.queryByRole('menuitem', { name: 'Cài đặt' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('Esc đóng menu con trước, Esc lần nữa mới đóng menu', async () => {
    await openMenu()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}')
    expect(screen.getByRole('menuitem', { name: 'Cài đặt' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menuitem', { name: 'Cài đặt' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('bấm mục trong menu con (chuột) chạy hành động và đóng menu', async () => {
    const user = userEvent.setup()
    const { items, sub } = build()
    render(<PopoverMenu label="Tệp" trigger={<span>Tệp</span>} items={items} />)
    await user.click(screen.getByRole('button', { name: 'Tệp' }))
    // Mở menu con bằng hover/click hàng cha rồi bấm mục con.
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: /Tuỳ chọn/ }).parentElement!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Phím tắt' }))
    expect(sub).toHaveBeenCalledWith('keys')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('menuitem là con trực tiếp của menu (wrapper role=none), mục checked có aria-checked', async () => {
    await openMenu()
    const menu = screen.getByRole('menu')
    const open = screen.getByRole('menuitem', { name: /Mở tệp/ })
    // Wrapper role="none" bị bỏ khỏi cây accessibility → menuitem là con trực tiếp của menu.
    expect(open.parentElement?.getAttribute('role')).toBe('none')
    expect(open.parentElement?.parentElement).toBe(menu)
    expect(screen.getByRole('menuitemcheckbox', { name: /Tự lưu/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitem', { name: /Mở tệp/ })).toHaveTextContent('⌘O')
    // Mục disabled vẫn hiện tooltip giải thích và không nhận focus bằng Tab.
    expect(screen.getByRole('menuitem', { name: /Bị khoá/ })).toHaveAttribute('title', 'chưa có backend')
  })

  it('chọn mục trong menu con bằng bàn phím chạy đúng hành động và đóng menu', async () => {
    const user = userEvent.setup()
    const { items, sub } = build()
    render(<PopoverMenu label="Tệp" trigger={<span>Tệp</span>} items={items} />)
    await user.click(screen.getByRole('button', { name: 'Tệp' }))
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Cài đặt' }))
    await userEvent.keyboard('{Enter}')
    expect(sub).toHaveBeenCalledWith('settings')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
