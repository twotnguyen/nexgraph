import type { ReactNode } from 'react'

export interface ActivityItem {
  id: string
  title: string
  icon: ReactNode
}

interface Props {
  items: ActivityItem[]
  active: string | null
  panelId?: string
  /** Bấm mục đang bật thì thu panel (gọi với chính id đó). */
  onToggle: (id: string) => void
  /** Nút ghim ở đáy thanh, như nút Quản lý của Wu. */
  footer?: ReactNode
}

export function ActivityBar({ items, active, panelId, onToggle, footer }: Props) {
  return (
    <nav className="activity-bar" aria-label="Thanh hoạt động">
      {items.map((it) => (
        <button key={it.id} type="button" title={it.title} aria-label={it.title} aria-pressed={active === it.id}
          aria-controls={active === it.id ? panelId : undefined} onClick={() => onToggle(it.id)}>
          {it.icon}
        </button>
      ))}
      {footer && <div className="activity-bar-footer">{footer}</div>}
    </nav>
  )
}
