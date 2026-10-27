import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@shared/graph-types'
import { vi } from '../strings'

interface Props {
  engineReady: boolean
  onOpened: (p: ProjectSummary) => void
}

export function ProjectsScreen({ engineReady, onOpened }: Props) {
  const [recent, setRecent] = useState<ProjectSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!engineReady) return
    let alive = true
    window.nexgraph.project.list().then((l) => alive && setRecent(l)).catch(() => {})
    return () => {
      alive = false
    }
  }, [engineReady])

  async function open(path: string | null) {
    if (!path) return // người dùng huỷ hộp thoại
    try {
      setError(null)
      onOpened(await window.nexgraph.project.open(path))
    } catch (err) {
      const code = (err as { code?: string }).code
      setError(code === 'bad_path' ? vi.projects.openFailed : (err as Error).message)
    }
  }

  return (
    <main className="screen">
      <h1>{vi.projects.title}</h1>
      <p className="muted">{vi.appTagline}</p>
      <button type="button" className="primary" disabled={!engineReady} onClick={async () => open(await window.nexgraph.project.pickFolder())}>
        {vi.projects.open}
      </button>
      {!engineReady && <p className="muted">{vi.projects.engineWaiting}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <h2>{vi.projects.recent}</h2>
      {recent.length === 0 ? (
        <p className="muted">{vi.projects.noRecent}</p>
      ) : (
        <ul className="recent">
          {recent.map((p) => (
            <li key={p.project_id}>
              <button type="button" disabled={!engineReady} onClick={() => open(p.path)}>
                <b>{p.name}</b> <span className="muted">{p.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
