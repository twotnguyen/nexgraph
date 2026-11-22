import type { ReactNode } from 'react'

/** Slot khung trợ lý: giữ AgentPanel ở trái/phải của shell, kể cả khi đang ẩn để không mất bản nháp. */
export function ChatDock({ side, hidden = false, children }: { side: 'left' | 'right'; hidden?: boolean; children: ReactNode }) {
  return <div className="ws-dock" data-dock={side} hidden={hidden}>{children}</div>
}
