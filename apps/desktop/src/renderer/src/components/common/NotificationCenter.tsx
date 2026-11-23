import { useEffect, useRef, useSyncExternalStore } from 'react'
import { tr } from '../../strings'
import { Icon } from './icons'
import './notification-center.css'

export interface Notice { id: number; message: string; /** Dấu nhận dạng không phụ thuộc ngôn ngữ (msgId) để thu hồi sau khi đổi ngôn ngữ. */ code?: string }

let notices: readonly Notice[] = []
let nextId = 0
let open = false
const noticeListeners = new Set<() => void>()
const openListeners = new Set<() => void>()
const noticeSnapshot = () => notices
const openSnapshot = () => open
const emit = (listeners: Set<() => void>) => { for (const listener of listeners) listener() }

export function subscribeNotifications(listener: () => void): () => void {
  noticeListeners.add(listener)
  return () => { noticeListeners.delete(listener) }
}
const subscribeOpen = (listener: () => void) => {
  openListeners.add(listener)
  return () => { openListeners.delete(listener) }
}
const publish = (next: readonly Notice[]) => {
  notices = next
  emit(noticeListeners)
}

/** Hàng đợi dùng chung: mọi nơi có thể đẩy thông báo rồi chuông trên thanh công cụ đọc ra. */
export function notify(message: string, code?: string): void {
  if (!message) return
  publish([...notices, { id: ++nextId, message, ...(code ? { code } : {}) }].slice(-20))
}
export function dismissNotification(id: number): void {
  publish(notices.filter((notice) => notice.id !== id))
}
export function clearNotifications(): void {
  if (notices.length) publish([])
}
/** Gỡ mọi thông báo có đúng nội dung (hoặc đúng `code`) — dùng khi cảnh báo đã khôi phục. */
export function withdrawNotification(message: string, code?: string): void {
  const next = notices.filter((notice) => code ? notice.code !== code : notice.message !== message)
  if (next.length !== notices.length) publish(next)
}
export function toggleNotifications(): void {
  open = !open
  emit(openListeners)
}
export const useNotifications = (): readonly Notice[] => useSyncExternalStore(subscribeNotifications, noticeSnapshot, noticeSnapshot)
export const useNotificationCenterOpen = (): boolean => useSyncExternalStore(subscribeOpen, openSnapshot, openSnapshot)

const Bell = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 15v-4a6 6 0 0 0-12 0v4l-2 3h16zM10 21h4" />
  </svg>
)

/** Chuông + danh sách thông báo; WorkspaceScreen gắn lệnh mở/xoá vào store module này. */
export function NotificationCenter() {
  const items = useNotifications()
  const open = useNotificationCenterOpen()
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) toggleNotifications() }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') toggleNotifications() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="notification-center" ref={root}>
      <button type="button" className="notification-bell" aria-label={tr('Thông báo')} title={tr('Thông báo')}
        aria-haspopup="dialog" aria-expanded={open} onClick={toggleNotifications}>
        <Bell />
        {items.length > 0 && <span className="notification-badge" aria-hidden="true">{items.length}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={tr('Trung tâm thông báo')} className="notification-panel">
          <div className="notification-head">
            <strong>{tr('Thông báo')}</strong>
            <button type="button" disabled={!items.length} onClick={clearNotifications}>{tr('Xoá tất cả')}</button>
          </div>
          {items.length
            ? <ul>{items.map((notice) => (
              <li key={notice.id}>
                <span role="status">{notice.message}</span>
                <button type="button" className="ws-icon-button" aria-label={tr('Đóng thông báo')} title={tr('Đóng thông báo')}
                  onClick={() => dismissNotification(notice.id)}><Icon name="close" size={14} /></button>
              </li>
            ))}</ul>
            : <p className="muted">{tr('Không có thông báo')}</p>}
        </div>
      )}
    </div>
  )
}
