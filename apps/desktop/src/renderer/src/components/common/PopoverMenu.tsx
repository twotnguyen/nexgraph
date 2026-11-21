import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import './popover-menu.css'

export type MenuItem = { label: string; icon: IconName; onSelect: () => void; disabled?: boolean }

/** Menu bật từ một nút: popover bo 12px, hàng bo 7px như popover của Wu. Bấm ra ngoài hoặc Esc thì đóng. */
export function PopoverMenu({ label, trigger, items, className = '', buttonClass }: { label: string; trigger: ReactNode; items: MenuItem[]; className?: string; buttonClass?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return <div className={`popover-menu-wrap ${className}`} ref={root}>
    <button type="button" className={buttonClass} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{trigger}</button>
    {open && <div role="menu" className="popover-menu">
      {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect() }}>
        <Icon name={item.icon} size={14} /><span>{item.label}</span>
      </button>)}
    </div>}
  </div>
}
