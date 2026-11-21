import { useEffect, useRef, useState } from 'react'
import { vi } from './strings'
import type { HostCommand } from '@shared/api'
import type { EngineStatus } from '@shared/engine-status'
import type { IndexOptions, ProjectSummary, ScanInfo } from '@shared/graph-types'
import { EngineStatusBar } from './components/EngineStatusBar'
import { WorkbenchBar } from './components/layout/WorkbenchBar'
import { Icon } from './components/common/icons'
import { CommandPaletteHost } from './components/layout/CommandPalette'
import { installKeymap, useCommand } from './state/commands'
import { setBlame, setVimMode, useBlame, useVimMode } from './state/editorPrefs'
import { loadExtensions } from './state/extensions'
import { LargeProjectScreen } from './screens/LargeProjectScreen'
import { IndexingScreen } from './screens/IndexingScreen'
import { ProjectOverviewScreen, type WorkspaceTab } from './screens/ProjectOverviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'
import { GlobalViewScreen } from './screens/GlobalViewScreen'

type Screen =
  | { name: 'projects' }
  | { name: 'scan'; project: ProjectSummary }
  | { name: 'large'; project: ProjectSummary; scan: ScanInfo }
  | { name: 'indexing'; project: ProjectSummary; subdir: string | null; options?: IndexOptions; rebuild?: boolean; exploring?: boolean; attempt?: number }
  | { name: 'overview'; project: ProjectSummary }
  | { name: 'workspace'; project: ProjectSummary; tab?: WorkspaceTab; initialCommand?: HostCommand }
  | { name: 'settings'; back: Screen; page?: string }
  | { name: 'global'; projectIds: string[] }

