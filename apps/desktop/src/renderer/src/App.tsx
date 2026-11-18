import { useEffect, useState } from 'react'
import { vi } from './strings'
import type { EngineStatus } from '@shared/engine-status'
import type { IndexOptions, ProjectSummary, ScanInfo } from '@shared/graph-types'
import { EngineStatusBar } from './components/EngineStatusBar'
import { LargeProjectScreen } from './screens/LargeProjectScreen'
import { IndexingScreen } from './screens/IndexingScreen'
import { ProjectOverviewScreen, type WorkspaceTab } from './screens/ProjectOverviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'

type Screen =
  | { name: 'projects' }
  | { name: 'scan'; project: ProjectSummary }
  | { name: 'large'; project: ProjectSummary; scan: ScanInfo }
  | { name: 'indexing'; project: ProjectSummary; subdir: string | null; options?: IndexOptions }
  | { name: 'overview'; project: ProjectSummary }
  | { name: 'workspace'; project: ProjectSummary; tab?: WorkspaceTab }
  | { name: 'settings'; back: Screen }

/** Kiểm tra kích thước trước khi lập chỉ mục. Lỗi khi quét không chặn: coi như dự án không lớn. */
function ScanStep({ project, onDone }: { project: ProjectSummary; onDone: (scan: ScanInfo | null) => void }) {
  useEffect(() => {
    const api = window.nexgraph
    if (!api) return // preload chưa kịp inject (dev reload): không crash, chờ lần render sau
    let alive = true
    api.index
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
    const api = window.nexgraph
    if (!api) return // preload chưa kịp inject (dev reload): đợi, không crash renderer
    let alive = true
    void api.engine.status().then((s) => alive && setStatus(s))
    const off = api.engine.onStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])

  // Chạy trong extension: thư mục do nền mở sẵn, bỏ qua bước chọn dự án.
  const hostFolder = window.nexgraph?.host?.folder
  useEffect(() => {
    const api = window.nexgraph
    if (!api || !hostFolder || status.state !== 'ready' || screen.name !== 'projects') return
    let alive = true
    api.project.open(hostFolder)
      .then((project) => alive && setScreen(project.last_indexed_at ? { name: 'workspace', project, tab: api.host?.initialView as WorkspaceTab | undefined } : { name: 'scan', project }))
      .catch(() => {}) // lỗi mở: ở lại màn Dự án để người dùng thấy và thử lại
    return () => { alive = false }
  }, [hostFolder, status.state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lệnh chọn thẻ từ nền khi đang ở màn Tổng quan: vào không gian làm việc đúng thẻ đó.
  // Lệnh từ nền khi không ở không gian làm việc (màn đó tự xử lý lệnh của nó): chọn thẻ, mở Cài đặt, về Tổng quan.
  useEffect(() => window.nexgraph?.host?.onCommand((c) => {
    if (screen.name === 'workspace') return
    const at = screen.name === 'settings' ? screen.back : screen // màn nằm dưới Cài đặt
    if (c === 'settings' && screen.name !== 'settings') setScreen({ name: 'settings', back: screen })
    else if (c === 'overview' && screen.name === 'settings') setScreen(screen.back)
    else if (c.startsWith('view:') && (at.name === 'overview' || at.name === 'workspace')) setScreen({ name: 'workspace', project: at.project, tab: c.slice(5) as WorkspaceTab })
  }), [screen])

  return (
    <div className="app">
      {screen.name === 'projects' && (
        <ProjectsScreen engineReady={status.state === 'ready'}
          onOpenSettings={() => setScreen({ name: 'settings', back: screen })}
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
        <IndexingScreen project={screen.project} subdir={screen.subdir} options={screen.options}
          onExplore={() => setScreen({ name: 'workspace', project: screen.project })}
          onBack={() => setScreen(screen.project.last_indexed_at ? { name: 'overview', project: screen.project } : { name: 'projects' })} />
      )}
      {screen.name === 'overview' && (
        <ProjectOverviewScreen
          project={screen.project}
          onBack={() => setScreen({ name: 'projects' })}
          onOpenSettings={() => setScreen({ name: 'settings', back: screen })}
          onOpenWorkspace={(tab) => setScreen({ name: 'workspace', project: screen.project, tab })}
          onReindex={(options) => setScreen({ name: 'indexing', project: screen.project, subdir: null, options })}
        />
      )}
      {screen.name === 'workspace' && (
        <WorkspaceScreen key={screen.tab ?? 'arch'} project={screen.project} initialTab={screen.tab}
          onOpenSettings={() => setScreen({ name: 'settings', back: screen })}
          onBack={() => setScreen({ name: 'overview', project: { ...screen.project, last_indexed_at: screen.project.last_indexed_at ?? Math.floor(Date.now() / 1000) } })} />
      )}
      {screen.name === 'settings' && <SettingsScreen onBack={() => setScreen(screen.back)} />}
      <EngineStatusBar status={status} onRestart={() => void window.nexgraph.engine.restart()} />
    </div>
  )
}
