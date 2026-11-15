import { app, dialog, ipcMain, safeStorage, shell, type BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportFormat, ExportScope, FlowQuery, IndexOptions, NeighborQuery, PushRequest } from '../shared/graph-types'
import { EngineApi } from './engine/api'
import type { EngineCommand, EngineHandle } from './engine/launcher'
import { toIpcResult } from './ipc-result'
import { fsHandlers, projectRoot } from './fs/project-fs'
import { AgentService } from './agent/session'
import { settingsModels } from './agent/model'
import type { AgentMode } from '../shared/agent-types'
import { AiSettingsStore, endpoint } from './ai/settings'
import { hookBlock, hookStatus, installHook, uninstallHook } from './git-hook'
import { applyIntegration, planIntegration } from './integrations'
import type { AgentId } from '../shared/integration-types'
import { McpHttpManager, mcpStdioConfig, type McpKeyStore, type McpPortStore } from './mcp-http'
import { ProjectWatcher } from './watch/project-watcher'

const watchers = new Map<string, ProjectWatcher>()
let mcpHttp: McpHttpManager | null = null
let agents: AgentService | null = null

/** Rời mọi dự án: từ chối yêu cầu duyệt đang treo, huỷ phiên agent. */
export const closeAllAgents = (): void => agents?.closeAll()

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
  save: (pid, port) => writeFileSync(prefsFile(), JSON.stringify({ ...readJson(prefsFile()), [`mcpPort:${pid}`]: String(port) }))
})

/** Key MCP HTTP theo project, mã hoá bằng safeStorage (Keychain/DPAPI) trong userData/mcp-keys.json. */
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
      writeFileSync(file(), JSON.stringify(all), { mode: 0o600 })
    }
  }
}

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
  const fsh = fsHandlers(() => api().listProjects())
  on('fs:read', fsh.read)
  on('fs:write', fsh.write)
  on('index:scan', (pid: string) => api().scan(pid))
  on('index:start', async (pid: string, opts?: IndexOptions) => ({ jobId: (await api().startIndex(pid, opts)).job_id }))
  on('index:cancel', async (jobId: string) => void (await api().cancelJob(jobId)))
  on('index:refresh', (pid: string) => api().refresh(pid))
  on('graph:changes', (pid: string, opts?: { refresh?: boolean }) => api().changes(pid, opts))
  on('watch:start', async (pid: string, path: string) => {
    watchers.get(pid)?.stop()
    const w = new ProjectWatcher({
      root: path,
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

  const ai = new AiSettingsStore(prefsFile(), join(app.getPath('userData'), 'ai-key.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
    decrypt: (b64) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
  })
  on('ai:get-settings', async () => ai.get())
  on('ai:save-settings', async (s: { baseUrl: string; model: string; apiKey?: string }) => ai.save(s))
  on('ai:has-consent', async (pid: string) => ai.hasConsent(pid))
  on('ai:grant-consent', async (pid: string) => ai.grantConsent(pid))
  on('ai:test', async () => {
    const cfg = ai.get()
    const key = ai.key()
    const t0 = Date.now()
    try {
      const r = await fetch(endpoint(cfg.baseUrl), {
        method: 'POST', signal: AbortSignal.timeout(15_000),
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
      })
      return { ok: r.ok, ms: Date.now() - t0, error: r.ok ? null : `HTTP ${r.status}` }
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // EngineApi đọc baseUrl/token mỗi lần gọi nên theo kịp engine khởi động lại.
  const liveApi = new EngineApi({ get baseUrl() { return handle().baseUrl }, get token() { return handle().token } })
  const agent = (agents = new AgentService({
    api: liveApi, dataDir, models: settingsModels(dataDir, ai),
    hasConsent: (pid) => ai.hasConsent(pid),
    rootOf: projectRoot(() => api().listProjects()),
    emit: (projectId, event) => getWindow()?.webContents.send('agent:event', { projectId, event })
  }))
  on('agent:prompt', (pid: string, text: string) => agent.prompt(pid, text))
  on('agent:abort', (pid: string) => agent.abort(pid))
  on('agent:set-mode', async (pid: string, mode: AgentMode) => agent.setMode(pid, mode === 'edit' ? 'edit' : 'ask'))
  on('agent:get-mode', async (pid: string) => agent.getMode(pid))
  on('agent:approve', async (pid: string, id: string, allow: boolean) => agent.approve(pid, id, allow === true))
  on('agent:close', async (pid: string) => agent.close(pid))

  on('export:pick-dir', async () => {
    const prefs = readJson(prefsFile())
    const win = getWindow()
    const opts = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      title: 'Chọn thư mục lưu kết quả xuất',
      defaultPath: prefs.exportDir ?? app.getPath('downloads')
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    writeFileSync(prefsFile(), JSON.stringify({ ...prefs, exportDir: r.filePaths[0] }))
    return r.filePaths[0]
  })
  on('export:run', (pid: string, format: ExportFormat, scope: ExportScope, outDir: string) => api().exportGraph(pid, format, scope, outDir))
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
  on('export:reveal', async (path: string) => shell.showItemInFolder(path))

  on('mcp:config', async (projectPath: string) => ({ stdio: mcpStdioConfig(getCommand(), projectPath, dataDir) }))
  on('hook:status', async (projectPath: string) => hookStatus(projectPath, getCommand(), dataDir))
  on('hook:preview', async (projectPath: string) => hookBlock(getCommand(), projectPath, dataDir))
  on('hook:install', async (projectPath: string) => installHook(projectPath, getCommand(), dataDir))
  on('hook:uninstall', async (projectPath: string) => uninstallHook(projectPath))
  on('mcp:plan', async (agent: AgentId, projectPath: string) => planIntegration(agent, projectPath, getCommand(), dataDir))
  on('mcp:apply', async (agent: AgentId, projectPath: string) => applyIntegration(agent, projectPath, getCommand(), dataDir))
  on('mcp:start-http', (pid: string, projectPath: string) => mcp.start(pid, projectPath))
  on('mcp:stop-http', (pid: string) => mcp.stop(pid))
  on('mcp:http-status', async (pid: string) => mcp.status(pid))
}