/** Kiểm tra kích thước trước khi lập chỉ mục. Lỗi khi quét không chặn: coi như dự án không lớn. */
function ScanStep({ project, onDone }: { project: ProjectSummary; onDone: (scan: ScanInfo | null) => void }) {
  useEffect(() => {
    const api = window.nexgraph
    if (!api) return
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
    <main className="screen task-screen" aria-busy="true">
      <div className="page-title">
        <span className="page-icon"><Icon name="folder" /></span>
        <div><h1>{project.name}</h1><p className="muted">{vi.large.scanning}</p></div>
      </div>
      <div className="task-panel" role="status" aria-label={vi.large.scanning}>
        <div className="bar indeterminate"><div className="bar-fill" /></div>
        <div className="skeleton-line" /><div className="skeleton-line short" />
      </div>
    </main>
  )
}

export default function App() {
  const [status, setStatus] = useState<EngineStatus>({ state: 'starting' })
  const [screen, setScreen] = useState<Screen>({ name: 'projects' })
  const initialHostCommand = useRef(window.nexgraph?.host?.initialCommand)
  const [hostError, setHostError] = useState<string | null>(null)

  useEffect(() => {
    const api = window.nexgraph
    if (!api) return
    let alive = true
    let eventReceived = false
    const off = api.engine.onStatus((status) => {
      eventReceived = true
      setStatus(status)
    })
    const failed = (e: unknown) => {
      if (alive && !eventReceived) setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
    void api.engine.status().then((s) => alive && !eventReceived && setStatus(s), failed)
    return () => {
      alive = false
      off()
    }
  }, [])

  // Chạy trong extension: thư mục do nền mở sẵn, bỏ qua bước chọn dự án.
  const hostFolder = window.nexgraph?.host?.folder
  useEffect(() => {
    if (hostFolder || initialHostCommand.current?.name !== 'settings') return
    initialHostCommand.current = undefined
    setScreen({ name: 'settings', back: { name: 'projects' } })
  }, [hostFolder])

  useEffect(() => {
    const api = window.nexgraph
    if (!api || !hostFolder || status.state !== 'ready' || screen.name !== 'projects') return
    let alive = true
    api.project.open(hostFolder)
      .then((project) => {
        if (!alive) return
        setHostError(null)
        const command = initialHostCommand.current
        const tab = api.host?.initialView as WorkspaceTab | undefined
        const hasGraph = project.last_indexed_at != null
        const base: Screen = hasGraph
          ? { name: 'workspace', project, tab, initialCommand: command?.name === 'settings' ? undefined : command }
          : { name: 'scan', project }
        if (hasGraph || command?.name === 'settings') initialHostCommand.current = undefined
        setScreen((current) => {
          if (current.name === 'settings') return { ...current, back: base }
          if (current.name !== 'projects') return current
          if (command?.name === 'settings') return { name: 'settings', back: base }
          if (command?.name === 'overview' && hasGraph) return { name: 'overview', project }
          return base
        })
      })
      .catch((error: { message?: string }) => { if (alive) setHostError(error?.message ?? String(error)) })
    return () => { alive = false }
  }, [hostFolder, status.state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lệnh chọn thẻ từ nền khi đang ở màn Tổng quan: vào không gian làm việc đúng thẻ đó.
  // Lệnh từ nền khi không ở không gian làm việc (màn đó tự xử lý lệnh của nó): chọn thẻ, mở Cài đặt, về Tổng quan.
  useEffect(() => window.nexgraph?.host?.onCommand((c, arg) => {
    if (screen.name === 'workspace' || (screen.name === 'indexing' && screen.exploring)) return
    const at = screen.name === 'settings' ? screen.back : screen // màn nằm dưới Cài đặt
    if (c === 'settings' && screen.name !== 'settings') setScreen({ name: 'settings', back: screen })
    else if (c === 'overview' && screen.name === 'settings') setScreen(screen.back)
    else if (c.startsWith('view:') && (at.name === 'overview' || at.name === 'workspace')) setScreen({ name: 'workspace', project: at.project, tab: c.slice(5) as WorkspaceTab })
    else if (c.startsWith('panel:') || c === 'export' || c === 'highlight' || c.startsWith('view:')) {
      if (at.name === 'overview' || at.name === 'workspace') setScreen({ name: 'workspace', project: at.project, initialCommand: { name: c, arg } })
      else initialHostCommand.current = { name: c, arg }
    }
  }), [screen])

  const indexing = screen.name === 'indexing' ? screen
    : screen.name === 'settings' && screen.back.name === 'indexing' ? screen.back
    : undefined

  const showCompletedGraph = (project: ProjectSummary, name: 'workspace' | 'overview') => {
    const pending = { ...project, last_indexed_at: null, last_index_commit: null }
    const command = initialHostCommand.current
    initialHostCommand.current = undefined
    setScreen(name === 'workspace' && command?.name !== 'overview'
      ? { name: 'workspace', project: pending, initialCommand: command } : { name: 'overview', project: pending })
    void window.nexgraph.project.list().then((projects) => {
      const latest = projects.find((p) => p.project_id === project.project_id && p.last_indexed_at != null)
      if (latest) setScreen((current) =>
        (current.name === 'workspace' || current.name === 'overview') && current.project === pending
          ? { ...current, project: latest } : current)
    }).catch(() => {}) // Tổng quan đọc thêm mốc lập chỉ mục từ số liệu đồ thị.
  }

  useEffect(() => (window.nexgraph?.host ? undefined : installKeymap()), [])
  useEffect(() => { if (!window.nexgraph?.host) void loadExtensions() }, [])
  // Màn làm việc tự gắn các lệnh này (có hỏi trước khi bỏ tệp chưa lưu); các màn khác dùng của App.
  const appCommands = !(screen.name === 'workspace' || (screen.name === 'indexing' && screen.exploring))
  const openSettings = (page?: string) => setScreen((s) => s.name === 'settings' ? { ...s, page } : { name: 'settings', back: s, page })
  useCommand('settings.open', () => openSettings(), appCommands)
  useCommand('keymap.open', () => openSettings('keymap'), appCommands)
  useCommand('projects.open', () => setScreen({ name: 'projects' }), appCommands && screen.name !== 'projects')
  const vimOn = useVimMode()
  useCommand('editor.toggle_vim', () => setVimMode(!vimOn))
  const blameOn = useBlame()
  useCommand('git.blame', () => setBlame(!blameOn))

  return (
    <div className="app">
      {!window.nexgraph?.host && <WorkbenchBar project={'project' in screen ? screen.project : null} />}
      {hostError && screen.name === 'projects' && <p role="alert" className="inline-message error">{hostError}</p>}
      {screen.name === 'projects' && (
        <ProjectsScreen engineReady={status.state === 'ready'}
          onOpenSettings={() => setScreen({ name: 'settings', back: screen })}
          onOpenGlobal={(projectIds) => setScreen({ name: 'global', projectIds })}
          onOpened={(project) => {
            setHostError(null)
            setScreen(project.last_indexed_at != null ? { name: 'workspace', project } : { name: 'scan', project })
          }} />
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
      {indexing && (
        <IndexingScreen key={indexing.attempt ?? 0} project={indexing.project} subdir={indexing.subdir} options={indexing.options}
          rebuild={indexing.rebuild} hidden={screen.name === 'settings'}
          onRetry={() => setScreen({ ...indexing, exploring: false, attempt: (indexing.attempt ?? 0) + 1 })}
          onExplore={() => showCompletedGraph(indexing.project, 'workspace')}
          onBack={(completed) => completed ? showCompletedGraph(indexing.project, 'overview')
            : setScreen(indexing.rebuild ? { name: 'overview', project: indexing.project } : { name: 'projects' })}
          onShowExisting={() => setScreen({ ...indexing, exploring: true })}
          renderExisting={indexing.exploring ? (notice) => (
            <WorkspaceScreen project={indexing.project} indexNotice={notice} backLabel={vi.indexing.backToProgress}
              onOpenSettings={(page) => setScreen({ name: 'settings', back: indexing, page })}
              onBack={() => setScreen({ ...indexing, exploring: false })} />
          ) : undefined} />
      )}
      {screen.name === 'overview' && (
        <ProjectOverviewScreen
          project={screen.project}
          onBack={() => setScreen({ name: 'projects' })}
          onOpenSettings={() => setScreen({ name: 'settings', back: screen })}
          onOpenWorkspace={(tab) => setScreen({ name: 'workspace', project: screen.project, tab })}
          onReindex={(options) => setScreen({ name: 'indexing', project: screen.project, subdir: null, options, rebuild: true })}
        />
      )}
      {screen.name === 'workspace' && (
        <WorkspaceScreen key={screen.tab ?? 'arch'} project={screen.project} initialTab={screen.tab} initialCommand={screen.initialCommand}
          onOpenSettings={(page) => setScreen({ name: 'settings', back: screen, page })}
          onBack={() => setScreen({ name: 'overview', project: screen.project })} />
      )}
      {screen.name === 'global' && <GlobalViewScreen projectIds={screen.projectIds} onBack={() => setScreen({ name: 'projects' })} />}
      {screen.name === 'settings' && <SettingsScreen key={screen.page ?? ''} initialPage={screen.page} onBack={() => setScreen(screen.back)} />}
      <EngineStatusBar status={status} onRestart={() => void window.nexgraph.engine.restart()} />
      {!window.nexgraph?.host && <CommandPaletteHost />}
    </div>
  )
}
