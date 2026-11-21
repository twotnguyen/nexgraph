import { useEffect, useRef, useState } from 'react'
import type { GlobalMember, ProjectSummary } from '@shared/graph-types'
import { Icon, Logo } from '../components/common/icons'
import { Toast } from '../components/common/Toast'
import { waitJob } from '../state/waitJob'
import { formatDate } from '../state/locale'
import { vi, tr } from '../strings'
import './welcome.css'
import './projects.css'

interface Props {
  engineReady: boolean
  onOpened: (p: ProjectSummary) => void
  onOpenSettings?: () => void
  /** "Xem chung" của nhóm Graph chung (W8). */
  onOpenGlobal?: (projectIds: string[]) => void
}

function message(err: unknown) {
  const failure = err as { code?: string; message?: string } | null
  if (failure?.code === 'bad_path') return vi.projects.openFailed
  if (failure?.code === 'project_busy') return tr('Dự án đang cập nhật đồ thị. Đợi hoàn tất hoặc hủy lập chỉ mục rồi thử lại.')
  return failure?.message ?? String(err)
}

function RemoveProjectDialog({ project, busy, onCancel, onRemove }: {
  project: ProjectSummary
  busy: boolean
  onCancel: () => void
  onRemove: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = dialog.current
    if (!el || el.open) return
    if (typeof el.showModal === 'function') el.showModal()
    else el.open = true
  }, [])
  return (
    <dialog className="modal" ref={dialog} aria-labelledby="remove-project-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel() }}>
      <h2 id="remove-project-title">{tr('Gỡ dự án khỏi danh sách')}</h2>
      <p><strong>{project.name}</strong> {tr('sẽ biến mất khỏi danh sách dự án gần đây. Mã nguồn và đồ thị đã lưu vẫn được giữ để mở lại sau.')}</p>
      <footer>
        <button type="button" autoFocus disabled={busy} onClick={onCancel}>{tr('Hủy')}</button>
        <button type="button" className="danger" disabled={busy} onClick={onRemove}>{busy ? tr('Đang gỡ…') : tr('Gỡ dự án')}</button>
      </footer>
    </dialog>
  )
}

