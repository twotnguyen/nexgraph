import { BrowserWindow, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { EngineApi, EngineApiError } from './engine/api'
import type { EngineCommand, EngineHandle } from './engine/launcher'
import type { AccountDevHooks } from '../features/agent/accounts'
import { projectRoot } from './project-fs'
import { toIpcResult } from './ipc-result'
import { UserError } from './user-error'

type Handler<A extends unknown[], R> = (...args: A) => Promise<R>
type ProjectRemoveHook = (projectId: string) => void | Promise<void>

/** Tham số `registerIpc` nhận từ `index.ts` (và extension Code-OSS ở labs/). */
export interface IpcHost {
  getHandle: () => EngineHandle | null
  getWindow: () => BrowserWindow | null
  getCommand: () => EngineCommand
  dataDir: string
  devHooks?: AccountDevHooks
  openWindow?: () => void
  /** Dựng lại menu hệ thống sau khi đổi ngôn ngữ (index.ts nối vào appMenu). */
  rebuildMenu?: (locale: 'vi' | 'en') => void
}

/**
 * Những gì mỗi tính năng cần để đăng ký kênh IPC của nó (`register<Tính năng>Ipc(ctx)`).
 * Mọi path đi vào engine/git/MCP suy từ projectId đã đăng ký qua `rootOf`, không tin path renderer gửi.
 */
export interface IpcContext extends IpcHost {
  /** Engine hiện tại; chưa sẵn sàng thì ném lỗi 503 `engine_unavailable`. */
  handle: () => EngineHandle
  api: () => EngineApi
  listProjects: () => Promise<{ project_id: string; path: string }[]>
  /** Gốc của dự án đã đăng ký; id lạ → FsError('unknown_project'). */
  rootOf: (projectId: string) => Promise<string>
  on: <A extends unknown[], R>(channel: string, fn: Handler<A, R>) => void
  /** Như on() nhưng truyền webContents đã gọi vào handler (tài nguyên gắn cửa sổ đã mở nó). */
  onFrom: <A extends unknown[], R>(channel: string, fn: (owner: WebContents, ...args: A) => Promise<R>) => void
  /**
   * Kênh mới (#38/REV-*): chỉ nhận lệnh từ khung chính của một cửa sổ NexGraph.
   * Renderer không có iframe/webview, nhưng chặn ở đây để khung lạ không gọi ké được
   * các kênh mở hộp thoại/tạo cửa sổ/đổi menu.
   */
  onTrusted: <A extends unknown[], R>(channel: string, fn: Handler<A, R>) => void
  /** Tính năng giữ trạng thái theo dự án đăng ký việc dọn khi `project:remove`, chạy theo thứ tự đăng ký. */
  onProjectRemove: (hook: ProjectRemoveHook) => void
  /** Chạy các việc dọn đã đăng ký. Phần đồng bộ chạy lần lượt ngay, phần async được chờ cùng lúc. */
  projectRemoved: (projectId: string) => Promise<void>
}

export function createIpcContext(host: IpcHost): IpcContext {
  const handle = (): EngineHandle => {
    const h = host.getHandle()
    if (!h) throw new EngineApiError(503, 'engine_unavailable', 'Engine chưa sẵn sàng.')
    return h
  }
  const api = (): EngineApi => new EngineApi(handle())
  const listProjects = (): Promise<{ project_id: string; path: string }[]> => api().listProjects()
  const removeHooks: ProjectRemoveHook[] = []
  return {
    ...host,
    handle,
    api,
    listProjects,
    rootOf: projectRoot(listProjects),
    on: (channel, fn) => {
      ipcMain.handle(channel, (_e, ...args) => toIpcResult(() => fn(...(args as never))))
    },
    onFrom: (channel, fn) => {
      ipcMain.handle(channel, (event, ...args) => toIpcResult(() => fn(event?.sender as WebContents, ...(args as never))))
    },
    onTrusted: (channel, fn) => {
      ipcMain.handle(channel, (event, ...args) => toIpcResult(async () => {
        const sender = event?.sender
        const frame = event?.senderFrame
        if (!sender || !frame || frame !== sender.mainFrame || !BrowserWindow.fromWebContents(sender)) {
          throw new UserError('forbidden_sender', 'Yêu cầu không đến từ cửa sổ NexGraph.')
        }
        return fn(...(args as never))
      }))
    },
    onProjectRemove: (hook) => { removeHooks.push(hook) },
    projectRemoved: async (projectId) => {
      const pending: Promise<void>[] = []
      for (const hook of removeHooks) {
        const result = hook(projectId)
        if (result) pending.push(result)
      }
      await Promise.all(pending)
    }
  }
}

/** Gửi sự kiện của tài nguyên về đúng cửa sổ sở hữu; cửa sổ đã đóng thì bỏ, không gửi sang cửa sổ khác. */
export const sendOwned = (owner: unknown, channel: string, payload: unknown): void => {
  const contents = owner as WebContents | undefined
  if (!contents || contents.isDestroyed()) return
  contents.send(channel, payload)
}
