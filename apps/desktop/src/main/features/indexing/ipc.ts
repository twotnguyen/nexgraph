import { app, dialog } from 'electron'
import { join } from 'node:path'
import type { IndexOptions } from '../../../shared/graph-types'
import { SecretStore } from '../../platform/settings'
import { EngineApiError } from '../../platform/engine/api'
import { IndexOptionsStore } from './index-options'
import { IndexSourceStore } from './index-sources'
import type { IpcContext } from '../../platform/ipc-context'
import { secretBox } from '../../platform/prefs'
import { WatchErrorNotifier } from './error-notice'
import { ProjectWatcher } from './project-watcher'

const watchers = new Map<string, ProjectWatcher>()
const watchStarts = new Map<string, symbol>()

/** Dừng mọi watcher (rời dự án, thoát app). */
export function stopAllWatchers(): void {
  watchStarts.clear()
  for (const w of watchers.values()) w.stop()
  watchers.clear()
}

/** Lập chỉ mục, tuỳ chọn index nhớ theo dự án, nguồn bổ sung (W11) và tự cập nhật khi tệp đổi. */
export function registerIndexingIpc(ctx: IpcContext): void {
  const { on, api, rootOf, getWindow } = ctx
  // UI-REFRESH-ERR: lỗi refresh nền gửi sang renderer (đã gộp lỗi lặp) thay vì chỉ ghi log main.
  const watchErrors = new WatchErrorNotifier(
    (failure) => getWindow()?.webContents.send('watch:error', failure),
    (projectId) => getWindow()?.webContents.send('watch:ok', projectId)
  )
  const indexSources = new IndexSourceStore(join(app.getPath('userData'), 'index-sources.json'),
    new SecretStore(join(app.getPath('userData'), 'index-source-secrets.json'), secretBox))
  const indexOptions = new IndexOptionsStore(join(app.getPath('userData'), 'index-options.json'))
  const stopWatch = (pid: string): void => {
    watchStarts.delete(pid)
    watchers.get(pid)?.stop()
    watchers.delete(pid)
  }
  ctx.onProjectRemove((pid) => {
    indexSources.forget(pid)
    indexOptions.forget(pid)
    stopWatch(pid)
  })
  on('index:scan', (pid: string) => api().scan(pid))
  on('index:options', async (pid: string) => indexOptions.remembered(pid))
  on('index:start', async (pid: string, opts?: IndexOptions) => {
    try {
      // Lựa chọn dính của dự án (includeDocs…) áp trước, rồi nguồn bổ sung; renderer không phải gửi lại.
      const resolved = indexSources.resolve(pid, indexOptions.resolve(pid, opts))
      return { jobId: (await api().startIndex(pid, resolved.opts, resolved.postgresDsn)).job_id }
    } catch (error) {
      if (error instanceof EngineApiError && error.code === 'index_running' && error.jobId) return { jobId: error.jobId }
      throw error
    }
  })
  on('index:status', (jobId: string) => api().getJob(jobId))
  on('index:cancel', async (jobId: string) => void (await api().cancelJob(jobId)))
  on('index:refresh', (pid: string) => api().refresh(pid))
  on('graph:changes', (pid: string, opts?: { refresh?: boolean }) => api().changes(pid, opts))
  on('watch:start', async (pid: string) => {
    const generation = Symbol()
    watchStarts.set(pid, generation)
    try {
      const root = await rootOf(pid)
      if (watchStarts.get(pid) !== generation) return
      watchers.get(pid)?.stop()
      const w = new ProjectWatcher({
        root,
        onFlush: async () => {
          const result = await api().refresh(pid)
          // Refresh chạy được: gỡ cảnh báo cũ ở renderer và cho lần lỗi sau báo lại, không bị gộp với lỗi cũ.
          watchErrors.recover(pid)
          if (result.status === 'skipped' && (result.reason === 'index_running' || result.reason === 'refresh_running')) {
            return 'retry'
          }
        },
        onError: (e) => {
          console.warn(`[watch] ${pid}: ${e.message}`)
          watchErrors.report(pid, e)
        }
      })
      w.start()
      watchers.set(pid, w)
    } finally {
      if (watchStarts.get(pid) === generation) watchStarts.delete(pid)
    }
  })
  on('watch:stop', async (pid: string) => {
    watchErrors.clear(pid)
    return stopWatch(pid)
  })
  // Nguồn bổ sung (W11): DSN chỉ đi một chiều renderer → main; renderer chỉ biết đã có DSN hay chưa.
  on('index-sources:has-dsn', async (pid: string) => indexSources.hasDsn(pid))
  on('index-sources:remembered', async (pid: string) => indexSources.remembered(pid))
  on('index-sources:save-dsn', async (pid: string, dsn: string | null) => indexSources.saveDsn(pid, dsn))
  on('index-sources:pick-file', async (kind: 'scip' | 'mcp') => {
    const win = getWindow()
    const opts = { properties: ['openFile' as const], filters: [{ name: kind === 'scip' ? 'SCIP JSON' : 'MCP', extensions: ['json'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
}