export function ProjectsScreen({ engineReady, onOpened, onOpenSettings, onOpenGlobal }: Props) {
  const [recent, setRecent] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [listError, setListError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<'open' | 'remove' | 'clone' | null>(null)
  const [removing, setRemoving] = useState<ProjectSummary | null>(null)
  const [cloneUrl, setCloneUrl] = useState<string | null>(null)
  const [cloneStatus, setCloneStatus] = useState<string | null>(null)
  const cloneJob = useRef<string | null>(null)
  const [members, setMembers] = useState<GlobalMember[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [membersVersion, setMembersVersion] = useState(0)
  const operation = useRef(false)
  const mounted = useRef(false)
  const openButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!engineReady) return
    let alive = true
    setLoading(true)
    setListError(null)
    void window.nexgraph.project.list().then(
      (projects) => { if (alive) setRecent(projects) },
      (err) => { if (alive) setListError(message(err)) }
    ).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [engineReady, refresh])

  useEffect(() => {
    if (!engineReady) return
    let alive = true
    void window.nexgraph.globalGraph.list().then((list) => { if (alive) setMembers(list) }, () => {})
    return () => { alive = false }
  }, [engineReady, refresh, membersVersion])

  function changeMembership(action: () => Promise<unknown>) {
    setError(null)
    void action().then(() => { if (mounted.current) setMembersVersion((v) => v + 1) },
      (err) => { if (mounted.current) setError(message(err)) })
  }

  const memberIds = new Set(members.map((m) => m.project_id))

  async function run(kind: 'open' | 'remove' | 'clone', action: () => Promise<void>) {
    if (operation.current || !engineReady) return
    operation.current = true
    setPending(kind)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      if (mounted.current) setError(message(err))
    } finally {
      operation.current = false
      if (mounted.current) setPending(null)
    }
  }

  function open(knownPath?: string) {
    void run('open', async () => {
      const path = knownPath ?? await window.nexgraph.project.pickFolder()
      if (!path || !mounted.current) return
      const project = await window.nexgraph.project.open(path)
      if (mounted.current) onOpened(project)
    })
  }

  function cloneFromUrl(url: string) {
    void run('clone', async () => {
      setCloneStatus(vi.sources.cloneRunning)
      try {
        const { jobId } = await window.nexgraph.sources.clone(url.trim())
        cloneJob.current = jobId
        const job = await waitJob(jobId, (j) => { if (mounted.current && j.message) setCloneStatus(j.message) })
        if (!mounted.current) return
        setCloneUrl(null)
        onOpened(job.result?.project as ProjectSummary)
      } finally {
        cloneJob.current = null
        if (mounted.current) setCloneStatus(null)
      }
    })
  }

  function remove(project: ProjectSummary) {
    void run('remove', async () => {
      try {
        await window.nexgraph.project.remove(project.project_id)
      } finally {
        if (mounted.current) setRemoving(null)
      }
      if (!mounted.current) return
      setRecent((projects) => projects.filter((item) => item.project_id !== project.project_id))
      setNotice(tr('Đã gỡ {name} khỏi danh sách gần đây.', { name: project.name }))
      window.requestAnimationFrame(() => openButton.current?.focus())
    })
  }

  return (
    <main className="screen projects-page projects-wu welcome-page">
      <div className="welcome">
      <header className="welcome-head">
        <Logo size={45} />
        <div>
          <h1>{recent.length ? tr('Chào mừng trở lại NexGraph') : tr('Chào mừng đến NexGraph')}</h1>
          <p>{tr('Biến mã nguồn thành đồ thị để khám phá kiến trúc, luồng và vùng ảnh hưởng')}</p>
        </div>
      </header>
      <section className="welcome-section" aria-labelledby="start-heading">
        <h2 id="start-heading" className="welcome-section-title">{tr('Bắt đầu')}</h2>
        <button ref={openButton} type="button" className="welcome-row" disabled={!engineReady || pending !== null} onClick={() => open()}>
          <Icon name="folder" size={14} /><span>{pending === 'open' ? tr('Đang mở…') : vi.projects.open}</span>
        </button>
        <button type="button" className="welcome-row" disabled={!engineReady || pending !== null} onClick={() => setCloneUrl((v) => v ?? '')}>
          <Icon name="download" size={14} /><span>{vi.sources.cloneOpen}</span>
        </button>
        {onOpenSettings && <button type="button" className="welcome-row" onClick={onOpenSettings}><Icon name="sliders" size={14} /><span>{vi.projects.settings}</span></button>}
        {cloneUrl !== null && (
          <form className="projects-clone" onSubmit={(e) => { e.preventDefault(); cloneFromUrl(cloneUrl) }}>
            <label>{vi.sources.cloneLabel}
              <input type="url" value={cloneUrl} placeholder={vi.sources.clonePlaceholder} disabled={pending === 'clone'}
                onChange={(e) => setCloneUrl(e.target.value)} autoFocus />
            </label>
            <p className="muted">{cloneStatus ?? vi.sources.cloneHint}</p>
            <div className="row">
              <button type="submit" className="primary" disabled={!engineReady || pending !== null || !cloneUrl.trim()}>{vi.sources.cloneSubmit}</button>
              {pending === 'clone'
                ? <button type="button" onClick={() => { if (cloneJob.current) void window.nexgraph.index.cancel(cloneJob.current) }}>{vi.sources.cancel}</button>
                : <button type="button" onClick={() => setCloneUrl(null)}>{vi.sources.close}</button>}
            </div>
          </form>
        )}
      </section>
      {!engineReady && <p role="status" className="inline-message">{vi.projects.engineWaiting}</p>}
      {error && <p role="alert" className="inline-message error">{error}</p>}
      {notice && <Toast message={notice} onDismiss={() => setNotice(null)} />}

      <section className="welcome-section" aria-labelledby="recent-heading" aria-busy={engineReady && loading}>
        <h2 id="recent-heading" className="welcome-section-title">{vi.projects.recent}</h2>
        {engineReady && loading && <div className="panel-empty"><div className="skeleton-line" /><div className="skeleton-line short" /></div>}
        {listError && (
          <div className="panel-empty"><p role="alert" className="error">{listError}</p>
            <button type="button" disabled={pending !== null} onClick={() => setRefresh((v) => v + 1)}>{tr('Tải lại danh sách')}</button>
          </div>
        )}
        {recent.length === 0 && !listError && !(engineReady && loading) && <p className="panel-empty muted">{vi.projects.noRecent}</p>}
        {recent.length > 0 && (
          <ul className="recent">
            {recent.map((project) => {
              const date = project.last_indexed_at != null ? new Date(project.last_indexed_at * 1000) : null
              return (
                <li className="projects-recent-row" key={project.project_id}>
                  <button className="welcome-row recent-open" type="button" disabled={!engineReady || pending !== null} onClick={() => open(project.path)} title={project.path}>
                    <Icon name="folder" size={14} />
                    <span className="recent-identity"><b>{project.name}</b><span className="muted mono">{project.path}</span></span>
                    <span className="projects-recent-date">
                      {date ? <time dateTime={date.toISOString()}>{formatDate(date, { dateStyle: 'medium' })}</time> : tr('Chưa lập chỉ mục')}
                    </span>
                  </button>
                  {!memberIds.has(project.project_id) && (
                    <button type="button" className="icon-button recent-remove recent-join" title={vi.globalGraph.addTo(project.name)}
                      aria-label={vi.globalGraph.addTo(project.name)} disabled={!engineReady || pending !== null}
                      onClick={() => changeMembership(() => window.nexgraph.globalGraph.add(project.project_id))}><Icon name="graph" size={16} /></button>
                  )}
                  <button type="button" className="icon-button recent-remove" title={tr('Gỡ khỏi danh sách')}
                    aria-label={tr('Gỡ {name} khỏi danh sách', { name: project.name })} disabled={!engineReady || loading || pending !== null}
                    onClick={() => setRemoving(project)}><Icon name="close" size={16} /></button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <section className="welcome-section" aria-labelledby="global-heading">
        <h2 id="global-heading" className="welcome-section-title">{vi.globalGraph.title}</h2>
        <div className="welcome-global-bar">
          <p className="muted">{members.length ? vi.globalGraph.hint : vi.globalGraph.empty}</p>
          <button type="button" className="primary" disabled={!engineReady || picked.length < 2 || !onOpenGlobal}
            title={vi.globalGraph.viewHint} onClick={() => onOpenGlobal?.(picked)}>
            <Icon name="graph" size={14} /> {vi.globalGraph.view}
          </button>
        </div>
        {members.length > 0 && (
          <ul className="recent">
            {members.map((m) => {
              const name = m.name ?? m.project_id
              return (
                <li key={m.project_id}>
                  <label className="welcome-row recent-open global-member">
                    <input type="checkbox" aria-label={m.available ? name : `${name}: ${vi.globalGraph.unavailable}`} disabled={!m.available} checked={picked.includes(m.project_id)}
                      onChange={(e) => setPicked((ids) => e.target.checked ? [...ids, m.project_id] : ids.filter((id) => id !== m.project_id))} />
                    <span className="recent-identity"><b>{name}</b>
                      {!m.available ? <span className="muted">{vi.globalGraph.unavailable}</span>
                        : m.path && <span className="muted mono" title={m.path}>{m.path}</span>}
                    </span>
                  </label>
                  <button type="button" className="icon-button recent-remove" title={vi.globalGraph.removeFrom(name)}
                    aria-label={vi.globalGraph.removeFrom(name)} disabled={!engineReady}
                    onClick={() => {
                      setPicked((ids) => ids.filter((id) => id !== m.project_id))
                      changeMembership(() => window.nexgraph.globalGraph.remove(m.project_id))
                    }}><Icon name="close" size={16} /></button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      </div>
      {removing && <RemoveProjectDialog project={removing} busy={pending === 'remove'} onCancel={() => setRemoving(null)}
        onRemove={() => remove(removing)} />}
    </main>
  )
}
