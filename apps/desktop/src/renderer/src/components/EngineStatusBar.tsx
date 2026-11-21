import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { EngineStatus } from '@shared/engine-status'
import { useStatusBar } from '../state/layoutPrefs'

const RIGHT_SLOT = 'status-bar-right'

interface Props {
  status: EngineStatus
  onRestart: () => void
}

/** Thanh trạng thái kiểu Wu: trái là trạng thái engine, phải là mục của thẻ đang mở (vị trí con trỏ, ngôn ngữ…). */
export function EngineStatusBar({ status, onRestart }: Props) {
  const shown = useStatusBar()
  // Ẩn bằng thuộc tính hidden (vẫn dựng sẵn để StatusBarItems tìm được chỗ gắn); engine lỗi thì luôn hiện để còn nút Khởi động lại.
  return (
    <footer className="status-bar" aria-label="Thanh trạng thái" data-state={status.state} hidden={!shown && status.state !== 'error'}>
      <span className="status-item status-engine" role="status">
        {status.state === 'starting' && 'Engine: đang khởi động…'}
        {status.state === 'ready' && `Engine: sẵn sàng (v${status.engineVersion})`}
        {status.state === 'error' && `Engine: lỗi — ${status.message}`}
      </span>
      {status.state === 'error' && <button type="button" className="status-item" onClick={onRestart}>Khởi động lại</button>}
      <div id={RIGHT_SLOT} className="status-right" />
    </footer>
  )
}

/** Đưa các mục vào phía phải thanh trạng thái; chỉ thẻ đang hiện nên gắn. */
export function StatusBarItems({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => setSlot(document.getElementById(RIGHT_SLOT)), [])
  return slot ? createPortal(children, slot) : null
}
