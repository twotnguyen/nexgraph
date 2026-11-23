import { Fragment, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import './popover-menu.css'

export type MenuItem = {
  /** Khoá ổn định khi label trùng nhau (vd “Mở tệp…” ở nhiều nhóm). */
  id?: string
  label: string
  icon: IconName
  onSelect: () => void
  disabled?: boolean
  /** Phím tắt hiển thị cạnh phải, đã format theo nền tảng. */
  keys?: string
  separatorBefore?: boolean
  checked?: boolean
  /** Tooltip, dùng để giải thích mục bị disable. */
  title?: string
  /** Mục có menu con (Open Recent, Preferences…). */
  items?: MenuItem[]
}

/** Item bật trong một menu (bỏ separator và mục disabled). */
const focusable = (menu: HTMLElement | null): HTMLButtonElement[] =>
  menu ? [...menu.querySelectorAll<HTMLButtonElement>(':scope > .popover-row-wrap > button:not(:disabled), :scope > button:not(:disabled)')] : []

/** Menu bật từ một nút: popover bo 12px, hàng bo 7px như popover của Wu. Bấm ra ngoài hoặc Esc thì đóng. */
export function PopoverMenu({ label, trigger, items, className = '', buttonClass }: { label: string; trigger: ReactNode; items: MenuItem[]; className?: string; buttonClass?: string }) {
  const [open, setOpen] = useState(false)
  const [submenu, setSubmenu] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const close = () => { setOpen(false); setSubmenu(null) }
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  // Mở menu thì đưa focus vào mục đầu (bàn phím đi tiếp từ đây); menu con cũng vậy.
  useEffect(() => {
    if (!open) return
    focusable(root.current?.querySelector<HTMLElement>('[role="menu"]') ?? null)[0]?.focus()
  }, [open])
  useEffect(() => { if (submenu) focusable(submenuRef.current)[0]?.focus() }, [submenu])

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const active = document.activeElement as HTMLElement | null
    const menu = active?.closest<HTMLElement>('[role="menu"]') ?? event.currentTarget
    if (event.key === 'Escape') {
      // Esc đóng menu con trước, không đóng cả menu; document listener chỉ chạy khi không stop.
      if (submenu) { event.stopPropagation(); setSubmenu(null); return }
      return
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const row = active?.closest<HTMLElement>('.popover-row-wrap') ?? null
      const key = row?.dataset.menuKey
      if (event.key === 'ArrowRight') {
        if (!key || !row) return
        const hasItems = row.querySelector(':scope > button[aria-haspopup="menu"]')
        if (!hasItems) return
        event.preventDefault()
        setSubmenu(key)
        return
      }
      if (submenu) {
        event.preventDefault()
        const parentKey = submenu
        setSubmenu(null)
        window.requestAnimationFrame(() => {
          root.current?.querySelector<HTMLButtonElement>(`[data-menu-key="${parentKey}"] > button`)?.focus()
        })
      }
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = focusable(menu)
    if (!buttons.length) return
    const current = buttons.indexOf(active as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length
    buttons[next].focus()
  }

  const renderRow = (item: MenuItem, key: string, parent: boolean) => <div className="popover-row-wrap" role="none" data-menu-key={key}
    onMouseEnter={() => { if (!item.disabled) setSubmenu(item.items ? key : null) }}>
    <button type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} disabled={item.disabled} title={item.title}
      aria-checked={item.checked === undefined ? undefined : item.checked}
      aria-haspopup={item.items ? 'menu' : undefined} aria-expanded={item.items ? submenu === key : undefined}
      onClick={() => {
        if (item.disabled) return
        if (item.items) { setSubmenu(key); return }
        close()
        item.onSelect()
      }}>
      <span className="popover-check" aria-hidden="true">{item.checked ? <Icon name="check" size={13} /> : null}</span>
      <Icon name={item.icon} size={14} />
      <span className="popover-label">{item.label}</span>
      {item.keys && <span className="popover-keys">{item.keys}</span>}
      {item.items && <Icon name="chevron" size={12} />}
    </button>
    {item.items && submenu === key && <div role="menu" className="popover-menu popover-submenu" ref={parent ? submenuRef : undefined}>
      {item.items.map((sub, subIndex) => {
        const subKey = sub.id ?? `${sub.label}-${subIndex}`
        return <button key={subKey} type="button" role={sub.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={sub.checked === undefined ? undefined : sub.checked} disabled={sub.disabled} title={sub.title}
          onClick={() => { close(); sub.onSelect() }}>
          <span className="popover-check" aria-hidden="true">{sub.checked ? <Icon name="check" size={13} /> : null}</span>
          <Icon name={sub.icon} size={14} />
          <span className="popover-label">{sub.label}</span>
          {sub.keys && <span className="popover-keys">{sub.keys}</span>}
        </button>
      })}
    </div>}
  </div>

  return <div className={`popover-menu-wrap ${className}`} ref={root} onMouseLeave={() => setSubmenu(null)}>
    <button type="button" className={buttonClass} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => setOpen(!open)}>{trigger}</button>
    {open && <div role="menu" className="popover-menu" onKeyDown={onKeyDown}>
      {items.map((item, index) => {
        const key = item.id ?? `${item.label}-${index}`
        return <Fragment key={key}>
          {item.separatorBefore && <div role="separator" className="popover-separator" />}
          {renderRow(item, key, !item.items ? false : true)}
        </Fragment>
      })}
    </div>}
  </div>
}
