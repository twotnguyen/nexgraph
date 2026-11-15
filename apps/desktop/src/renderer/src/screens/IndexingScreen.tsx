import type { IndexOptions, ProjectSummary } from '@shared/graph-types'
import { useIndexJob } from '../state/useIndexJob'
import { vi } from '../strings'

interface Props {
  project: ProjectSummary
  subdir?: string | null
  options?: IndexOptions
  onExplore: () => void
  onBack?: () => void
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const isPreparing = max === 0
  return (
    <div className="phase">
      <div className="phase-head">
        <span>{label}</span>
        <span>{isPreparing ? vi.indexing.cleaning : `${value} / ${max}`}</span>
      </div>
      <div className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <div className="bar-fill" style={{ width: max > 0 ? `${Math.min(100, (value / max) * 100)}%` : '0%' }} />
      </div>
    </div>
  )
}

export function IndexingScreen({ project, subdir, options, onExplore, onBack }: Props) {
  const { job, error, cancel } = useIndexJob(project.project_id, subdir, options)
  const state = job?.state
  const phase1Done = state === 'resolve' || state === 'done'
  const running = state === 'queued' || state === 'structure' || state === 'resolve'
  const message = state === 'error' ? job?.message ?? '' : error

  return (
    <main className="screen">
      <h1>{state === 'done' ? vi.indexing.titleDone(project.name) : vi.indexing.title(project.name)}</h1>
      {subdir && <p className="muted">{vi.large.subdir(subdir)}</p>}
      {!job && !error && <p className="muted">{vi.indexing.preparing}</p>}
      {job && (
        <>
          <Bar label={vi.indexing.phase1} value={phase1Done ? job.files_total : job.files_done} max={job.files_total} />
          <div className="phase">
            <div className="phase-head">
              <span>{vi.indexing.phase2}</span>
              <span className="muted">{state === 'done' ? vi.indexing.done : phase1Done ? vi.indexing.phase2Hint : ''}</span>
            </div>
          </div>
        </>
      )}
      {state === 'cancelled' && <p className="muted">{vi.indexing.cancelled}</p>}
      {message && <p role="alert" className="error">{vi.indexing.error(message)}</p>}
      <div className="actions">
        {onBack && !running ? (
          <button type="button" onClick={onBack}>{vi.indexing.back}</button>
        ) : (
          <button type="button" disabled={!running} onClick={cancel}>{vi.indexing.cancel}</button>
        )}
        <button type="button" className="primary" disabled={!phase1Done} onClick={onExplore}>{vi.indexing.explore}</button>
      </div>
    </main>
  )
}
