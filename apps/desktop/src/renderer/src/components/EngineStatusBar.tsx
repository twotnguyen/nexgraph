import type { EngineStatus } from '@shared/engine-status'

interface Props {
  status: EngineStatus
  onRestart: () => void
}

export function EngineStatusBar({ status, onRestart }: Props) {
  return (
    <footer className="status-bar" role="status" data-state={status.state}>
      {status.state === 'starting' && <span>Engine: đang khởi động…</span>}
      {status.state === 'ready' && <span>{`Engine: sẵn sàng (v${status.engineVersion})`}</span>}
      {status.state === 'error' && (
        <>
          <span>{`Engine: lỗi — ${status.message}`}</span>
          <button type="button" onClick={onRestart}>
            Khởi động lại
          </button>
        </>
      )}
    </footer>
  )
}
