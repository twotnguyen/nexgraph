import type { IpcContext } from '../../platform/ipc-context'

/** Danh sách dự án của engine. Gỡ dự án chạy việc dọn mà các tính năng khác đăng ký qua `onProjectRemove`. */
export function registerProjectsIpc(ctx: IpcContext): void {
  const { on, api } = ctx
  on('project:open', (path: string) => api().openProject(path))
  on('project:list', () => api().listProjects())
  on('project:remove', async (pid: string) => {
    await api().removeProject(pid)
    await ctx.projectRemoved(pid)
  })
}
