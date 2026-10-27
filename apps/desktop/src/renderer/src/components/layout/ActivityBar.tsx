import type { ReactNode } from 'react'

export interface ActivityItem {
  id: string
  title: string
  icon: ReactNode
}

interface Props {
  items: ActivityItem[]
  active: string | null
  /** Bấm mục đang bật thì thu panel (gọi với chính id đó). */
  onToggle: (id: string) => void
}

export function ActivityBar({ items, active, onToggle }: Props) {
  return (
    <nav className="activity-bar" aria-label="Thanh hoạt động">
      {items.map((it) => (
        <button key={it.id} type="button" title={it.title} aria-label={it.title} aria-pressed={active === it.id} onClick={() => onToggle(it.id)}>
          {it.icon}
        </button>
      ))}
    </nav>
  )
}
