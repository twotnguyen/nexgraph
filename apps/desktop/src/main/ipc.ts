import { app, dialog, ipcMain, safeStorage, shell, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportFormat, ExportScope, FlowQuery, IndexOptions, NeighborQuery, PushRequest } from '../shared/graph-types'
import { EngineApi } from './engine/api'
import type { EngineCommand, EngineHandle } from './engine/launcher'
import { toIpcResult } from './ipc-result'
import { FsError, fsHandlers, isWithin, projectRoot } from './fs/project-fs'
import { AgentError, AgentService } from './agent/session'
import { AccountService } from './agent/accounts'
import type { AgentMode, AuthEventView, AuthPromptView } from '../shared/agent-types'
import type { AiSettings } from '../shared/graph-types'
import { SecretStore, writeJson } from './ai/settings'
import { hookBlock, hookStatus, installHook, uninstallHook } from './git-hook'
import { applyIntegration, planIntegration } from './integrations'
import type { AgentId } from '../shared/integration-types'
import { McpHttpManager, mcpStdioConfig, type McpKeyStore, type McpPortStore } from './mcp-http'
import { ProjectWatcher } from './watch/project-watcher'

const watchers = new Map<string, ProjectWatcher>()
let mcpHttp: McpHttpManager | null = null
let agents: AgentService | null = null

/** Rời mọi dự án: từ chối yêu cầu duyệt đang treo, huỷ phiên agent, huỷ đăng nhập OAuth đang chạy. */
export const closeAllAgents = (): void => {
  agents?.closeAll()
  cancelPendingAuthPrompts()
  void accountsPromise?.then((a) => a.cancelLogin()).catch(() => {})
}

export const stopAllMcpHttp = (): Promise<void> => mcpHttp?.stopAll() ?? Promise.resolve()

function readJson(file: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

const prefsFile = (): string => join(app.getPath('userData'), 'prefs.json')

/** Cổng MCP HTTP lần trước theo project (không bí mật) trong prefs.json. */
const prefsPortStore = (): McpPortStore => ({
  load: (pid) => Number(readJson(prefsFile())[`mcpPort:${pid}`]) || null,
  save: (pid, port) => writeJson(prefsFile(), { ...readJson(prefsFile()), [`mcpPort:${pid}`]: String(port) })
})

/** Thư mục xuất đã chọn theo projectId: chỉ main được ghi, renderer không gửi lại path tuỳ ý. */
const exportDirKey = (pid: string): string => `exportDir:${pid}`
const savedExportDir = (pid: string): string | null => {
  const prefs = readJson(prefsFile())
  return prefs[exportDirKey(pid)] ?? null
}

/** Box mã hoá safeStorage (Keychain/DPAPI) dùng chung cho key MCP và key AI provider. */
const secretBox = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s: string) => safeStorage.encryptString(s).toString('base64'),
  decrypt: (b64: string) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
}

/** Key MCP HTTP theo project, mã hoá bằng safeStorage trong userData/mcp-keys.json. */
function safeKeyStore(): McpKeyStore {
  const file = (): string => join(app.getPath('userData'), 'mcp-keys.json')
  return {
    load(pid) {
      const enc = readJson(file())[pid]
      if (!enc || !safeStorage.isEncryptionAvailable()) return null
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'))
      } catch {
        return null
      }
    },
    save(pid, key) {
      if (!safeStorage.isEncryptionAvailable()) return // không lưu key dạng rõ; lần sau sinh key mới
      const all = readJson(file())
      all[pid] = safeStorage.encryptString(key).toString('base64')
      writeJson(file(), all)
    }
  }
}

// ----- Tài khoản AI -----

let accountsPromise: Promise<AccountService> | null = null
const pendingPrompts = new Map<string, (value: string | null) => void>()

const cancelPendingAuthPrompts = (): void => {
  for (const [, resolve] of pendingPrompts) resolve(null)
  pendingPrompts.clear()
}

