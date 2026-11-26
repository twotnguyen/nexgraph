// Điểm vào của bundle webview: vá Worker → dựng window.nexgraph bằng preload cũ → chạy app React cũ.
import './worker-blob'
import './hosted.css'
import '../../../apps/desktop/src/preload/index'
import { ipcRenderer } from './electron-webview'
import { parseInitialCommand } from './host-command'
import type { HostCommand } from '../../../apps/desktop/src/shared/api'

const root = document.getElementById('root')!
let commandsReady = false
document.documentElement.classList.add('hosted') // bật các ghi đè giao diện trong hosted.css
window.nexgraph.host = {
  folder: root.dataset.folder || null,
  initialView: root.dataset.view || undefined,
  initialCommand: parseInitialCommand(root.dataset.command),
  openFile: (file, line, lineEnd) => ipcRenderer.invoke('host:open-file', file, line, lineEnd) as Promise<void>,
  emit: (name, arg) => ipcRenderer.invoke('host:emit', name, arg) as Promise<void>,
  onCommand(cb) {
    const l = (_e: unknown, c: unknown): void => cb((c as HostCommand).name, (c as HostCommand).arg)
    ipcRenderer.on('host:command', l)
    if (root.dataset.mode === 'main' && !commandsReady) {
      commandsReady = true
      void ipcRenderer.invoke('host:ready').catch(() => { commandsReady = false })
    }
    return () => ipcRenderer.removeListener('host:command', l)
  }
}
// Cùng một bundle phục vụ hai webview: tab chính và view Trợ lý AI ở thanh bên phụ.
void (root.dataset.mode === 'agent' ? import('../../../apps/desktop/src/renderer/src/hosted/AgentView') : import('../../../apps/desktop/src/renderer/src/main'))
