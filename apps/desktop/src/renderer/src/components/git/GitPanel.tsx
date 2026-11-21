import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { GitFileChange, GitStatus } from '@shared/api'
import { consentTargetForSettings, sameConsentTarget } from '@shared/agent-types'
import { errorText } from '../../state/errorText'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { Icon } from '../common/icons'
import { PopoverMenu } from '../common/PopoverMenu'
import { BranchPicker } from './BranchPicker'
import { GitHistory } from './GitHistory'
import { StashSection } from './StashSection'
import './git-panel.css'

const LABEL: Record<string, string> = { M: 'Đã sửa', A: 'Thêm mới', D: 'Đã xoá', R: 'Đổi tên', C: 'Sao chép', U: 'Xung đột', '?': 'Chưa theo dõi' }

interface Props {
  projectId: string
  onOpenDiff: (file: string, staged: boolean, rev?: string, from?: string) => void
  onOpenFile: (file: string) => void
}

/** Git panel: thay đổi, lịch sử và các thao tác trên nhánh hiện tại. */
export function GitPanel({ projectId, onOpenDiff, onOpenFile }: Props) {
  const api = window.nexgraph.git
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [tab, setTab] = useState<'changes' | 'history'>('changes')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [draft, setDraft] = useState('')
  const [amend, setAmend] = useState(false)
  const [showBranches, setShowBranches] = useState(false)
  const [showStashes, setShowStashes] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const seq = useRef(0)

  const refresh = useCallback(async () => {
    if (!api) return
    const ticket = ++seq.current
    try {
      const next = await api.status(projectId)
      if (ticket === seq.current) setStatus(next)
    } catch (error) {
      if (ticket === seq.current) setNotice({ text: errorText(error), error: true })
    }
  }, [api, projectId])

  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    const onGitChanged = (event: Event) => {
      if ((event as CustomEvent<string>).detail === projectId) void refresh()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('nexgraph:git-changed', onGitChanged)
    const off = window.nexgraph.index.onEvent((event) => { if (event.type === 'changes_updated' && event.project_id === projectId) void refresh() })
    return () => { seq.current++; window.removeEventListener('focus', onFocus); window.removeEventListener('nexgraph:git-changed', onGitChanged); off() }
  }, [refresh, projectId])

  const changed = () => window.dispatchEvent(new CustomEvent('nexgraph:git-changed', { detail: projectId }))
  const act = async (work: () => Promise<unknown>, success?: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setNotice(null)
    try {
      const result = await work()
      if (success) setNotice({ text: typeof result === 'string' && result.trim() ? `${success}\n${result.trim()}` : success })
      changed()
    } catch (error) {
      setNotice({ text: errorText(error), error: true })
    } finally {
      busyRef.current = false
      setBusy(false)
      void refresh()
    }
  }
  const stage = (files: string[]) => api && files.length && act(() => api.stage(projectId, files))
  const unstage = (files: string[]) => api && files.length && act(() => api.unstage(projectId, files))
  const allStaged = status?.staged.map((c) => c.path) ?? []
  const allUnstaged = status?.unstaged.map((c) => c.path) ?? []
  const canCommit = !!draft.trim() && !busy && !!status && !status.conflicts.length && (amend ? !!status.lastCommit && !status.lastCommit.pushed : !!status.staged.length)
  const commit = () => {
    if (!api || !canCommit) return
    if (amend && !window.confirm('Amend sẽ thay commit cuối trên máy này và không tự push. Nhánh remote đã biết sẽ được kiểm tra trước khi thực hiện. Tiếp tục?')) return
    void act(async () => {
      const sha = await api.commit(projectId, draft.trim(), amend)
      setDraft('')
      setAmend(false)
      setNotice({ text: `Đã ${amend ? 'amend' : 'commit'} ${sha}` })
    })
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); commit() }
  }
  const suggest = () => {
    if (!api || !status?.staged.length) return
    const initialDraft = draft
    if (initialDraft.trim() && !window.confirm('Viết lại thông điệp commit hiện tại bằng AI?')) return
    void act(async () => {
      const settings = await window.nexgraph.ai.getSettings()
      const target = consentTargetForSettings(settings)
      if (!target || settings.runtime === 'antigravity-cli') throw new Error('Hãy chọn model Pi trong Cài đặt để viết thông điệp commit.')
      if (!await window.nexgraph.ai.hasConsent(projectId, target)) {
        const destination = target.baseUrl ? `\n${target.baseUrl}` : ''
        if (!window.confirm(`Gửi diff đã stage của dự án tới ${target.provider} / ${settings.model}${destination} để viết thông điệp commit?`)) return
        const current = await window.nexgraph.ai.getSettings()
        if (!sameConsentTarget(target, consentTargetForSettings(current)) || current.model !== settings.model) throw new Error('Nhà cung cấp AI đã thay đổi. Hãy thử lại.')
        await window.nexgraph.ai.grantConsent(projectId, target)
      }
      const result = await api.suggestMessage(projectId)
      setDraft((current) => current === initialDraft ? result : current)
    })
  }
  const remote = (op: 'fetch' | 'pull' | 'push') => {
    if (api) void act(() => api.remote(projectId, op), `Git ${op} thành công`)
  }

  if (!api) return <p className="git-empty muted">Git không dùng được ở chế độ này.</p>
  if (status && !status.repo) return <p className="git-empty muted">Thư mục dự án không nằm trong kho Git.</p>

  const row = (change: GitFileChange, staged: boolean, conflict = false) => {
    const cut = change.path.lastIndexOf('/') + 1
    const restore = () => {
      const question = change.status === '?' ? `Chuyển “${change.path}” vào Thùng rác?` : `Bỏ thay đổi chưa stage của “${change.path}”?`
      if (window.confirm(question)) void act(() => api.restore(projectId, change.path))
    }
    return <li key={`${conflict ? 'c' : staged ? 's' : 'u'}:${change.path}`} className="git-row">
      <button type="button" className="git-file" title={change.from ? `${change.from} → ${change.path}` : change.path}
        onClick={() => conflict ? onOpenFile(change.path) : onOpenDiff(change.path, staged)}>
        <FileTypeIcon name={change.path} size={14} />
        <span className="git-name" data-status={change.status}>{change.path.slice(cut)}</span>
        <span className="git-dir muted">{change.path.slice(0, cut)}</span>
      </button>
      {change.added != null && <span className="git-added">+{change.added}</span>}
      {change.deleted != null && <span className="git-deleted">−{change.deleted}</span>}
      {!conflict && !staged && <button type="button" className="git-icon" disabled={busy} aria-label={`Bỏ thay đổi ${change.path}`} title={change.status === '?' ? 'Chuyển vào Thùng rác' : 'Bỏ thay đổi'} onClick={restore}><Icon name="trash" size={13} /></button>}
      <span className="git-status" data-status={conflict ? 'U' : change.status} title={conflict ? 'Xung đột' : LABEL[change.status] ?? change.status}>{conflict ? 'U' : change.status === '?' ? 'U' : change.status}</span>
      <input type="checkbox" checked={staged} disabled={busy} aria-label={conflict ? `Đánh dấu ${change.path} đã giải quyết` : staged ? `Bỏ stage ${change.path}` : `Stage ${change.path}`}
        onChange={() => { if (conflict && !window.confirm(`Đánh dấu “${change.path}” đã giải quyết? Hãy lưu và xoá mọi dấu xung đột trước.`)) return; void (staged ? unstage([change.path]) : stage([change.path])) }} />
    </li>
  }
  const section = (title: string, list: GitFileChange[], staged: boolean, conflict = false) => list.length > 0 && <section className="git-section" aria-label={title}>
    <header><span>{title}</span><span className="git-count">{list.length}</span>
      {!conflict && <button type="button" className="git-link" disabled={busy} onClick={() => void (staged ? unstage(list.map((c) => c.path)) : stage(list.map((c) => c.path)))}>{staged ? 'Bỏ stage tất cả' : 'Stage tất cả'}</button>}
    </header>
    <ul>{list.map((change) => row(change, staged, conflict))}</ul>
  </section>
  const files = [...(status?.staged ?? []), ...(status?.unstaged ?? [])]
  const added = files.reduce((n, change) => n + (change.added ?? 0), 0)
  const deleted = files.reduce((n, change) => n + (change.deleted ?? 0), 0)
  const count = new Set([...files, ...(status?.conflicts ?? [])].map((c) => c.path)).size
  const primaryRemote = status?.upstream ? (status.behind > 0 ? 'pull' : status.ahead > 0 ? 'push' : 'fetch') : 'push'

  return <div className="git-panel">
    <div className="git-tabs" role="tablist" aria-label="Git">
      <button type="button" role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>Thay đổi{count ? ` (${count})` : ''}</button>
      <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>Lịch sử</button>
    </div>
    {tab === 'history' ? <GitHistory projectId={projectId} onOpenDiff={onOpenDiff} /> : <>
      <div className="git-toolbar">
        <span className="git-summary">± <span className="git-added">+{added}</span> <span className="git-deleted">−{deleted}</span></span>
        <div className="git-split">
          <button type="button" disabled={busy || (!allUnstaged.length && !allStaged.length)} onClick={() => void (allUnstaged.length ? stage(allUnstaged) : unstage(allStaged))}>{allUnstaged.length ? 'Stage tất cả' : 'Bỏ stage tất cả'}</button>
          <PopoverMenu label="Tác vụ thay đổi" trigger={<Icon name="chevron" size={12} />} buttonClass="git-chevron" items={[
            { label: 'Làm mới', icon: 'refresh', onSelect: () => void refresh() },
            { label: 'Stage tất cả', icon: 'plus', disabled: busy || !allUnstaged.length, onSelect: () => void stage(allUnstaged) },
            { label: 'Bỏ stage tất cả', icon: 'minus', disabled: busy || !allStaged.length, onSelect: () => void unstage(allStaged) },
            { label: showStashes ? 'Ẩn stash' : 'Xem stash', icon: 'history', onSelect: () => setShowStashes((v) => !v) }
          ]} />
        </div>
      </div>
      <div className="git-list">
        {section('Xung đột', status?.conflicts ?? [], false, true)}
        {section('Đã stage', status?.staged ?? [], true)}
        {section('Thay đổi', status?.unstaged ?? [], false)}
        {status && !count && <p className="git-empty muted">Không có thay đổi.</p>}
        {showStashes && <StashSection projectId={projectId} onChanged={() => void refresh()} />}
      </div>
      <div className="git-bottom">
        <div className="git-branch-row">
          <button type="button" className="git-branch" disabled={busy} title="Chọn nhánh" onClick={() => setShowBranches(true)}><Icon name="branch" size={13} /><span>{status?.branch ?? (status ? 'HEAD tách rời' : '…')}</span></button>
          <div className="git-split git-remote">
            <button type="button" disabled={busy} onClick={() => remote(primaryRemote)}>{status?.behind ? `↓${status.behind} ` : ''}{status?.ahead ? `↑${status.ahead} ` : ''}{primaryRemote === 'pull' ? 'Pull' : primaryRemote === 'fetch' ? 'Fetch' : status?.upstream ? 'Push' : 'Publish'}</button>
            <PopoverMenu label="Tác vụ remote" trigger={<Icon name="chevron" size={12} />} buttonClass="git-chevron" items={[
              { label: 'Fetch', icon: 'refresh', disabled: busy, onSelect: () => remote('fetch') },
              { label: 'Pull', icon: 'download', disabled: busy, onSelect: () => remote('pull') },
              { label: 'Push', icon: 'send', disabled: busy, onSelect: () => remote('push') }
            ]} />
          </div>
        </div>
        <div className="git-commit">
          <textarea aria-label="Thông điệp commit" placeholder="Thông điệp commit (⌘↩ để commit)" rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey} />
          <div className="git-commit-row">
            <button type="button" className="git-icon" disabled={busy || !status?.staged.length} aria-label="Viết thông điệp commit" title="Viết thông điệp commit bằng AI từ diff đã stage" onClick={suggest}><Icon name="spark" size={14} /></button>
            <div className="git-split">
              <button type="button" disabled={!canCommit} onClick={commit}>{amend ? 'Amend' : 'Commit'}{status?.staged.length ? ` ${status.staged.length} tệp` : ''}</button>
              <PopoverMenu label="Tuỳ chọn commit" trigger={<Icon name="chevron" size={12} />} buttonClass="git-chevron" className="git-popover-up" items={[
                { label: amend ? 'Commit' : 'Amend', icon: 'commit', disabled: busy || (!amend && (!status?.lastCommit || status.lastCommit.pushed)), onSelect: () => { if (!amend && !draft.trim()) setDraft(status?.lastCommit?.message ?? ''); setAmend(!amend) } }
              ]} />
            </div>
          </div>
        </div>
        {status?.lastCommit && <div className="git-last-commit"><button type="button" title="Xem lịch sử" onClick={() => setTab('history')}>{status.lastCommit.subject}</button>
        </div>}
      </div>
    </>}
    {showBranches && <BranchPicker projectId={projectId} onClose={() => setShowBranches(false)} onChanged={() => void refresh()} />}
    {notice && <div className={`git-toast${notice.error ? ' git-toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button type="button" className="git-icon" aria-label="Đóng thông báo Git" onClick={() => setNotice(null)}><Icon name="close" size={13} /></button></div>}
  </div>
}