/** Tạo một lần; mỗi handler chờ nó. `ask` giữ cầu nối prompt OAuth ↔ renderer. */
const accounts = (getWindow: () => BrowserWindow | null, dataDir: string): Promise<AccountService> =>
  (accountsPromise ??= AccountService.create({
    dataDir,
    prefsFile: prefsFile(),
    secrets: new SecretStore(join(app.getPath('userData'), 'ai-key.json'), secretBox),
    openExternal: (url) => void shell.openExternal(url).catch(() => {}),
    notify: (event: AuthEventView) => getWindow()?.webContents.send('auth:login-event', event),
    ask: (view: AuthPromptView) => new Promise<string | null>((resolve) => {
      pendingPrompts.set(view.id, resolve)
      getWindow()?.webContents.send('auth:login-prompt', view)
    })
  }))

export function stopAllWatchers(): void {
  for (const w of watchers.values()) w.stop()
  watchers.clear()
}

/** Đăng ký các kênh IPC của dự án và đồ thị. `handle()` trả engine hiện tại hoặc null khi chưa sẵn sàng. */
export function registerIpc(
  getHandle: () => EngineHandle | null,
  getWindow: () => BrowserWindow | null,
  getCommand: () => EngineCommand,
  dataDir: string
): void {
  mcpHttp = new McpHttpManager(getCommand, dataDir, safeKeyStore(), prefsPortStore())
  const mcp = mcpHttp
  const handle = (): EngineHandle => {
    const h = getHandle()
    if (!h) throw new Error('Engine chưa sẵn sàng')
    return h
  }
  const api = (): EngineApi => new EngineApi(handle())
  const on = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R>): void =>
    ipcMain.handle(channel, (_e, ...args) => toIpcResult(() => fn(...(args as A))))

  on('project:pick-folder', async () => {
    const win = getWindow()
    const opts = { properties: ['openDirectory' as const], title: 'Chọn thư mục mã nguồn' }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  on('project:open', (path: string) => api().openProject(path))
  on('project:list', () => api().listProjects())
  const listProjects = (): Promise<{ project_id: string; path: string }[]> => api().listProjects()
  const fsh = fsHandlers(listProjects)
  /** Mọi kênh nhận path đều phải suy root từ projectId đã đăng ký; id lạ → FsError('unknown_project'). */
  const rootOf = projectRoot(listProjects)
  on('fs:read', fsh.read)
  on('fs:write', fsh.write)
  on('index:scan', (pid: string) => api().scan(pid))
  on('index:start', async (pid: string, opts?: IndexOptions) => ({ jobId: (await api().startIndex(pid, opts)).job_id }))
  on('index:cancel', async (jobId: string) => void (await api().cancelJob(jobId)))
  on('index:refresh', (pid: string) => api().refresh(pid))
  on('graph:changes', (pid: string, opts?: { refresh?: boolean }) => api().changes(pid, opts))
  on('watch:start', async (pid: string) => {
    watchers.get(pid)?.stop()
    const w = new ProjectWatcher({
      root: await rootOf(pid),
      onFlush: async () => void (await api().refresh(pid)),
      onError: (e) => console.warn(`[watch] ${pid}: ${e.message}`)
    })
    w.start()
    watchers.set(pid, w)
  })
  on('watch:stop', async (pid: string) => {
    watchers.get(pid)?.stop()
    watchers.delete(pid)
  })
  on('graph:stats', (pid: string) => api().stats(pid))
  on('graph:neighbors', (pid: string, q: NeighborQuery) => api().neighbors(pid, q))
  on('graph:node', (pid: string, id: string) => api().getNode(pid, id))
  on('graph:code', (pid: string, file: string, start?: number, end?: number) => api().code(pid, file, start, end))
  on('graph:search', (pid: string, q: string, opts?: { kinds?: string[]; limit?: number }) => api().search(pid, q, opts))
  on('graph:architecture', (pid: string, parent?: string) => api().architecture(pid, parent))
  on('graph:arch-evidence', (pid: string, from: string, to: string, limit?: number) => api().archEvidence(pid, from, to, limit))
  on('engine:tools', () => api().tools())
  on('graph:report', (pid: string) => api().report(pid))
  on('graph:paths', (pid: string, ids: string[], o?: { maxHops?: number; directed?: boolean }) => api().paths(pid, ids, o))
  on('graph:impact-of', (pid: string, nodeId: string) => api().impactOf(pid, nodeId))
  on('graph:ask', (pid: string, q: string, o?: { depth?: number; budget?: number; mode?: 'bfs' | 'dfs' }) => api().ask(pid, q, o))
  on('graph:recluster', (pid: string) => api().recluster(pid))
  on('graph:flows', (pid: string, opts?: FlowQuery) => api().flows(pid, opts))
  on('graph:flow', (pid: string, flowId: number) => api().flow(pid, flowId))
  on('graph:tour', (pid: string) => api().tour(pid))
  on('graph:locate', (pid: string, file: string, line: number) => api().locate(pid, file, line))
  on('graph:context', (pid: string, q: string, budget?: number) => api().context(pid, q, budget))
  on('graph:map', (pid: string, o?: { parent?: string; detail?: number }) => api().map(pid, o))
  on('graph:cycles', (pid: string, limit?: number) => api().cycles(pid, limit))

  const win = (): BrowserWindow | null => getWindow()
  const acc = (): Promise<AccountService> => accounts(win, dataDir)
  const derivedSettings = async (): Promise<AiSettings> => {
    const a = await acc()
    const sel = a.getSelectedModel()
    const p = sel && a.modelRuntime.getProvider(sel.provider)
    return {
      baseUrl: p?.baseUrl ?? '',
      model: sel?.id ?? '',
      hasKey: !!sel && a.hasKey(sel.provider),
      provider: sel?.provider
    }
  }
  on('ai:get-settings', () => derivedSettings())
  on('ai:has-consent', async (pid: string) => (await acc()).hasConsent(pid))
  on('ai:grant-consent', async (pid: string) => void (await acc()).grantConsent(pid))
  on('auth:list', async () => (await acc()).listProviders())
  on('auth:set-key', async (providerId: string, key: string) => (await acc()).setApiKey(providerId, key))
  on('auth:remove-key', async (providerId: string) => (await acc()).removeApiKey(providerId))
  on('auth:save-custom', async (p: Parameters<AccountService['saveCustomProvider']>[0], apiKey?: string) => (await acc()).saveCustomProvider(p, apiKey))
  on('auth:remove-custom', async (id: string) => (await acc()).removeCustomProvider(id))
  on('auth:login', async (providerId: string) => (await acc()).loginOAuth(providerId))
  on('auth:login-cancel', async () => {
    cancelPendingAuthPrompts()
    ;(await acc()).cancelLogin()
  })
  on('auth:prompt-reply', async (id: string, value: string | null) => {
    const resolve = pendingPrompts.get(id)
    if (!resolve) return
    pendingPrompts.delete(id)
    resolve(typeof value === 'string' ? value : null)
  })
  on('auth:logout', async (providerId: string) => (await acc()).logout(providerId))
  on('auth:models', async () => (await acc()).listModels())
  on('auth:select-model', async (provider: string, id: string) => (await acc()).selectModel(provider, id))
  on('auth:test', async () => (await acc()).test())
  // EngineApi đọc baseUrl/token mỗi lần gọi nên theo kịp engine khởi động lại.
  const liveApi = new EngineApi({ get baseUrl() { return handle().baseUrl }, get token() { return handle().token } })
  const agent = (agents = new AgentService({
    api: liveApi, dataDir,
    models: async () => {
      const a = await acc()
      return { modelRuntime: a.modelRuntime, selected: a.getSelectedModel() }
    },
    hasConsent: async (pid) => (await acc()).hasConsent(pid),
    rootOf: projectRoot(() => api().listProjects()),
    emit: (projectId, event) => win()?.webContents.send('agent:event', { projectId, event })
  }))
  on('agent:prompt', (pid: string, text: string) => agent.prompt(pid, text))
  on('agent:abort', (pid: string) => agent.abort(pid))
  on('agent:set-mode', async (pid: string, mode: AgentMode) => agent.setMode(pid, mode === 'edit' ? 'edit' : 'ask'))
  on('agent:get-mode', async (pid: string) => agent.getMode(pid))
  on('agent:approve', async (pid: string, id: string, allow: boolean) => agent.approve(pid, id, allow === true))
  on('agent:close', async (pid: string) => agent.close(pid))

  on('export:pick-dir', async (pid: string) => {
    await rootOf(pid) // chỉ dự án đã đăng ký mới có thể chọn thư mục xuất
    const prefs = readJson(prefsFile())
    const win = getWindow()
    const opts = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      title: 'Chọn thư mục lưu kết quả xuất',
      defaultPath: savedExportDir(pid) ?? app.getPath('downloads')
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    writeJson(prefsFile(), { ...prefs, [exportDirKey(pid)]: r.filePaths[0] })
    return r.filePaths[0]
  })
  on('export:run', async (pid: string, format: ExportFormat, scope: ExportScope) => {
    await rootOf(pid)
    const dir = savedExportDir(pid)
    if (!dir) throw new AgentError('bad_param', 'Chưa chọn thư mục lưu kết quả xuất')
    return api().exportGraph(pid, format, scope, dir)
  })
  on('export:push', (pid: string, req: PushRequest) => api().pushGraph(pid, req))
  on('export:png', async (rect?: { x: number; y: number; width: number; height: number }) => {
    const win = getWindow()
    if (!win) return null
    const image = await (rect && rect.width > 0 && rect.height > 0 ? win.webContents.capturePage(rect) : win.webContents.capturePage())
    const prefs = readJson(prefsFile())
    const r = await dialog.showSaveDialog(win, {
      title: 'Lưu ảnh đồ thị',
      defaultPath: join(prefs.exportDir ?? app.getPath('downloads'), 'nexgraph.png'),
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })
    if (r.canceled || !r.filePath) return null
    await writeFile(r.filePath, image.toPNG())
    return r.filePath
  })
  on('export:reveal', async (pid: string, path: string) => {
    const root = await rootOf(pid)
    const dir = savedExportDir(pid)
    if (!isWithin(root, path) && !(dir && isWithin(dir, path)))
      throw new FsError('outside_project', `Đường dẫn nằm ngoài dự án và thư mục xuất: ${path}`)
    await shell.showItemInFolder(path)
  })

  // Mọi path đi vào engine/git hook/MCP đều suy từ projectId đã đăng ký, không tin path renderer gửi.
  on('mcp:config', async (pid: string) => ({ stdio: mcpStdioConfig(getCommand(), await rootOf(pid), dataDir) }))
  on('hook:status', async (pid: string) => hookStatus(await rootOf(pid), getCommand(), dataDir))
  on('hook:preview', async (pid: string) => hookBlock(getCommand(), await rootOf(pid), dataDir))
  on('hook:install', async (pid: string) => installHook(await rootOf(pid), getCommand(), dataDir))
  on('hook:uninstall', async (pid: string) => uninstallHook(await rootOf(pid)))
  on('mcp:plan', async (agent: AgentId, pid: string) => planIntegration(agent, await rootOf(pid), getCommand(), dataDir))
  on('mcp:apply', async (agent: AgentId, pid: string) => applyIntegration(agent, await rootOf(pid), getCommand(), dataDir))
  on('mcp:start-http', async (pid: string) => mcp.start(pid, await rootOf(pid)))
  on('mcp:stop-http', (pid: string) => mcp.stop(pid))
  on('mcp:http-status', async (pid: string) => mcp.status(pid))
}
