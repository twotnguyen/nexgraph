import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@shared/graph-types'
import { GraphArt, Logo, type Tone } from '../components/common/icons'
import { vi } from '../strings'

const TONES: Tone[] = ['blue', 'teal', 'magenta', 'violet', 'green', 'amber']
const toneOf = (name: string) => TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length]

interface Props {
  engineReady: boolean
  onOpened: (p: ProjectSummary) => void
  onOpenSettings?: () => void
}

export function ProjectsScreen({ engineReady, onOpened, onOpenSettings }: Props) {
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
      <header className="hero">
        <GraphArt />
        <p className="brand"><Logo size={26} /> NexGraph</p>
        <h1>{vi.projects.title}</h1>
        <p className="lead">{vi.appTagline}</p>
        <div className="actions">
          <button type="button" className="primary" disabled={!engineReady} onClick={async () => open(await window.nexgraph.project.pickFolder())}>
            {vi.projects.open}
          </button>
          {onOpenSettings && <button type="button" className="link" onClick={onOpenSettings}>{vi.projects.settings}</button>}
        </div>
      </header>
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
                <span className="avatar" data-tone={toneOf(p.name)} aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
                <b>{p.name}</b> <span className="muted mono">{p.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
