import { app } from 'electron'
import { join } from 'node:path'
import type { DebugBreakpoints } from '../../../shared/api'
import { adapterInstalled, installAdapter, type DebugKind } from '../../debug/adapters'
import { attachSpec, ensureConfigFile, listConfigs, resolveConfig, type DebugSpec } from '../../debug/launch-config'
import { DebugManager } from '../../debug/manager'
import { FsError, resolveInside } from '../../fs/project-fs'
import type { IpcContext } from '../../platform/ipc-context'

let debugManager: DebugManager | null = null

/** Dừng phiên gỡ lỗi khi thoát app. */
export const stopDebugger = (): void => { void debugManager?.stop() }

/** Gỡ lỗi: adapter cài vào thư mục dữ liệu app; mọi đường dẫn tệp là tương đối dự án và phải nằm trong dự án. */
export function registerDebugIpc(ctx: IpcContext): void {
  const { on, rootOf, getWindow } = ctx
  const adaptersBase = join(app.getPath('userData'), 'debug-adapters')
  debugManager = new DebugManager(adaptersBase, (event) => getWindow()?.webContents.send('debug:event', event))
  const dbg = debugManager
  const debugKind = (kind: unknown): DebugKind => {
    if (kind !== 'node' && kind !== 'python') throw new FsError('bad_param', 'Loại gỡ lỗi không hợp lệ')
    return kind
  }
  const breakpointList = (value: unknown): DebugBreakpoints[string] => {
    if (!Array.isArray(value) || value.length > 10_000) throw new FsError('bad_param', 'Danh sách điểm dừng không hợp lệ')
    return value.map((point: unknown) => {
      if (!point || typeof point !== 'object') throw new FsError('bad_param', 'Điểm dừng không hợp lệ')
      const p = point as Record<string, unknown>
      if (!Number.isInteger(p.line) || (p.line as number) < 1 || typeof p.enabled !== 'boolean' ||
        ['condition', 'hitCondition', 'logMessage'].some((key) => p[key] !== undefined && (typeof p[key] !== 'string' || (p[key] as string).length > 10_000))) {
        throw new FsError('bad_param', 'Điểm dừng không hợp lệ')
      }
      return { line: p.line as number, enabled: p.enabled, ...(p.condition ? { condition: p.condition as string } : {}),
        ...(p.hitCondition ? { hitCondition: p.hitCondition as string } : {}), ...(p.logMessage ? { logMessage: p.logMessage as string } : {}) }
    })
  }
  const cleanBreakpoints = (root: string, breakpoints: DebugBreakpoints | undefined): DebugBreakpoints => {
    const clean: DebugBreakpoints = {}
    for (const [path, points] of Object.entries(breakpoints ?? {})) { resolveInside(root, path); clean[path] = breakpointList(points) }
    return clean
  }
  const needAdapter = (kind: DebugKind): void => {
    if (!adapterInstalled(adaptersBase, kind)) throw new FsError('bad_param', 'Chưa cài debug adapter')
  }
  /** Python attach nối thẳng vào adapter do tiến trình đích tự chạy (`debugpy.listen`) nên không cần debugpy tải về. */
  const runSpec = (root: string, spec: DebugSpec, breakpoints: DebugBreakpoints): Promise<void> => {
    if (spec.kind === 'node' || spec.request === 'launch') needAdapter(spec.kind)
    return dbg.run(root, spec, breakpoints)
  }
  on('debug:adapter-status', async () => ({ node: adapterInstalled(adaptersBase, 'node'), python: adapterInstalled(adaptersBase, 'python') }))
  on('debug:install-adapter', async (kind: string) => installAdapter(adaptersBase, debugKind(kind)))
  on('debug:start', async (pid: string, kind: string, file: string, breakpoints: DebugBreakpoints) => {
    const root = await rootOf(pid)
    const clean = cleanBreakpoints(root, breakpoints)
    needAdapter(debugKind(kind))
    return dbg.start(debugKind(kind), root, file, clean)
  })
  on('debug:configs', async (pid: string) => listConfigs(await rootOf(pid)))
  on('debug:config-file', async (pid: string) => ensureConfigFile(await rootOf(pid)))
  on('debug:start-config', async (pid: string, config: { source?: unknown; name?: unknown } | null, file: string | null, breakpoints: DebugBreakpoints) => {
    if (!config || typeof config.source !== 'string' || typeof config.name !== 'string' || (file !== null && typeof file !== 'string')) throw new FsError('bad_param', 'Cấu hình gỡ lỗi không hợp lệ')
    const root = await rootOf(pid)
    const clean = cleanBreakpoints(root, breakpoints)
    return runSpec(root, await resolveConfig(root, config.source, config.name, file ?? undefined), clean)
  })
  on('debug:attach', async (pid: string, kind: string, host: unknown, port: unknown, breakpoints: DebugBreakpoints) => {
    const root = await rootOf(pid)
    const clean = cleanBreakpoints(root, breakpoints)
    return runSpec(root, attachSpec(debugKind(kind), host, port), clean)
  })
  on('debug:set-breakpoints', async (file: string, points: unknown) => dbg.setBreakpoints(file, breakpointList(points)))
  on('debug:step', async (action: string, threadId: number) => {
    if (action !== 'continue' && action !== 'next' && action !== 'stepIn' && action !== 'stepOut') throw new FsError('bad_param', 'Thao tác không hợp lệ')
    return dbg.step(action, Number(threadId))
  })
  on('debug:pause', async () => dbg.pause())
  on('debug:restart', async () => dbg.restart())
  on('debug:evaluate', async (expression: unknown, frameId: unknown, context: unknown) => {
    if (typeof expression !== 'string' || !expression.trim() || expression.length > 10_000 || !Number.isInteger(frameId) ||
      (context !== 'watch' && context !== 'repl')) throw new FsError('bad_param', 'Biểu thức gỡ lỗi không hợp lệ')
    return dbg.evaluate(expression, frameId as number, context)
  })
  on('debug:stack-trace', async (threadId: number) => dbg.stackTrace(Number(threadId)))
  on('debug:scopes', async (frameId: number) => dbg.scopes(Number(frameId)))
  on('debug:variables', async (ref: number) => dbg.variables(Number(ref)))
  on('debug:modules', async () => dbg.modules())
  on('debug:loaded-sources', async () => dbg.loadedSources())
  on('debug:stop', async () => dbg.stop())
}
