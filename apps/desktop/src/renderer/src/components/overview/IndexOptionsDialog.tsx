import { useEffect, useState } from 'react'
import type { IndexOptions } from '@shared/graph-types'
import { vi } from '../../strings'

interface Props {
  onSubmit: (opts: Required<Pick<IndexOptions, 'exclude' | 'includeDocs' | 'includeMedia' | 'includeConfig' | 'force'>>
    & Pick<IndexOptions, 'workers'>) => void
  onClose: () => void
}

export function IndexOptionsDialog({ onSubmit, onClose }: Props) {
  const [text, setText] = useState('')
  const [includeDocs, setDocs] = useState(false)
  const [includeMedia, setMedia] = useState(false)
  const [includeConfig, setConfig] = useState(false)
  const [force, setForce] = useState(false)
  const [workersText, setWorkers] = useState('')
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
  const workers = Number.parseInt(workersText, 10)
  const submit = (): void => onSubmit({ exclude, includeDocs, includeMedia, includeConfig, force,
    ...(workers >= 1 && workers <= 64 ? { workers } : {}) })
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
        <label className="field">
          <span>{vi.overview.workers}</span>
          <input type="number" min={1} max={64} aria-label={vi.overview.workers} placeholder={vi.overview.workersHint}
            value={workersText} onChange={(e) => setWorkers(e.target.value)} />
        </label>
        <label><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> {vi.overview.force}</label>
        <label><input type="checkbox" checked={includeConfig} onChange={(e) => setConfig(e.target.checked)} /> {vi.overview.includeConfig}</label>
        <label><input type="checkbox" checked={includeDocs}
          onChange={(e) => { setDocs(e.target.checked); if (!e.target.checked) setMedia(false) }} /> {vi.overview.includeDocs}</label>
        <label className={includeDocs && !whisperMissing ? undefined : 'muted'}><input type="checkbox" checked={includeMedia}
          disabled={!includeDocs || whisperMissing} onChange={(e) => setMedia(e.target.checked)} /> {vi.overview.includeMedia}</label>
        {whisperMissing && <small className="muted">{vi.overview.needWhisper}</small>}
        <small className="muted">{vi.overview.languageMapHint}</small>
        <footer>
          <button type="button" onClick={onClose}>{vi.overview.cancel}</button>
          <button type="button" className="primary" onClick={submit}>{vi.overview.reindexWithOptions}</button>
        </footer>
      </div>
    </div>
  )
}
