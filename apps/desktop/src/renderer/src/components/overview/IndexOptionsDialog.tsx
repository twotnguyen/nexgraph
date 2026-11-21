import { useEffect, useState } from 'react'
import type { IndexOptions } from '@shared/graph-types'
import { vi } from '../../strings'
import { Icon } from '../common/icons'

interface Props {
  projectId: string
  onSubmit: (opts: Required<Pick<IndexOptions, 'exclude' | 'includeDocs' | 'includeMedia' | 'includeConfig' | 'force'>>
    & Pick<IndexOptions, 'workers' | 'sources'>) => void
  onClose: () => void
}

const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter(Boolean)

/** Danh sách đường dẫn sửa tay được, nút thêm mở hộp chọn tệp của main. */
function FileList({ label, add, kind, value, onChange }: { label: string; add: string; kind: 'scip' | 'mcp'; value: string; onChange: (v: string) => void }) {
  const pick = (): void => {
    window.nexgraph.indexSources.pickFile(kind).then((p) => { if (p) onChange(value.trim() ? `${value.trim()}\n${p}` : p) }).catch(() => {})
  }
  return (
    <label className="field">
      <span>{label}</span>
      <textarea aria-label={label} rows={2} className="mono" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={pick}>{add}</button>
    </label>
  )
}

export function IndexOptionsDialog({ projectId, onSubmit, onClose }: Props) {
  const [text, setText] = useState('')
  const [includeDocs, setDocs] = useState(false)
  const [includeMedia, setMedia] = useState(false)
  const [includeConfig, setConfig] = useState(false)
  const [force, setForce] = useState(false)
  const [workersText, setWorkers] = useState('')
  const [whisperMissing, setWhisperMissing] = useState(false)
  const [pgMissing, setPgMissing] = useState(false)
  const [postgres, setPostgres] = useState(false)
  const [dsn, setDsn] = useState('')
  const [hasDsn, setHasDsn] = useState(false)
  const [cargo, setCargo] = useState(false)
  const [manifests, setManifests] = useState(false)
  const [scipText, setScip] = useState('')
  const [mcpText, setMcp] = useState('')
  const [dsnError, setDsnError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    // Lỗi khi dò công cụ không chặn: engine vẫn báo thiếu công cụ theo từng tệp khi index.
    window.nexgraph.engine.tools().then((t) => {
      if (!live) return
      setWhisperMissing(t.faster_whisper === false)
      setPgMissing(t.psycopg === false)
    }).catch(() => {})
    window.nexgraph.indexSources.hasDsn(projectId).then((v) => live && setHasDsn(v)).catch(() => {})
    window.nexgraph.indexSources.remembered(projectId).then((s) => {
      if (!live || !s) return
      setPostgres(!!s.postgres); setCargo(!!s.cargo); setManifests(!!s.manifests)
      setScip((s.scipFiles ?? []).join('\n')); setMcp((s.mcpFiles ?? []).join('\n'))
    }).catch(() => {})
    return () => { live = false }
  }, [projectId])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const exclude = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const workers = Number.parseInt(workersText, 10)
  const scipFiles = lines(scipText)
  const mcpFiles = lines(mcpText)
  const usePostgres = postgres && !pgMissing
  // Luôn gửi tường minh: bỏ chọn hết là tắt nguồn đã nhớ (nút Index lại không gửi thì main dùng bản đã nhớ).
  const sources = { sources: { postgres: usePostgres, cargo, manifests, scipFiles, mcpFiles } }
  const needDsn = usePostgres && !hasDsn && !dsn.trim()
  const submit = async (): Promise<void> => {
    // DSN đi thẳng xuống kho khoá của main; tuỳ chọn index chỉ mang cờ `postgres`.
    if (usePostgres && dsn.trim()) {
      try {
        await window.nexgraph.indexSources.saveDsn(projectId, dsn.trim())
      } catch (e) {
        setDsnError(vi.overview.dsnSaveFailed(e instanceof Error ? e.message : String(e)))
        return
      }
    }
    onSubmit({ exclude, includeDocs, includeMedia, includeConfig, force,
      ...(workers >= 1 && workers <= 64 ? { workers } : {}), ...sources })
  }
  const forgetDsn = (): void => {
    window.nexgraph.indexSources.saveDsn(projectId, null).then(() => setHasDsn(false)).catch(() => {})
  }
  return (
    <div className="modal-backdrop">
      <div role="dialog" aria-modal="true" aria-label={vi.overview.optionsTitle} className="modal">
        <header>
          <b>{vi.overview.optionsTitle}</b>
          <button type="button" aria-label={vi.export.close} onClick={onClose}><Icon name="close" size={14} /></button>
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
        <details>
          <summary>{vi.overview.sourcesTitle}</summary>
          <small className="muted">{vi.overview.sourcesHint}</small>
          <label className={pgMissing ? 'muted' : undefined}><input type="checkbox" checked={usePostgres} disabled={pgMissing}
            onChange={(e) => setPostgres(e.target.checked)} /> {vi.overview.sourcePostgres}</label>
          {pgMissing && <small className="muted">{vi.overview.needPsycopg}</small>}
          {usePostgres && (
            <label className="field">
              <span>{vi.overview.dsnLabel}</span>
              <input type="password" autoComplete="off" className="mono" aria-label={vi.overview.dsnLabel}
                placeholder={vi.overview.dsnPlaceholder} value={dsn} onChange={(e) => setDsn(e.target.value)} />
              {hasDsn
                ? <small className="muted">{vi.overview.dsnSaved} <button type="button" onClick={forgetDsn}>{vi.overview.dsnForget}</button></small>
                : needDsn && <small className="muted">{vi.overview.needDsn}</small>}
              {dsnError && <small role="alert" className="error">{dsnError}</small>}
            </label>
          )}
          <label><input type="checkbox" checked={cargo} onChange={(e) => setCargo(e.target.checked)} /> {vi.overview.sourceCargo}</label>
          <label><input type="checkbox" checked={manifests} onChange={(e) => setManifests(e.target.checked)} /> {vi.overview.sourceManifests}</label>
          <FileList label={vi.overview.scipLabel} add={vi.overview.scipAdd} kind="scip" value={scipText} onChange={setScip} />
          <FileList label={vi.overview.mcpLabel} add={vi.overview.mcpAdd} kind="mcp" value={mcpText} onChange={setMcp} />
          <small className="muted">{vi.overview.filesHint}</small>
        </details>
        <footer>
          <button type="button" onClick={onClose}>{vi.overview.cancel}</button>
          <button type="button" className="primary" disabled={needDsn} onClick={() => void submit()}>{vi.overview.reindexWithOptions}</button>
        </footer>
      </div>
    </div>
  )
}
