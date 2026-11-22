import { Children, cloneElement, isValidElement, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { EngineStatus } from '@shared/engine-status'
import { isStatusItemHidden, setStatusItemHidden, useHiddenStatusItems, useStatusBar } from '../state/layoutPrefs'
import { runCommand, useCommandAvailable } from '../state/commands'
import { getStatusBarItem } from '../state/statusBarRegistry'
import { tr } from '../strings'

const RIGHT_SLOT = 'status-bar-right'

interface Props {
  status: EngineStatus
  onRestart: () => void
}

/** Thanh trạng thái kiểu Wu: trái là trạng thái engine, phải là mục của thẻ đang mở (vị trí con trỏ, ngôn ngữ…). */
export function EngineStatusBar({ status, onRestart }: Props) {
  const shown = useStatusBar()
  const gitAvailable = useCommandAvailable('git_panel.toggle')
  const notificationsAvailable = useCommandAvailable('notifications.toggle')
  // Ẩn bằng thuộc tính hidden (vẫn dựng sẵn để StatusBarItems tìm được chỗ gắn); engine lỗi thì luôn hiện để còn nút Khởi động lại.
  return (
    <footer className="status-bar" aria-label={tr('Thanh trạng thái')} data-state={status.state} hidden={!shown && status.state !== 'error'}>
      <button type="button" className="status-item status-engine" title={tr(getStatusBarItem('engine')!.labelKey)}
        aria-label={status.state === 'error' ? tr('Khởi động lại') : undefined} onClick={onRestart}>
        <span role="status">
          {status.state === 'starting' && tr('Engine: đang khởi động…')}
          {status.state === 'ready' && tr('Engine: sẵn sàng (v{version})', { version: status.engineVersion })}
          {status.state === 'error' && tr('Engine: lỗi — {message}', { message: status.message })}
        </span>
      </button>
      <StatusBarItems>
        {gitAvailable && <button type="button" data-status-id="git" className="status-item">{tr(getStatusBarItem('git')!.labelKey)}</button>}
        {notificationsAvailable && <button type="button" data-status-id="notifications" className="status-item">{tr(getStatusBarItem('notifications')!.labelKey)}</button>}
      </StatusBarItems>
      <div id={RIGHT_SLOT} className="status-right" />
    </footer>
  )
}

/** Đưa các mục vào phía phải thanh trạng thái; chỉ thẻ đang hiện nên gắn. Bấm chuột phải một mục để ẩn riêng mục đó. */
export function StatusBarItems({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const hidden = useHiddenStatusItems()
  useEffect(() => setSlot(document.getElementById(RIGHT_SLOT)), [])
  useEffect(() => {
    if (!menu) return
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [menu])
  const items = Children.toArray(children).flatMap((child, index) => {
    if (!isValidElement(child)) return [child]
    const element = child as ReactElement<Record<string, unknown>>
    const given = element.props['data-status-id']
    const id = typeof given === 'string' ? given : `item-${index}`
    if (hidden.has(id)) return []
    const previousClick = element.props.onClick as ((event: ReactMouseEvent) => void) | undefined
    const previousContext = element.props.onContextMenu as ((event: ReactMouseEvent) => void) | undefined
    const registryItem = getStatusBarItem(id)
    return [cloneElement(element, {
      key: id,
      'data-status-id': id,
      title: registryItem && !element.props.title ? tr(registryItem.labelKey) : element.props.title,
      onClick: registryItem && !previousClick && registryItem.visible !== false ? () => runCommand(registryItem.command) : previousClick,
      onContextMenu: (event: ReactMouseEvent) => {
        previousContext?.(event)
        event.preventDefault()
        setMenu({ id, x: event.clientX, y: event.clientY })
      }
    })]
  })
  return <>
    {slot && createPortal(items, slot)}
    {menu && createPortal(<>
      <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null) }} />
      <div role="menu" ref={menuRef} aria-label={tr('Tuỳ chọn mục trạng thái')} className="context-menu status-item-menu"
        style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 220)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 80)) }}>
        <button type="button" role="menuitem" onClick={() => { setStatusItemHidden(menu.id, true); setMenu(null) }}>{tr('Ẩn nút này')}</button>
      </div>
    </>, document.body)}
  </>
}
