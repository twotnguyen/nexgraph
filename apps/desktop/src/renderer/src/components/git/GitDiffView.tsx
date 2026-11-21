import { useEffect, useRef, useState } from 'react'
import { createDiffEditor, languageFor } from '../editor/monaco'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { Icon } from '../common/icons'

/** Thẻ diff của Git panel: trái là HEAD/index, phải là index/đĩa; chỉ đọc, làm mới khi tệp đổi trên đĩa. */
export function GitDiffView({ projectId, file, staged, onClose, onOpenFile }: { projectId: string; file: string; staged: boolean; onClose: () => void; onOpenFile: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => window.nexgraph.index.onEvent((event) => {
    if (event.type === 'changes_updated' && event.project_id === projectId) setRevision((n) => n + 1)
  }), [projectId])

  useEffect(() => {
    let live = true
    let handle: { dispose(): void } | null = null
    window.nexgraph.git?.diff(projectId, file, staged).then((sides) => {
      if (!live || !host.current) return
      handle = createDiffEditor(host.current, { ...sides, language: languageFor(file) })
      setError(null)
    }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false; handle?.dispose() }
  }, [projectId, file, staged, revision])

  return (
    <div className="code-viewer editor-tab git-diff">
      <header className="code-head">
        <span className="editor-path mono" title={file}><FileTypeIcon name={file} size={14} /> {file} <span className="muted">· {staged ? 'đã stage' : 'chưa stage'}</span></span>
        <span className="ws-editor-actions">
          <button type="button" className="ws-icon-button" aria-label="Mở tệp" title="Mở tệp" onClick={onOpenFile}><Icon name="pencil" size={15} /></button>
          <button type="button" className="ws-icon-button" aria-label="Đóng diff" title="Đóng diff" onClick={onClose}><Icon name="close" size={15} /></button>
        </span>
      </header>
      {error && <p role="alert" className="ws-editor-loading error">{error}</p>}
      <div ref={host} className="editor-host diff-host" />
    </div>
  )
}
