import type { ReactNode } from 'react'
import { Icon } from '../../shared/ui/icons'
import { useLocale } from '../../shared/lib/locale'
import { tr } from '../../i18n/strings'
import { PopoverMenu, type MenuItem } from '../../shared/ui/PopoverMenu'

export interface ActivityItem {
  id: string
  title: string
  icon: ReactNode
  /** Số nhỏ ở góc nút, như số tệp đổi trên nút git của Wu. */
  badge?: number
}

interface Props {
  items: ActivityItem[]
  active: string | null
  panelId?: string
  /** Bấm mục đang bật thì thu panel (gọi với chính id đó). */
  onToggle: (id: string) => void
  /** Nút bánh răng "Quản lý" ở đáy thanh, như Wu. */
  manage?: MenuItem[]
}

export function ActivityBar({ items, active, panelId, onToggle, manage }: Props) {
  useLocale()
  return (
    <nav className="activity-bar" aria-label={tr('Thanh hoạt động')}>
      {items.map((it) => (
        <button key={it.id} type="button" title={it.badge ? `${it.title} · ${it.badge}` : it.title} aria-label={it.title} aria-pressed={active === it.id}
          aria-controls={active === it.id ? panelId : undefined} onClick={() => onToggle(it.id)}>
          {it.icon}
          {!!it.badge && <span className="activity-badge" aria-hidden="true">{it.badge > 99 ? '99+' : it.badge}</span>}
        </button>
      ))}
      {manage && <PopoverMenu className="activity-bar-manage popover-up-right" label={tr('Quản lý')} trigger={<Icon name="gear" size={20} />} items={manage} />}
    </nav>
  )
}
