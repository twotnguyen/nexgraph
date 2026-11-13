import { useEffect, useState } from 'react'
import type { IndexOptions } from '@shared/graph-types'
import { vi } from '../../strings'

interface Props {
  onSubmit: (opts: Required<Pick<IndexOptions, 'exclude' | 'includeDocs' | 'includeMedia'>>) => void
  onClose: () => void
}

export function IndexOptionsDialog({ onSubmit, onClose }: Props) {
  const [text, setText] = useState('')
  const [includeDocs, setDocs] = useState(false)
  const [includeMedia, setMedia] = useState(false)
  const [whisperMissing, setWhisperMissing] = useState(false)
  useEffect(() => {
    let live = true
    // Lỗi khi dò công cụ không chặn: engine vẫn báo thiếu công cụ theo từng tệp khi index.
    window.nexgraph.engine.tools().then((t) => live && setWhisperMissing(t.faster_whisper === false)).catch(() => {})
    return () => { live = false }
  }, [])
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
        <label><input type="checkbox" checked={includeDocs}
          onChange={(e) => { setDocs(e.target.checked); if (!e.target.checked) setMedia(false) }} /> {vi.overview.includeDocs}</label>
        <label className={includeDocs && !whisperMissing ? undefined : 'muted'}><input type="checkbox" checked={includeMedia}
          disabled={!includeDocs || whisperMissing} onChange={(e) => setMedia(e.target.checked)} /> {vi.overview.includeMedia}</label>
        {whisperMissing && <small className="muted">{vi.overview.needWhisper}</small>}
        <footer>
          <button type="button" onClick={onClose}>{vi.overview.cancel}</button>
          <button type="button" className="primary" onClick={() => onSubmit({ exclude, includeDocs, includeMedia })}>{vi.overview.reindexWithOptions}</button>
        </footer>
      </div>
    </div>
  )
}
