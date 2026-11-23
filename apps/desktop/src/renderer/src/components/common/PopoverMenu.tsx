import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
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

/** Menu bật từ một nút: popover bo 12px, hàng bo 7px như popover của Wu. Bấm ra ngoài hoặc Esc thì đóng. */
export function PopoverMenu({ label, trigger, items, className = '', buttonClass, onOpen }: { label: string; trigger: ReactNode; items: MenuItem[]; className?: string; buttonClass?: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(false)
  const [submenu, setSubmenu] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
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
  return <div className={`popover-menu-wrap ${className}`} ref={root}>
    <button type="button" className={buttonClass} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
      onClick={() => { if (!open) onOpen?.(); setOpen(!open) }}>{trigger}</button>
    {open && <div role="menu" className="popover-menu" onKeyDown={(event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const buttons = [...(event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > .popover-row-wrap > button:not(:disabled)'))]
      if (!buttons.length) return
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length
      buttons[next].focus()
    }}>
      {items.map((item, index) => {
        const key = item.id ?? `${item.label}-${index}`
        return <Fragment key={key}>
          {item.separatorBefore && <div role="separator" className="popover-separator" />}
          <div className="popover-row-wrap" onMouseEnter={() => item.items && !item.disabled && setSubmenu(key)} onMouseLeave={() => item.items && setSubmenu(null)}>
            <button type="button" role="menuitem" disabled={item.disabled} title={item.title}
              aria-haspopup={item.items ? 'menu' : undefined} aria-expanded={item.items ? submenu === key : undefined}
              onClick={() => {
                if (item.disabled) return
                if (item.items) { setSubmenu((cur) => cur === key ? null : key); return }
                close()
                item.onSelect()
              }}>
              <span className="popover-check" aria-hidden="true">{item.checked ? <Icon name="check" size={13} /> : null}</span>
              <Icon name={item.icon} size={14} />
              <span className="popover-label">{item.label}</span>
              {item.keys && <span className="popover-keys">{item.keys}</span>}
              {item.items && <Icon name="chevron" size={12} />}
            </button>
            {item.items && submenu === key && <div role="menu" className="popover-menu popover-submenu">
              {item.items.map((sub, subIndex) => <button key={sub.id ?? `${sub.label}-${subIndex}`} type="button" role="menuitem" disabled={sub.disabled} title={sub.title}
                onClick={() => { close(); sub.onSelect() }}>
                <span className="popover-check" aria-hidden="true">{sub.checked ? <Icon name="check" size={13} /> : null}</span>
                <Icon name={sub.icon} size={14} />
                <span className="popover-label">{sub.label}</span>
                {sub.keys && <span className="popover-keys">{sub.keys}</span>}
              </button>)}
            </div>}
          </div>
        </Fragment>
      })}
    </div>}
  </div>
}
