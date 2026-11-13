import { useEffect, useState } from 'react'
import { vi } from './strings'
import type { EngineStatus } from '@shared/engine-status'
import type { ProjectSummary, ScanInfo } from '@shared/graph-types'
import { EngineStatusBar } from './components/EngineStatusBar'
import { LargeProjectScreen } from './screens/LargeProjectScreen'
import { IndexingScreen } from './screens/IndexingScreen'
import { ProjectOverviewScreen, type WorkspaceTab } from './screens/ProjectOverviewScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'

type Screen =
  | { name: 'projects' }
  | { name: 'scan'; project: ProjectSummary }
  | { name: 'large'; project: ProjectSummary; scan: ScanInfo }
  | { name: 'indexing'; project: ProjectSummary; subdir: string | null; exclude?: string[] }
  | { name: 'overview'; project: ProjectSummary }
  | { name: 'workspace'; project: ProjectSummary; tab?: WorkspaceTab }

/** Kiểm tra kích thước trước khi lập chỉ mục. Lỗi khi quét không chặn: coi như dự án không lớn. */
function ScanStep({ project, onDone }: { project: ProjectSummary; onDone: (scan: ScanInfo | null) => void }) {
  useEffect(() => {
    let alive = true
    window.nexgraph.index
      .scan(project.project_id)
      .then((s) => alive && onDone(s))
      .catch(() => alive && onDone(null))
    return () => {
      alive = false
    }
  }, [project.project_id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main className="screen">
      <p className="muted">{vi.large.scanning}</p>
    </main>
  )
}

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
        <ProjectsScreen engineReady={status.state === 'ready'}
          onOpened={(project) => setScreen(project.last_indexed_at ? { name: 'overview', project } : { name: 'scan', project })} />
      )}
      {screen.name === 'scan' && (
        <ScanStep
          project={screen.project}
          onDone={(scan) =>
            setScreen(scan?.large ? { name: 'large', project: screen.project, scan } : { name: 'indexing', project: screen.project, subdir: null })
          }
        />
      )}
      {screen.name === 'large' && (
        <LargeProjectScreen
          project={screen.project}
          scan={screen.scan}
          onChoose={(subdir) => setScreen({ name: 'indexing', project: screen.project, subdir })}
          onCancel={() => setScreen({ name: 'projects' })}
        />
      )}
      {screen.name === 'indexing' && (
        <IndexingScreen project={screen.project} subdir={screen.subdir} exclude={screen.exclude}
          onExplore={() => setScreen({ name: 'workspace', project: screen.project })} />
      )}
      {screen.name === 'overview' && (
        <ProjectOverviewScreen
          project={screen.project}
          onBack={() => setScreen({ name: 'projects' })}
          onOpenWorkspace={(tab) => setScreen({ name: 'workspace', project: screen.project, tab })}
          onReindex={({ exclude }) => setScreen({ name: 'indexing', project: screen.project, subdir: null, exclude })}
        />
      )}
      {screen.name === 'workspace' && (
        <WorkspaceScreen key={screen.tab ?? 'arch'} project={screen.project} initialTab={screen.tab}
          onBack={() => setScreen({ name: 'overview', project: { ...screen.project, last_indexed_at: screen.project.last_indexed_at ?? Math.floor(Date.now() / 1000) } })} />
      )}
      <EngineStatusBar status={status} onRestart={() => void window.nexgraph.engine.restart()} />
    </div>
  )
}
