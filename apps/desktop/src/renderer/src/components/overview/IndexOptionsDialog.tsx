import { useEffect, useState } from 'react'
import { vi } from '../../strings'

interface Props {
  onSubmit: (opts: { exclude: string[] }) => void
  onClose: () => void
}

export function IndexOptionsDialog({ onSubmit, onClose }: Props) {
  const [text, setText] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const exclude = text.split('\n').map((l) => l.trim()).filter(Boolean)
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-label={vi.overview.optionsTitle} className="modal">
        <header>
          <b>{vi.overview.optionsTitle}</b>
          <button type="button" aria-label={vi.export.close} onClick={onClose}>×</button>
        </header>
        <label className="field">
          <span>{vi.overview.excludeLabel}</span>
          <textarea aria-label={vi.overview.excludeLabel} rows={6} className="mono" placeholder={'build/\nvendor/\n*.g.dart'}
            value={text} onChange={(e) => setText(e.target.value)} />
          <small className="muted">{vi.overview.excludeHint}</small>
        </label>
        <label className="muted"><input type="checkbox" disabled /> {vi.overview.workersSoon}</label>
        <label className="muted"><input type="checkbox" disabled /> {vi.overview.docsSoon}</label>
        <footer>
          <button type="button" onClick={onClose}>{vi.overview.cancel}</button>
          <button type="button" className="primary" onClick={() => onSubmit({ exclude })}>{vi.overview.reindexWithOptions}</button>
        </footer>
      </div>
    </div>
  )
}
