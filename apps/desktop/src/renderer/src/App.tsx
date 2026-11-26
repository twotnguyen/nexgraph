import { useEffect, useRef, useState } from 'react'
import { vi, tr } from './strings'
import { useLocale } from './state/locale'
import type { HostCommand } from '@shared/api'
import type { EngineStatus } from '@shared/engine-status'
import type { IndexOptions, ProjectSummary, ScanInfo } from '@shared/graph-types'
import { EngineStatusBar } from './components/EngineStatusBar'
import { notify } from './components/common/NotificationCenter'
import { errorText } from './state/errorText'
import { openFileFromMenu, registerFileMenuActions } from './state/fileMenuActions'
import { installAppMenuBridge } from './state/appMenuBridge'
import { WorkbenchBar } from './components/layout/WorkbenchBar'
import { Icon } from './components/common/icons'
import { CommandPaletteHost } from './components/layout/CommandPalette'
import { CommandsEnabled, installKeymap, useCommand } from './state/commands'
import { setBlame, setVimMode, useBlame, useVimMode } from './state/editorPrefs'
import { loadExtensions } from './state/extensions'
import { LargeProjectScreen } from './screens/LargeProjectScreen'
import { IndexingScreen } from './screens/IndexingScreen'
import { ProjectOverviewScreen, type WorkspaceTab } from './screens/ProjectOverviewScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { LicensesScreen } from './screens/LicensesScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'
import { GlobalViewScreen } from './screens/GlobalViewScreen'
import { errorMsg } from './state/errorText'
import { msgText, type Message } from './state/messages'

