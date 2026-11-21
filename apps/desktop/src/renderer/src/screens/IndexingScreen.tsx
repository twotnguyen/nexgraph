import type { ReactNode } from 'react'
import type { IndexOptions, ProjectSummary } from '@shared/graph-types'
import { useIndexJob } from '../state/useIndexJob'
import { Icon } from '../components/common/icons'
import { vi } from '../strings'
import './welcome.css'

interface Props {
  project: ProjectSummary
  subdir?: string | null
  options?: IndexOptions
  rebuild?: boolean
  onExplore: () => void
  onBack?: (completed: boolean) => void
  onShowExisting?: () => void
  onRetry?: () => void
  renderExisting?: (notice: string) => ReactNode
  hidden?: boolean
}

function Bar({ label, value, max, pending, hint }: { label: string; value?: number; max?: number; pending?: boolean; hint?: string }) {
  const determinate = !pending && (max ?? 0) > 0 && value !== undefined
  return (
    <div className="phase">
      <div className="phase-head">
        <strong>{label}</strong>
        <span className="muted">{hint ?? (determinate ? `${value} / ${max}` : undefined)}</span>
      </div>
      <div className={`bar${pending ? ' indeterminate' : ''}`} role="progressbar" aria-label={label}
        aria-valuetext={hint} aria-valuemin={determinate ? 0 : undefined} aria-valuemax={determinate ? max : undefined}
        aria-valuenow={determinate ? value : undefined}>
        <div className="bar-fill" style={determinate ? { width: `${Math.min(100, (value / (max ?? 1)) * 100)}%` } : undefined} />
      </div>
    </div>
  )
}

export function IndexingScreen({ project, subdir, options, rebuild, onExplore, onBack, onShowExisting, onRetry, renderExisting, hidden }: Props) {
  const { job, error, cancel } = useIndexJob(project.project_id, subdir, options)
  const state = job?.state
  const completed = state === 'done'
  const phase1Done = state === 'resolve' || completed
  const running = state === 'queued' || state === 'structure' || state === 'resolve'
  const preparing = !job && !error || state === 'queued'
  const message = state === 'error' ? job?.message || vi.indexing.failed : error
  const title = completed ? vi.indexing.titleDone(project.name)
    : state === 'cancelled' ? vi.indexing.titleCancelled(project.name)
    : state === 'error' ? vi.indexing.titleFailed(project.name)
    : !running && error ? vi.indexing.titleUnavailable(project.name)
    : vi.indexing.title(project.name)

  if (hidden) return null
  if (rebuild && renderExisting) {
    const notice = completed ? vi.indexing.newGraphReady
      : state === 'cancelled' ? `${vi.indexing.cancelled}. ${vi.indexing.existingGraph}`
      : state === 'error' ? `${vi.indexing.failed} ${vi.indexing.existingGraph}`
      : error && !running ? `${vi.indexing.unavailable} ${vi.indexing.existingGraph}`
      : vi.indexing.existingGraph
    return renderExisting(notice)
  }

  return (
    <main className="screen task-screen welcome-page indexing-wu">
      <div className="welcome">
      <header className="welcome-head">
        <span className="welcome-icon" data-done={completed || undefined} data-running={running || preparing || undefined}><Icon name={completed ? 'check' : 'refresh'} size={22} /></span>
        <div><h1>{title}</h1><p className="mono" title={project.path}>{subdir ? vi.large.subdir(subdir) : project.path}</p></div>
      </header>
      <section className="task-panel welcome-section" aria-label="Tiến độ lập chỉ mục" aria-busy={running || preparing}>
        <h2 className="welcome-section-title" aria-hidden="true">Tiến độ</h2>
        {!job && !error && <p role="status" className="muted">{vi.indexing.preparing}</p>}
        {(preparing || job && (running || completed)) && <>
          <Bar label={vi.indexing.phase1} value={phase1Done ? job?.files_total : job?.files_done}
            max={job?.files_total} pending={preparing}
            hint={preparing ? vi.indexing.preparingFiles : job?.files_total === 0 ? 'Không có tệp phù hợp' : undefined} />
          {job && state === 'structure' && (job.message || (!job.files_done && job.files_total > 0)) && (
            <p role="status" className="phase-note">{job.message || 'Đang phân tích những tệp đầu tiên…'}</p>
          )}
          {phase1Done ? (
            <Bar label={vi.indexing.phase2} value={completed ? 1 : undefined} max={1}
              pending={!completed} hint={completed ? vi.indexing.done : vi.indexing.phase2Hint} />
          ) : <div className="phase-head phase-next"><span>{vi.indexing.phase2}</span><span>Đang chờ</span></div>}
        </>}
        {message && <p role="alert" className="inline-message error">{vi.indexing.error(message)}</p>}
        {state === 'cancelled' && <p role="status" className="muted">Bạn có thể thử lại hoặc quay về dự án.</p>}
        {rebuild && !completed && <p role="status" className="inline-message">{vi.indexing.existingGraph}</p>}
      </section>
      <div className="actions">
        {onBack && !running && !preparing ? (
          <button type="button" onClick={() => onBack(completed)}>{vi.indexing.back}</button>
        ) : (
          <button type="button" disabled={!running} onClick={cancel}>{vi.indexing.cancel}</button>
        )}
        {rebuild && !completed && onShowExisting ? (
          <button type="button" className="primary" onClick={onShowExisting}>{vi.indexing.openExisting}</button>
        ) : (
          <button type="button" className="primary" disabled={!completed} onClick={onExplore}>{vi.indexing.explore}</button>
        )}
        {!running && !preparing && !completed && onRetry && <button type="button" onClick={onRetry}>Thử lại</button>}
      </div>
      </div>
    </main>
  )
}
