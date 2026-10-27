import { useEffect, useState } from 'react'
import type { EngineStatus } from '@shared/engine-status'
import type { ProjectSummary } from '@shared/graph-types'
import { EngineStatusBar } from './components/EngineStatusBar'
import { IndexingScreen } from './screens/IndexingScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'

type Screen =
  | { name: 'projects' }
  | { name: 'indexing'; project: ProjectSummary }
  | { name: 'workspace'; project: ProjectSummary }

export default function App() {
  const [status, setStatus] = useState<EngineStatus>({ state: 'starting' })
  const [screen, setScreen] = useState<Screen>({ name: 'projects' })

  useEffect(() => {
    let alive = true
    void window.nexgraph.engine.status().then((s) => alive && setStatus(s))
    const off = window.nexgraph.engine.onStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])

  return (
    <div className="app">
      {screen.name === 'projects' && (
        <ProjectsScreen engineReady={status.state === 'ready'} onOpened={(project) => setScreen({ name: 'indexing', project })} />
      )}
      {screen.name === 'indexing' && (
        <IndexingScreen project={screen.project} onExplore={() => setScreen({ name: 'workspace', project: screen.project })} />
      )}
      {screen.name === 'workspace' && <WorkspaceScreen project={screen.project} />}
      <EngineStatusBar status={status} onRestart={() => void window.nexgraph.engine.restart()} />
    </div>
  )
}
