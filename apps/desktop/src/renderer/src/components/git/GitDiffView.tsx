import { useEffect, useRef, useState } from 'react'
import type { GitCommit, GitHunk } from '@shared/api'
import { createDiffEditor, languageFor } from '../editor/monaco'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { Icon } from '../common/icons'
import { errorMsg } from '../../state/errorText'
import { tr } from '../../strings'
import { msg, msgText, type Message } from '../../state/messages'

/** Thẻ diff Git, gồm các khối có thể stage hoặc bỏ stage riêng. */
export function GitDiffView({ projectId, file, staged, rev, from, onClose, onOpenFile }: { projectId: string; file: string; staged: boolean; rev?: string; from?: string; onClose: () => void; onOpenFile: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<Message | null>(null)
  const [actionError, setActionError] = useState<Message | null>(null)
  const [hunks, setHunks] = useState<GitHunk[]>([])
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [baseChoice, setBaseChoice] = useState<string | undefined>(undefined)
  const [baseOptions, setBaseOptions] = useState<GitCommit[]>([])
  useEffect(() => {
    if (rev !== undefined) return
    let live = true
    void window.nexgraph.git?.history(projectId, false).then((commits) => {
      if (live) setBaseOptions(commits.slice(0, 8))
    }).catch(() => {})
    return () => { live = false }
  }, [projectId, rev])

  useEffect(() => {
    if (rev !== undefined) return
    const off = window.nexgraph.index.onEvent((event) => {
      if (event.type === 'changes_updated' && event.project_id === projectId) setRevision((n) => n + 1)
    })
    const onGitChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === projectId) setRevision((n) => n + 1)
    }
    window.addEventListener('nexgraph:git-changed', onGitChange)
    return () => { off(); window.removeEventListener('nexgraph:git-changed', onGitChange) }
  }, [projectId, rev])

  useEffect(() => { setActionError(null) }, [projectId, file, staged, rev, from])

  useEffect(() => {
    let live = true
    let handle: { dispose(): void } | null = null
    setHunks([])
    setError(null)
    const api = window.nexgraph.git
    if (!api) {
      setError(msg('Git không dùng được ở chế độ này.'))
      return () => { live = false }
    }
    const sides = rev === undefined ? api.diff(projectId, file, staged, baseChoice) : api.commitDiff(projectId, rev, file, from)
    void sides.then((result) => {
      if (!live || !host.current) return
      handle = createDiffEditor(host.current, { ...result, language: languageFor(file) })
    }).catch((e: unknown) => { if (live) setError(errorMsg(e)) })
    if (rev === undefined && baseChoice === undefined) {
      void api.hunks(projectId, file, staged).then((result) => {
        if (live) setHunks(result)
      }).catch((e: unknown) => { if (live) setError(errorMsg(e)) })
    }
    return () => { live = false; handle?.dispose() }
  }, [projectId, file, staged, rev, from, baseChoice, revision])

  const applyHunk = async (id: string) => {
    const api = window.nexgraph.git
    if (!api || busy) return
    setBusy(true)
    setActionError(null)
    try {
      await api.applyHunk(projectId, file, staged, id)
      window.dispatchEvent(new CustomEvent('nexgraph:git-changed', { detail: projectId }))
    } catch (e) {
      setActionError(errorMsg(e))
      setRevision((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="code-viewer editor-tab git-diff">
      <header className="code-head">
        <span className="editor-path mono" title={file}><FileTypeIcon name={file} size={14} /> {file} <span className="muted">· {rev !== undefined ? `commit ${rev.slice(0, 7)}` : baseChoice !== undefined ? tr('so với {base}', { base: baseChoice.slice(0, 7) }) : staged ? tr('đã stage') : tr('chưa stage')}</span></span>
        <span className="ws-editor-actions">
          {rev === undefined && <label className="git-diff-base">{tr('Base')}{' '}
            <select aria-label={tr('Base để so sánh')} value={baseChoice ?? ''} onChange={(event) => setBaseChoice(event.target.value || undefined)}>
              <option value="">{tr('HEAD')}</option>
              {baseChoice && !baseOptions.some((commit) => commit.sha === baseChoice) && <option value={baseChoice}>{baseChoice.slice(0, 7)}</option>}
              {baseOptions.map((commit) => <option key={commit.sha} value={commit.sha}>{commit.sha.slice(0, 7)} {commit.subject}</option>)}
            </select>
          </label>}
          <button type="button" className="ws-icon-button" aria-label={tr('Mở tệp')} title={tr('Mở tệp')} onClick={onOpenFile}><Icon name="pencil" size={15} /></button>
          <button type="button" className="ws-icon-button" aria-label={tr('Đóng diff')} title={tr('Đóng diff')} onClick={onClose}><Icon name="close" size={15} /></button>
        </span>
      </header>
      {error && <p role="alert" className="ws-editor-loading error">{msgText(error)}</p>}
      {actionError && <p role="alert" className="ws-editor-loading error git-hunk-error">{msgText(actionError)}</p>}
      {rev === undefined && baseChoice === undefined && hunks.length > 0 && (
        <section className="git-hunk-bar" aria-label={tr('Các khối thay đổi')}>
          <header className="git-head">{tr('Các khối thay đổi')}</header>
          {hunks.map((hunk, i) => (
            <div className="git-row git-hunk-row" key={hunk.id}>
              <code className="mono git-hunk-header" title={hunk.header}>{hunk.header}</code>
              <button type="button" className="btn-action git-hunk-action" disabled={busy}
                aria-label={tr('{action} khối {index}: {header}', { action: staged ? tr('Bỏ stage') : 'Stage', index: i + 1, header: hunk.header })} onClick={() => void applyHunk(hunk.id)}>
                {staged ? tr('Bỏ stage khối') : tr('Stage khối')}
              </button>
            </div>
          ))}
        </section>
      )}
      <div ref={host} className="editor-host diff-host git-hunk-host" />
    </div>
  )
}