type Screen =
  | { name: 'projects' }
  | { name: 'scan'; project: ProjectSummary }
  | { name: 'large'; project: ProjectSummary; scan: ScanInfo }
  | { name: 'indexing'; project: ProjectSummary; subdir: string | null; options?: IndexOptions; rebuild?: boolean; exploring?: boolean; attempt?: number }
  | { name: 'overview'; project: ProjectSummary }
  | { name: 'workspace'; project: ProjectSummary; tab?: WorkspaceTab; initialCommand?: HostCommand }
  | { name: 'settings'; back: Screen; page?: string }
  | { name: 'licenses'; back: Screen }
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
  const locale = useLocale()
  const [status, setStatus] = useState<EngineStatus>({ state: 'starting' })
  const [screen, setScreen] = useState<Screen>({ name: 'projects' })
  const initialHostCommand = useRef(window.nexgraph?.host?.initialCommand)
  const [hostError, setHostError] = useState<Message | null>(null)

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
      if (alive && !eventReceived) setStatus({ state: 'error', message: msgText(errorMsg(e)), messageKey: undefined })
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
      .catch((error: unknown) => { if (alive) setHostError(errorMsg(error)) })
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
  const settingsOpen = screen.name === 'settings'
  const workspace = screen.name === 'workspace' ? screen
    : settingsOpen && !hostFolder && screen.back.name === 'workspace' ? screen.back
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

  // Vào một dự án vừa đăng ký (chọn ở danh sách hoặc mở worktree): đã lập chỉ mục thì vào thẳng không gian làm việc, chưa thì quét trước.
  const enterProject = (project: ProjectSummary) => {
    setHostError(null)
    setScreen(project.last_indexed_at != null ? { name: 'workspace', project } : { name: 'scan', project })
  }

  useEffect(() => installAppMenuBridge(), [])
  // Nhãn menu hệ thống do main dựng: gửi ngôn ngữ UI mỗi lần đổi để main dựng lại thanh menu.
  useEffect(() => {
    const api = window.nexgraph?.menu
    if (!api?.setLocale) return
    void api.setLocale(locale).catch(() => {})
  }, [locale])
  useEffect(() => (window.nexgraph?.host ? undefined : installKeymap()), [])
  useEffect(() => { if (!window.nexgraph?.host) void loadExtensions() }, [])
  useEffect(() => registerFileMenuActions({
    openProject: (path) => { void window.nexgraph.project.open(path).then(enterProject).catch((e) => notify(errorText(e))) }
  }), [])

  // Menu File: các lệnh cần hộp thoại/cửa sổ thuộc tầng App, không phụ thuộc màn đang mở.
  const desktop = !window.nexgraph?.host
  const activeProjectId = 'project' in screen ? screen.project.project_id : undefined
  useCommand('file.open', () => {
    const api = window.nexgraph.file
    if (!api?.pickOpen) { notify(tr('NexGraph chưa hỗ trợ tính năng này.')); return }
    void api.pickOpen(activeProjectId).then((picked) => {
      if (picked) openFileFromMenu(picked.path, picked.relative)
    }).catch((e) => notify(errorText(e)))
  }, desktop)
  useCommand('folder.open', () => {
    void window.nexgraph.project.pickFolder().then((path) => {
      if (path) return window.nexgraph.project.open(path).then(enterProject)
    }).catch((e) => notify(errorText(e)))
  }, desktop)
  useCommand('window.new', () => {
    void window.nexgraph.window?.openNew?.().catch((e) => notify(errorText(e)))
  }, desktop)
  useCommand('window.close', () => { window.close() }, desktop)
  // Khi Không gian làm việc hiện, màn đó tự đăng ký lệnh; Cài đặt vẫn mở được trang phím tắt.
  const appCommands = !(screen.name === 'workspace' || (screen.name === 'indexing' && screen.exploring))
  const openSettings = (page?: string) => setScreen((s) => s.name === 'settings' ? { ...s, page } : { name: 'settings', back: s, page })
  useCommand('settings.open', () => openSettings(), appCommands)
  useCommand('keymap.open', () => openSettings('keymap'), appCommands)
  // Menu Help → Giấy phép mã nguồn mở; mở được từ mọi màn, kể cả khi Không gian làm việc đang hiện.
  useCommand('licenses.open', () => setScreen((s) => (s.name === 'licenses' ? s : { name: 'licenses', back: s })))
  useCommand('projects.open', () => setScreen({ name: 'projects' }), appCommands && screen.name !== 'projects' && !workspace && !indexing?.exploring)
  const vimOn = useVimMode()
  useCommand('editor.toggle_vim', () => setVimMode(!vimOn))
  const blameOn = useBlame()
  useCommand('git.blame', () => setBlame(!blameOn))

  return (
    <div className="app">
      {!window.nexgraph?.host && <WorkbenchBar project={'project' in screen ? screen.project : null} />}
      {hostError && screen.name === 'projects' && <p role="alert" className="inline-message error">{msgText(hostError)}</p>}
      {screen.name === 'projects' && (
        <ProjectsScreen engineReady={status.state === 'ready'}
          onOpenSettings={() => setScreen({ name: 'settings', back: screen })}
          onOpenGlobal={(projectIds) => setScreen({ name: 'global', projectIds })}
          onOpened={enterProject} />
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
        <CommandsEnabled value={!settingsOpen}>
          <IndexingScreen key={indexing.attempt ?? 0} project={indexing.project} subdir={indexing.subdir} options={indexing.options}
            rebuild={indexing.rebuild} hidden={settingsOpen}
            onRetry={() => setScreen({ ...indexing, exploring: false, attempt: (indexing.attempt ?? 0) + 1 })}
            onExplore={() => showCompletedGraph(indexing.project, 'workspace')}
            onBack={(completed) => completed ? showCompletedGraph(indexing.project, 'overview')
              : setScreen(indexing.rebuild ? { name: 'overview', project: indexing.project } : { name: 'projects' })}
            onShowExisting={() => setScreen({ ...indexing, exploring: true })}
            renderExisting={indexing.exploring && (!settingsOpen || !hostFolder) ? (notice) => (
              <WorkspaceScreen project={indexing.project} hidden={settingsOpen} indexNotice={notice} backLabel={vi.indexing.backToProgress}
                onOpenSettings={(page) => setScreen({ name: 'settings', back: indexing, page })}
                onBack={() => setScreen({ ...indexing, exploring: false })} />
            ) : undefined} />
        </CommandsEnabled>
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
      {workspace && (
        <CommandsEnabled value={!settingsOpen}>
          <WorkspaceScreen key={`${workspace.project.project_id}:${workspace.tab ?? 'arch'}`} project={workspace.project} hidden={settingsOpen}
            initialTab={workspace.tab} initialCommand={workspace.initialCommand} onOpenSettings={openSettings} onOpenProject={enterProject}
            onOpenProjects={() => setScreen({ name: 'projects' })}
            onBack={() => setScreen({ name: 'overview', project: workspace.project })} />
        </CommandsEnabled>
      )}
      {screen.name === 'global' && <GlobalViewScreen projectIds={screen.projectIds} onBack={() => setScreen({ name: 'projects' })} />}
      {screen.name === 'licenses' && <LicensesScreen onBack={() => setScreen(screen.back)} />}
      {screen.name === 'settings' && <SettingsScreen key={screen.page ?? ''} initialPage={screen.page} onBack={() => setScreen(screen.back)}
        onOpenLicenses={() => setScreen({ name: 'licenses', back: screen })} />}
      <EngineStatusBar status={status} onRestart={() => void window.nexgraph.engine.restart()} />
      {!window.nexgraph?.host && <CommandPaletteHost />}
    </div>
  )
}
