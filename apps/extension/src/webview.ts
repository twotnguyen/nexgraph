// Điểm vào của bundle webview: vá Worker → dựng window.nexgraph bằng preload cũ → chạy app React cũ.
import './worker-blob'
import './hosted.css'
import '../../desktop/src/preload/index'
import { ipcRenderer } from './electron-webview'

const root = document.getElementById('root')!
document.documentElement.classList.add('hosted') // bật các ghi đè giao diện trong hosted.css
window.nexgraph.host = {
  folder: root.dataset.folder || null,
  initialView: root.dataset.view || undefined,
  openFile: (file, line, lineEnd) => ipcRenderer.invoke('host:open-file', file, line, lineEnd) as Promise<void>,
  emit: (name, arg) => ipcRenderer.invoke('host:emit', name, arg) as Promise<void>,
  onCommand(cb) {
    const l = (_e: unknown, c: unknown): void => cb((c as { name: string }).name, (c as { arg?: unknown }).arg)
    ipcRenderer.on('host:command', l)
    return () => ipcRenderer.removeListener('host:command', l)
  }
}
// Cùng một bundle phục vụ hai webview: tab chính và view Trợ lý AI ở thanh bên phụ.
void (root.dataset.mode === 'agent' ? import('../../desktop/src/renderer/src/hosted/AgentView') : import('../../desktop/src/renderer/src/main'))
