import { tr } from '../../i18n/strings'
type Props = {
  message: string
  kind: 'loading' | 'error' | 'empty'
  onRetry?: () => void
}

export function CanvasState({ message, kind, onRetry }: Props) {
  return (
    <div className="canvas-state" data-state={kind}>
      <div className="canvas-state-content">
        {kind === 'loading' && <span className="canvas-spinner" aria-hidden="true" />}
        <p role={kind === 'error' ? 'alert' : 'status'}>{message}</p>
        {onRetry && <button type="button" onClick={onRetry}>{tr('Thử lại')}</button>}
      </div>
    </div>
  )
}
