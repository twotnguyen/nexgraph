import type { ReactNode } from 'react'
import type { IndexOptions, ProjectSummary } from '@shared/graph-types'
import { useIndexJob } from '../state/useIndexJob'
import { vi } from '../strings'

interface Props {
  project: ProjectSummary
  subdir?: string | null
  options?: IndexOptions
  rebuild?: boolean
  onExplore: () => void
  onBack?: (completed: boolean) => void
  onShowExisting?: () => void
  renderExisting?: (notice: string) => ReactNode
  hidden?: boolean
}

function Bar({ label, value, max, preparing }: { label: string; value: number; max: number; preparing: boolean }) {
  return (
    <div className="phase">
      <div className="phase-head">
        <span>{label}</span>
        <span>{preparing ? vi.indexing.preparingFiles : `${value} / ${max}`}</span>
      </div>
      <div className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="bar-fill" style={{ width: max > 0 ? `${Math.min(100, (value / max) * 100)}%` : '0%' }} />
      </div>
    </div>
  )
}

export function IndexingScreen({ project, subdir, options, rebuild, onExplore, onBack, onShowExisting, renderExisting, hidden }: Props) {
  const { job, error, cancel } = useIndexJob(project.project_id, subdir, options)
  const state = job?.state
  const completed = state === 'done'
  const phase1Done = state === 'resolve' || completed
  const running = state === 'queued' || state === 'structure' || state === 'resolve'
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
    <main className="screen">
      <h1>{title}</h1>
      {subdir && <p className="muted">{vi.large.subdir(subdir)}</p>}
      {!job && !error && <p className="muted">{vi.indexing.preparing}</p>}
      {job && (running || completed) && (
        <>
          <Bar label={vi.indexing.phase1} value={phase1Done ? job.files_total : job.files_done}
            max={job.files_total} preparing={state === 'queued'} />
          <div className="phase">
            <div className="phase-head">
              <span>{vi.indexing.phase2}</span>
              <span className="muted">{completed ? vi.indexing.done : phase1Done ? vi.indexing.phase2Hint : ''}</span>
            </div>
          </div>
        </>
      )}
      {message && <p role="alert" className="error">{vi.indexing.error(message)}</p>}
      {rebuild && !completed && <p role="status" className="muted">{vi.indexing.existingGraph}</p>}
      <div className="actions">
        {onBack && !running ? (
          <button type="button" onClick={() => onBack(completed)}>{vi.indexing.back}</button>
        ) : (
          <button type="button" disabled={!running} onClick={cancel}>{vi.indexing.cancel}</button>
        )}
        {rebuild && !completed && onShowExisting ? (
          <button type="button" className="primary" onClick={onShowExisting}>{vi.indexing.openExisting}</button>
        ) : (
          <button type="button" className="primary" disabled={!completed} onClick={onExplore}>{vi.indexing.explore}</button>
        )}
      </div>
    </main>
  )
}
