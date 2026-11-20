import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@shared/graph-types'
import { Icon } from '../common/icons'
import { vi } from '../../strings'

type Status = 'no_git' | 'off' | 'on' | 'outdated' | 'outside_repo'
const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

export function HookCard({ project }: { project: ProjectSummary }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => window.nexgraph.hook.status(project.project_id).then(setStatus).catch((e) => setError(errMessage(e)))
  useEffect(() => { void load() }, [project.project_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const openDialog = async () => {
    setError(null)
    try {
      setPreview(await window.nexgraph.hook.preview(project.project_id))
    } catch (e) {
      setError(errMessage(e))
    }
  }
  const apply = async (install: boolean) => {
    try {
      await (install ? window.nexgraph.hook.install(project.project_id) : window.nexgraph.hook.uninstall(project.project_id))
      setPreview(null)
      await load()
    } catch (e) {
      setError(errMessage(e))
    }
  }

  const label = status === 'no_git' ? vi.hook.noGit : status === 'outside_repo' ? vi.hook.outsideRepo : status === 'on' ? vi.hook.on : status === 'outdated' ? vi.hook.outdated : status === 'off' ? vi.hook.off : ''
  return (
    <>
      <button type="button" className="card" data-tone="green" disabled={status === 'no_git' || status === 'outside_repo' || status === null} onClick={() => void openDialog()}>
        <span className="card-icon"><Icon name="commit" /></span>
        <b>{vi.hook.card}</b>
        <span className="muted">{vi.hook.cardDesc}</span>
        <small className="card-status">{label}</small>
      </button>
      {error && <p role="alert" className="error">{error}</p>}
      {preview != null && (
        <div className="modal-backdrop">
          <div role="dialog" aria-label={vi.hook.title} className="modal">
            <header><h2>{vi.hook.title}</h2><button type="button" aria-label={vi.hook.close} onClick={() => setPreview(null)}>×</button></header>
            <p className="muted">{vi.hook.preview}</p>
            <pre className="mono">{preview}</pre>
            {status === 'outdated' && <p className="muted">{vi.hook.outdated}</p>}
            <div className="row">
              {status !== 'on' && <button type="button" className="primary" onClick={() => void apply(true)}>{vi.hook.install}</button>}
              {(status === 'on' || status === 'outdated') && <button type="button" onClick={() => void apply(false)}>{vi.hook.uninstall}</button>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
