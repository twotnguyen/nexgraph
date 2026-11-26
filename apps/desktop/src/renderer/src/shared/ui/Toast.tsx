import { useEffect } from 'react'
import { tr } from '../../i18n/strings'
import { Icon } from './icons'

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 6000)
    return () => window.clearTimeout(timer)
  }, [message, onDismiss])

  return (
    <div className="toast">
      <Icon name="check" size={18} />
      <span role="status">{message}</span>
      <button type="button" aria-label={tr('Đóng thông báo')} className="icon-button" onClick={onDismiss}><Icon name="close" size={15} /></button>
    </div>
  )
}
