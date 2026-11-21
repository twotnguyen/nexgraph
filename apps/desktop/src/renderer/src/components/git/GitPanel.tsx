import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { GitFileChange, GitStatus } from '@shared/api'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { Icon } from '../common/icons'
import './git-panel.css'

const message = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))
const LABEL: Record<string, string> = { M: 'Đã sửa', A: 'Thêm mới', D: 'Đã xoá', R: 'Đổi tên', C: 'Sao chép', U: 'Xung đột', '?': 'Chưa theo dõi' }

interface Props {
  projectId: string
  /** Mở diff của một tệp (đã stage: HEAD ↔ index; chưa: index ↔ đĩa). */
  onOpenDiff: (file: string, staged: boolean) => void
}

/** Git panel kiểu Wu: hai nhóm Đã stage / Thay đổi, mỗi hàng một tệp với nút stage/bỏ stage, ô commit ở đáy. */
export function GitPanel({ projectId, onOpenDiff }: Props) {
  const api = window.nexgraph.git
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    if (!api) return
    const ticket = ++seq.current
    try {
      const next = await api.status(projectId)
      if (ticket === seq.current) { setStatus(next); setError(null) }
    } catch (e) {
      if (ticket === seq.current) setError(message(e))
    }
  }, [api, projectId])

  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    const off = window.nexgraph.index.onEvent((event) => { if (event.type === 'changes_updated' && event.project_id === projectId) void refresh() })
    return () => { window.removeEventListener('focus', onFocus); off() }
  }, [refresh, projectId])

  const act = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    setNotice(null)
    try {
      await work()
      if (done) setNotice(done)
      setError(null)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
      void refresh()
    }
  }
  const stage = (files: string[]) => api && act(() => api.stage(projectId, files))
  const unstage = (files: string[]) => api && act(() => api.unstage(projectId, files))
  const canCommit = !!status?.staged.length && !!draft.trim() && !busy
  const commit = () => {
    if (!api || !canCommit) return
    void act(async () => {
      const sha = await api.commit(projectId, draft.trim())
      setDraft('')
      setNotice(`Đã commit ${sha}`)
    })
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); commit() }
  }

  if (!api) return <p className="git-empty muted">Git không dùng được ở chế độ này.</p>
  if (status && !status.repo) return <p className="git-empty muted">Thư mục dự án không nằm trong kho Git.</p>

  const row = (change: GitFileChange, staged: boolean) => {
    const cut = change.path.lastIndexOf('/') + 1
    return (
      <li key={`${staged ? 's' : 'u'}:${change.path}`} className="git-row">
        <button type="button" className="git-file" title={change.from ? `${change.from} → ${change.path}` : change.path} onClick={() => onOpenDiff(change.path, staged)}>
          <FileTypeIcon name={change.path} size={14} />
          <span className="git-name" data-status={change.status}>{change.path.slice(cut)}</span>
          <span className="git-dir muted">{change.path.slice(0, cut)}</span>
        </button>
        <span className="git-status" data-status={change.status} title={LABEL[change.status] ?? change.status}>{change.status === '?' ? 'U' : change.status}</span>
        <button type="button" className="git-icon" disabled={busy} aria-label={staged ? `Bỏ stage ${change.path}` : `Stage ${change.path}`}
          title={staged ? 'Bỏ stage' : 'Stage'} onClick={() => void (staged ? unstage([change.path]) : stage([change.path]))}>
          <Icon name={staged ? 'minus' : 'plus'} size={13} />
        </button>
      </li>
    )
  }

  const section = (title: string, list: GitFileChange[], staged: boolean) => list.length > 0 && (
    <section className="git-section" aria-label={title}>
      <header>
        <span>{title}</span><span className="git-count">{list.length}</span>
        <button type="button" className="git-link" disabled={busy} onClick={() => void (staged ? unstage(list.map((c) => c.path)) : stage(list.map((c) => c.path)))}>
          {staged ? 'Bỏ stage tất cả' : 'Stage tất cả'}
        </button>
      </header>
      <ul>{list.map((change) => row(change, staged))}</ul>
    </section>
  )

  return (
    <div className="git-panel">
      <div className="git-head">
        <Icon name="branch" size={14} /><span>{status?.branch ?? (status ? 'HEAD tách rời' : '…')}</span>
        <button type="button" className="git-icon" aria-label="Làm mới" title="Làm mới" onClick={() => void refresh()}><Icon name="refresh" size={13} /></button>
      </div>
      {error && <p role="alert" className="git-error">{error}</p>}
      <div className="git-list">
        {section('Đã stage', status?.staged ?? [], true)}
        {section('Thay đổi', status?.unstaged ?? [], false)}
        {status && !status.staged.length && !status.unstaged.length && <p className="git-empty muted">Không có thay đổi.</p>}
      </div>
      <div className="git-commit">
        <textarea aria-label="Thông điệp commit" placeholder="Thông điệp commit (⌘↩ để commit)" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
        <div className="git-commit-row">
          {notice && <span role="status" className="muted">{notice}</span>}
          <button type="button" className="primary" disabled={!canCommit} onClick={commit}>Commit{status?.staged.length ? ` ${status.staged.length} tệp` : ''}</button>
        </div>
      </div>
    </div>
  )
}
