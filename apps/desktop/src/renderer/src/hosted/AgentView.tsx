// View Trợ lý AI khi chạy trong extension (thanh bên phụ của nền): dùng lại nguyên AgentPanel, chỉ đổi nơi nó sống.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentPanel } from '../components/agent/AgentPanel'
import '@fontsource/be-vietnam-pro/400.css'
import '@fontsource/be-vietnam-pro/500.css'
import '@fontsource/be-vietnam-pro/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '../styles.css'

function AgentView() {
  const host = window.nexgraph.host!
  const [projectId, setProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Mở dự án ngay khi engine sẵn sàng (mở lại một dự án đã mở là vô hại).
  useEffect(() => {
    let alive = true
    const open = (): void => {
      if (!host.folder) return
      window.nexgraph.project.open(host.folder)
        .then((p) => alive && (setProjectId(p.project_id), setError(null)))
        .catch((e) => alive && setError((e as Error).message))
    }
    void window.nexgraph.engine.status().then((s) => s.state === 'ready' && open())
    const off = window.nexgraph.engine.onStatus((s) => s.state === 'ready' && open())
    return () => { alive = false; off() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!projectId) return <p className="muted agent-wait">{error ?? 'Đang chờ engine…'}</p>
  return (
    <AgentPanel projectId={projectId}
      onOpenCode={(file, line, lineEnd) => void host.openFile(file, line, lineEnd)}
      onHighlight={(nodes, edges, note) => void host.emit('highlight', { nodes, edges, note })}
      onOpenSettings={() => void host.emit('settings')} />
  )
}

document.documentElement.classList.add('agent-view')
createRoot(document.getElementById('root')!).render(<AgentView />)
