import type { BrowserWindow, WebContents } from 'electron'
import { join } from 'node:path'
import type { AccountDevHooks } from './agent/accounts'
import { registerAppIpc } from './app/ipc'
import type { EngineCommand, EngineHandle } from './engine/launcher'
import { closeAgentsOwnedBy, registerAgentIpc } from './features/agent/ipc'
import { registerCollabIpc, stopCollab } from './features/collab/ipc'
import { registerDebugIpc, stopDebugger } from './features/debug/ipc'
import { registerExportIpc } from './features/export/ipc'
import { registerExtensionsIpc } from './features/extensions/ipc'
import { registerFilesIpc } from './features/files/ipc'
import { registerGitIpc } from './features/git/ipc'
import { registerGraphIpc } from './features/graph/ipc'
import { registerGraphPagesIpc } from './features/graph-pages/ipc'
import { registerIndexingIpc } from './features/indexing/ipc'
import { registerIntegrationsIpc } from './features/integrations/ipc'
import { registerLspIpc, stopLanguageServers } from './features/lsp/ipc'
import { registerProjectsIpc } from './features/projects/ipc'
import { registerSemanticIpc } from './features/semantic/ipc'
import { killAllTerminals, killTerminalsOwnedBy, registerTerminalIpc } from './features/terminal/ipc'
import { createIpcContext } from './platform/ipc-context'

// Vòng đời app (index.ts, extension Code-OSS ở labs/) gọi các hàm này; mỗi tính năng giữ trạng thái của nó.
export { closeAllAgents, stopNexAccounts } from './features/agent/ipc'
export { stopAllWatchers } from './features/indexing/ipc'
export { stopAllMcpHttp } from './features/integrations/ipc'

/**
 * Dọn tài nguyên của MỘT cửa sổ: reload, renderer chết hoặc đóng cửa sổ chỉ được giết phiên agent
 * và terminal của chính cửa sổ đó. Thoát app / cửa sổ cuối vẫn dùng `closeAllAgents`.
 */
export const closeWindowResources = (owner: WebContents): void => {
  closeAgentsOwnedBy(owner)
  killTerminalsOwnedBy(owner)
}

/** Dừng language server, terminal, phiên gỡ lỗi và cộng tác khi thoát app. */
export const stopEditorProcesses = (): void => {
  stopLanguageServers()
  killAllTerminals()
  stopDebugger()
  stopCollab()
}

/**
 * Đăng ký mọi kênh IPC: mỗi tính năng có `register<Tính năng>Ipc(ctx)` trong `features/<tính năng>/ipc.ts`.
 * `getHandle()` trả engine hiện tại hoặc null khi chưa sẵn sàng.
 */
export function registerIpc(
  getHandle: () => EngineHandle | null,
  getWindow: () => BrowserWindow | null,
  getCommand: () => EngineCommand,
  dataDir: string,
  devHooks?: AccountDevHooks,
  openWindow?: () => void,
  /** Dựng lại menu hệ thống sau khi đổi ngôn ngữ (index.ts nối vào appMenu). */
  rebuildMenu?: (locale: 'vi' | 'en') => void
): void {
  const ctx = createIpcContext({ getHandle, getWindow, getCommand, dataDir, devHooks, openWindow, rebuildMenu })
  registerAppIpc(ctx)
  // Thứ tự đăng ký cũng là thứ tự dọn khi gỡ dự án (`onProjectRemove`).
  registerProjectsIpc(ctx)
  registerGraphPagesIpc(ctx, join(__dirname, '../preload'))
  registerIndexingIpc(ctx)
  registerAgentIpc(ctx)
  registerIntegrationsIpc(ctx)
  registerLspIpc(ctx)
  registerFilesIpc(ctx)
  registerTerminalIpc(ctx)
  registerGitIpc(ctx)
  registerDebugIpc(ctx)
  registerCollabIpc(ctx)
  registerExtensionsIpc(ctx)
  registerGraphIpc(ctx)
  registerExportIpc(ctx)
  registerSemanticIpc(ctx)
}
