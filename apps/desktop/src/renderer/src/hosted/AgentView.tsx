// View Trợ lý AI khi chạy trong extension (thanh bên phụ của nền): dùng lại nguyên AgentPanel, chỉ đổi nơi nó sống.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ProjectSummary } from '@shared/graph-types'
import { AgentPanel } from '../components/agent/AgentPanel'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '../styles.css'

function AgentView() {
  const host = window.nexgraph.host!
  const [folder, setFolder] = useState(host.folder)
  const [hidden, setHidden] = useState(false)
  const [opened, setOpened] = useState<{ folder: string; project: ProjectSummary } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => host.onCommand((name, arg) => {
    if (name === 'agent:visibility' && typeof arg === 'boolean') setHidden(!arg)
    if (name === 'agent:folder' && (typeof arg === 'string' || arg === null)) {
      setError(null)
      setFolder(arg)
    }
  }), [host])

  // Mở dự án ngay khi engine sẵn sàng (mở lại một dự án đã mở là vô hại).
  useEffect(() => {
    if (!folder) return
    let alive = true
    const open = (): void => {
      window.nexgraph.project.open(folder)
        .then((project) => alive && (setOpened({ folder, project }), setError(null)))
        .catch((e) => alive && setError((e as Error).message))
    }
    void window.nexgraph.engine.status().then((s) => s.state === 'ready' && open())
    const off = window.nexgraph.engine.onStatus((s) => s.state === 'ready' && open())
    return () => { alive = false; off() }
  }, [folder])

  if (!folder) return <p className="muted agent-wait">Mở một thư mục để dùng Trợ lý AI.</p>
  if (opened?.folder !== folder) return <p className="muted agent-wait">{error ?? 'Đang chờ engine…'}</p>
  const { project } = opened
  return (
    <AgentPanel projectId={project.project_id} projectName={project.name} hidden={hidden}
      onOpenCode={(file, line, lineEnd) => void host.openFile(file, line, lineEnd)}
      onHighlight={(nodes, edges, note) => void host.emit('highlight', { nodes, edges, note })}
      onOpenSettings={() => void host.emit('settings')} />
  )
}

document.documentElement.classList.add('agent-view')
createRoot(document.getElementById('root')!).render(<AgentView />)
