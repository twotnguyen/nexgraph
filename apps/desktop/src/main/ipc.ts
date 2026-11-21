import { app, dialog, ipcMain, safeStorage, shell, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WriteOpts } from '../shared/api'
import type { ExportFormat, ExportScope, FlowQuery, IndexOptions, NeighborQuery, PushRequest } from '../shared/graph-types'
import { EngineApi, EngineApiError } from './engine/api'
import type { EngineCommand, EngineHandle } from './engine/launcher'
import { toIpcResult } from './ipc-result'
import { FsError, fsHandlers, isWithin, projectRoot } from './fs/project-fs'
import { AgentError, AgentService } from './agent/session'
import { AccountService } from './agent/accounts'
import type { AgentMode, AiConsentTarget, AuthEventView, AuthPromptView, AgentExecutionSettings, AgentRunLimits, AgentPromptOptions, AgentEditorState } from '../shared/agent-types'
import { detectProjectCommands } from './agent/process-tools'
import type { AiSettings } from '../shared/graph-types'
import { SecretStore, writeJson } from './ai/settings'
import { hookPreview, hookStatus, installHook, uninstallHook } from './git-hook'
import { applyPlatform, applyUninstall, planPlatform, planUninstall } from './integrations'
import type { AgentId, IntegrationOptions } from '../shared/integration-types'
import { McpHttpManager, mcpStdioConfig, type McpKeyStore, type McpPortStore } from './mcp-http'
import { ProjectWatcher } from './watch/project-watcher'
import { EditorStateRegistry } from './agent/editor-state'
import { AgentRouter } from './agent-router'
import { GeminiConnectionManager } from './gemini/connection'
import { GeminiAgentService } from './gemini/service'
import { GeminiConsentStore } from './gemini-consent'
import { IndexSourceStore } from './index-sources'
import { runSemanticJob } from './ai/semantic-runner'
import { directTransport, piComplete, selectedModelLabel } from './ai/semantic-models'
import type { ProjectAiSettings, SemanticTarget } from '../shared/graph-types'
import type { GeminiConsentTarget } from '../shared/agent-types'
import type { AnswerRating, MemoryKind } from '../shared/graph-types'

const watchers = new Map<string, ProjectWatcher>()
const watchStarts = new Map<string, symbol>()
let mcpHttp: McpHttpManager | null = null
let agents: AgentRouter | null = null
let geminiConnection: GeminiConnectionManager | null = null
let editors: EditorStateRegistry | null = null

/** Rời mọi dự án: từ chối yêu cầu duyệt đang treo, huỷ phiên agent, huỷ đăng nhập OAuth đang chạy. */
export const closeAllAgents = (): void => {
  editors?.clearAll()
  agents?.closeAll()
  cancelPendingAuthPrompts()
  void accountsPromise?.then((a) => a.cancelLogin()).catch(() => {})
  geminiConnection?.cancelLogin()
  void geminiConnection?.shutdown().catch(() => {})
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
  available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend?.() !== 'basic_text'),
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
  watchStarts.clear()
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
    if (!h) throw new EngineApiError(503, 'engine_unavailable', 'Engine chưa sẵn sàng.')
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
  const indexSources = new IndexSourceStore(join(app.getPath('userData'), 'index-sources.json'),
    new SecretStore(join(app.getPath('userData'), 'index-source-secrets.json'), secretBox))
  const removalVersions = new Map<string, symbol>()
  const stopWatch = (pid: string): void => {
    watchStarts.delete(pid)
    watchers.get(pid)?.stop()
    watchers.delete(pid)
  }
  on('project:remove', async (pid: string) => {
    await api().removeProject(pid)
    indexSources.forget(pid)
    removalVersions.set(pid, Symbol())
    stopWatch(pid)
    agents?.close(pid)
    editors?.clear(pid)
    await mcp.stop(pid)
  })
  const listProjects = (): Promise<{ project_id: string; path: string }[]> => api().listProjects()
  const fsh = fsHandlers(listProjects)
  /** Mọi kênh nhận path đều phải suy root từ projectId đã đăng ký; id lạ → FsError('unknown_project'). */
  const rootOf = projectRoot(listProjects)
  on('fs:list', fsh.list)
  on('fs:read', fsh.read)
  on('fs:write', async (pid: string, relPath: string, text: string, opts: WriteOpts) => {
    const version = opts?.expectedVersion
    if (version !== null && (typeof version !== 'string' || !version)) {
      throw new FsError('conflict', 'Cần đọc lại tệp trước khi lưu')
    }
    return fsh.write(pid, relPath, text, opts)
  })
  on('index:scan', (pid: string) => api().scan(pid))
  on('index:start', async (pid: string, opts?: IndexOptions) => {
    try {
      const resolved = indexSources.resolve(pid, opts)
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
          if (result.status === 'skipped' && (result.reason === 'index_running' || result.reason === 'refresh_running')) {
            return 'retry'
          }
        },
        onError: (e) => console.warn(`[watch] ${pid}: ${e.message}`)
      })
      w.start()
      watchers.set(pid, w)
    } finally {
      if (watchStarts.get(pid) === generation) watchStarts.delete(pid)
    }
  })
  on('watch:stop', async (pid: string) => stopWatch(pid))
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
  on('graph:stats', (pid: string) => api().stats(pid))
  on('graph:neighbors', (pid: string, q: NeighborQuery) => api().neighbors(pid, q))
  on('graph:node', (pid: string, id: string) => api().getNode(pid, id))
  on('graph:code', (pid: string, file: string, start?: number, end?: number) => api().code(pid, file, start, end))
  on('graph:search', (pid: string, q: string, opts?: { kinds?: string[]; limit?: number }) => api().search(pid, q, opts))
  on('graph:architecture', (pid: string, parent?: string) => api().architecture(pid, parent))
  on('graph:arch-evidence', (pid: string, from: string, to: string, limit?: number) => api().archEvidence(pid, from, to, limit))
  on('engine:tools', () => api().tools())
  on('graph:report', (pid: string) => api().report(pid))
  on('graph:explain', (pid: string, nodeId: string) => api().explain(pid, nodeId))
  on('graph:section', (pid: string, nodeId: string) => api().section(pid, nodeId))
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
  // A local connection ID cannot verify a shared native Google account after restart.
  // Keep history local until the user explicitly checks and activates the connection again.
  const startupPrefs = readJson(prefsFile())
  if (startupPrefs.aiRuntime === 'antigravity-cli' || startupPrefs.aiRuntime === 'gemini-cli')
    writeJson(prefsFile(), { ...startupPrefs, aiRuntime: 'antigravity-cli', aiGeminiEnabled: '0' })
  let runtimeVersion = 0
  let googleProbe: string | null = null
  let googleProbeVersion = 0
  const invalidateGoogleProbe = () => { googleProbe = null; googleProbeVersion++ }
  const selectedRuntime = (): 'pi' | 'antigravity-cli' => readJson(prefsFile()).aiRuntime === 'antigravity-cli' ? 'antigravity-cli' : 'pi'
  const geminiEnabled = (): boolean => selectedRuntime() === 'antigravity-cli' && readJson(prefsFile()).aiGeminiEnabled === '1'
  const selectRuntime = (runtime: 'pi' | 'antigravity-cli', enabled = runtime === 'antigravity-cli') => {
    runtimeVersion++
    invalidateGoogleProbe()
    agent.selectionChanged()
    writeJson(prefsFile(), { ...readJson(prefsFile()), aiRuntime: runtime, aiGeminiEnabled: enabled ? '1' : '0' })
  }
  const google = (geminiConnection = new GeminiConnectionManager({
    dataDir,
    binaryPath: !app.isPackaged ? process.env.NEXGRAPH_ANTIGRAVITY_BINARY_PATH : undefined,
    notify: (event) => win()?.webContents.send('gemini:event', { type: 'auth', event }),
    onStatus: (status) => win()?.webContents.send('gemini:event', { type: 'status', status })
  }))
  const googleTarget = async (): Promise<GeminiConsentTarget | null> => {
    const status = await google.status()
    return status.authenticated && status.connectionId ? { runtime: 'antigravity-cli', provider: 'google-antigravity', connectionId: status.connectionId } : null
  }
  const googleConsent = new GeminiConsentStore(join(dataDir, 'google-consent.json'), rootOf, googleTarget)
  const derivedSettings = async (): Promise<AiSettings> => {
    if (selectedRuntime() === 'antigravity-cli') {
      const status = await google.status()
      return { runtime: 'antigravity-cli', provider: 'google-antigravity', baseUrl: '', model: status.authenticated && geminiEnabled() ? google.selectedModel() : '', hasKey: false, connectionId: status.connectionId }
    }
    const a = await acc()
    const target = await a.getConsentTarget()
    const model = a.getSelectedModel()
    return {
      baseUrl: target?.baseUrl ?? '',
      model: model?.id ?? '',
      hasKey: !!target && a.hasKey(target.provider),
      provider: target?.provider,
      accountId: target?.accountId
    }
  }
  on('ai:get-settings', () => derivedSettings())
  on('ai:has-consent', async (pid: string, target: AiConsentTarget) => target?.runtime === 'antigravity-cli' ? googleConsent.hasConsent(pid, target) : (await acc()).hasConsent(pid, target))
  on('ai:grant-consent', async (pid: string, target: AiConsentTarget) => {
    await rootOf(pid)
    if (target?.runtime === 'antigravity-cli') await googleConsent.grantConsent(pid, target)
    else await (await acc()).grantConsent(pid, target)
  })
  on('auth:list', async () => (await acc()).listProviders())
  on('auth:set-key', async (providerId: string, key: string) => {
    try { await (await acc()).setApiKey(providerId, key) } finally { agent.selectionChanged() }
  })
  on('auth:remove-key', async (providerId: string) => {
    try { await (await acc()).removeApiKey(providerId) } finally { agent.selectionChanged() }
  })
  on('auth:save-custom', async (p: Parameters<AccountService['saveCustomProvider']>[0], apiKey?: string) => {
    try { await (await acc()).saveCustomProvider(p, apiKey) } finally { agent.selectionChanged() }
  })
  on('auth:remove-custom', async (id: string) => {
    await (await acc()).removeCustomProvider(id)
    agent.selectionChanged()
  })
  on('auth:login', async (providerId: string) => {
    try { await (await acc()).loginOAuth(providerId) } finally { agent.selectionChanged() }
  })
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
  on('auth:logout', async (providerId: string) => {
    agent.selectionChanged()
    try { await (await acc()).logout(providerId) } finally { agent.selectionChanged() }
  })
  on('auth:forget-registration', async () => {
    try { await (await acc()).forgetOpenAiRegistration() } finally { agent.selectionChanged() }
  })
  on('auth:models', async () => {
    const results = await Promise.allSettled([(async () => (await acc()).listModels())(), google.models()])
    return results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
  })
  on('auth:select-model', async (provider: string, id: string) => {
    if (provider === 'google-antigravity') {
      if (!geminiEnabled()) throw new AgentError('ai_not_configured', 'Kết nối và kiểm tra Gemini qua mục Tài khoản Google trước khi dùng.')
      const version = runtimeVersion
      const identity = google.connectionIdentity()
      agent.selectionChanged()
      await google.selectModel(id)
      const status = await google.status()
      if (!geminiEnabled() || version !== runtimeVersion || identity !== google.connectionIdentity() || status.connectionId !== identity || status.model !== id || !status.authenticated)
        throw new AgentError('ai_not_configured', 'Kết nối Google đã thay đổi. Hãy kiểm tra lại kết nối Gemini.')
      selectRuntime('antigravity-cli')
    } else {
      (await acc()).selectModel(provider, id)
      selectRuntime('pi')
    }
  })
  on('auth:test', async () => selectedRuntime() === 'antigravity-cli' ? googleAgent.testConnection() : (await acc()).test())
  on('auth:discover-local', async (baseUrl?: string) => (await acc()).discoverLocal(baseUrl))
  on('auth:connect-local', async (baseUrl: string, modelId: string) => {
    try { await (await acc()).connectLocal(baseUrl, modelId); selectRuntime('pi') } finally { agent.selectionChanged() }
  })
  // EngineApi đọc baseUrl/token mỗi lần gọi nên theo kịp engine khởi động lại.
  const liveApi = new EngineApi({ get baseUrl() { return handle().baseUrl }, get token() { return handle().token } })
  const editorStates = (editors = new EditorStateRegistry(rootOf))
  const piAgent = new AgentService({
    api: liveApi, dataDir,
    accounts: acc,
    rootOf,
    editorState: (projectId) => editorStates.get(projectId),
    emit: (projectId, event) => win()?.webContents.send('agent:event', { projectId, event })
  })
  const googleAgent = new GeminiAgentService({
    api: liveApi, dataDir, rootOf, connection: google,
    consentTarget: () => geminiEnabled() ? googleTarget() : null,
    hasConsent: (pid, target) => googleConsent.hasConsent(pid, target),
    editorState: (pid) => editorStates.get(pid),
    emit: (projectId, event) => win()?.webContents.send('agent:event', { projectId, event })
  })
  const agent = (agents = new AgentRouter(piAgent, googleAgent, selectedRuntime))
  const probeKey = () => JSON.stringify([google.connectionIdentity(), google.selectedModel()])
  on('gemini:status', () => google.status())
  on('gemini:setup', () => google.setup())
  on('gemini:login', async () => {
    agent.selectionChanged(); invalidateGoogleProbe()
    if (selectedRuntime() === 'antigravity-cli') selectRuntime('antigravity-cli', false)
    return google.login()
  })
  on('gemini:login-cancel', async () => { invalidateGoogleProbe(); google.cancelLogin() })
  on('gemini:disconnect', async () => {
    agent.selectionChanged(); invalidateGoogleProbe()
    if (selectedRuntime() === 'antigravity-cli') selectRuntime('antigravity-cli', false)
    await google.disconnect()
  })
  on('gemini:forget', async () => {
    agent.selectionChanged(); invalidateGoogleProbe()
    if (selectedRuntime() === 'antigravity-cli') selectRuntime('antigravity-cli', false)
    await google.forget()
  })
  on('gemini:models', () => google.models())
  on('gemini:select-model', async (id: string) => { agent.selectionChanged(); invalidateGoogleProbe(); await google.selectModel(id) })
  on('gemini:test', async () => {
    invalidateGoogleProbe()
    const version = googleProbeVersion
    const key = probeKey()
    const result = await googleAgent.testConnection()
    if (version === googleProbeVersion)
      googleProbe = result.ok && result.capabilities?.streaming === true && result.capabilities.tools === true && key === probeKey() ? key : null
    return result
  })
  on('gemini:activate', async () => {
    const key = probeKey()
    const version = runtimeVersion
    const probeVersion = googleProbeVersion
    const status = await google.status()
    if (googleProbe !== key || key !== probeKey() || version !== runtimeVersion || probeVersion !== googleProbeVersion || !status.authenticated || status.connectionId !== google.connectionIdentity() || status.model !== google.selectedModel())
      throw new AgentError('ai_not_configured', 'Kiểm tra kết nối và công cụ thành công trước khi dùng Gemini.')
    selectRuntime('antigravity-cli')
  })
  on('agent:prompt', async (pid: string, text: string, target: AiConsentTarget, options?: AgentPromptOptions) => {
    await editorStates.wait(pid)
    return agent.prompt(pid, text, target, options)
  })
  on('agent:abort', (pid: string) => agent.abort(pid))
  on('agent:set-mode', async (pid: string, mode: AgentMode) => {
    if (!['ask', 'plan', 'edit'].includes(mode)) throw new AgentError('bad_param', 'Chế độ trợ lý không hợp lệ')
    await rootOf(pid)
    return agent.setMode(pid, mode)
  })
  on('agent:get-mode', async (pid: string) => agent.getMode(pid))
  on('agent:approve', async (pid: string, id: string, allow: boolean) => {
    if (allow === true) await editorStates.wait(pid)
    return agent.approve(pid, id, allow === true)
  })
  on('agent:close', async (pid: string) => {
    editorStates.clear(pid)
    return agent.close(pid)
  })
  on('agent:snapshot', (pid: string) => agent.snapshot(pid))
  on('agent:list-sessions', (pid: string) => agent.listSessions(pid))
  on('agent:new-session', (pid: string) => agent.newSession(pid))
  on('agent:switch-session', (pid: string, sessionId: string) => agent.switchSession(pid, sessionId))
  on('agent:rename-session', (pid: string, sessionId: string, title: string) => agent.renameSession(pid, sessionId, title))
  on('agent:delete-session', (pid: string, sessionId: string) => agent.deleteSession(pid, sessionId))
  on('agent:set-execution', async (pid: string, settings: AgentExecutionSettings) => {
    await rootOf(pid)
    return agent.setExecution(pid, settings)
  })
  on('agent:get-execution', async (pid: string) => agent.getExecution(pid))
  on('agent:set-limits', async (pid: string, limits: AgentRunLimits) => {
    await rootOf(pid)
    return agent.setLimits(pid, limits)
  })
  on('agent:get-limits', async (pid: string) => agent.getLimits(pid))
  on('agent:project-commands', async (pid: string) => detectProjectCommands(await rootOf(pid)))
  on('agent:checkpoints', (pid: string, taskId: string) => agent.checkpoints(pid, taskId))
  on('agent:rollback', async (pid: string, taskId: string) => {
    await editorStates.wait(pid)
    return agent.rollback(pid, taskId)
  })
  on('agent:editor-state', (pid: string, states: AgentEditorState[]) => editorStates.update(pid, states))

  on('export:pick-dir', async (pid: string) => {
    await rootOf(pid) // chỉ dự án đã đăng ký mới có thể chọn thư mục xuất
    const win = getWindow()
    const opts = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      title: 'Chọn thư mục lưu kết quả xuất',
      defaultPath: savedExportDir(pid) ?? app.getPath('downloads')
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return null
    const file = prefsFile()
    writeJson(file, { ...readJson(file), [exportDirKey(pid)]: r.filePaths[0] })
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
  on('hook:preview', async (pid: string) => hookPreview(await rootOf(pid), getCommand(), dataDir))
  on('hook:install', async (pid: string) => installHook(await rootOf(pid), getCommand(), dataDir))
  on('hook:uninstall', async (pid: string) => uninstallHook(await rootOf(pid)))
  on('mcp:plan', async (agent: AgentId, pid: string, opts?: IntegrationOptions) => planPlatform(agent, await rootOf(pid), getCommand(), dataDir, opts))
  on('mcp:apply', async (agent: AgentId, pid: string, opts?: IntegrationOptions) => applyPlatform(agent, await rootOf(pid), getCommand(), dataDir, opts))
  on('mcp:plan-remove', async (agent: AgentId, pid: string) => planUninstall(agent, await rootOf(pid), getCommand(), dataDir))
  on('mcp:remove', async (agent: AgentId, pid: string) => applyUninstall(agent, await rootOf(pid), getCommand(), dataDir))
  on('mcp:start-http', async (pid: string) => {
    const version = removalVersions.get(pid)
    const root = await rootOf(pid)
    if (removalVersions.get(pid) !== version) throw new EngineApiError(404, 'unknown_project', 'Đăng ký dự án đã thay đổi.')
    return mcp.start(pid, root)
  })
  on('mcp:stop-http', (pid: string) => mcp.stop(pid))
  on('mcp:http-status', async (pid: string) => mcp.status(pid))

  // Nguồn ngoài thư mục (W6): engine kiểm URL (chỉ GitHub/GitLab khi clone; guard SSRF khi tải).
  on('sources:clone', async (url: string) => ({ jobId: (await api().cloneProject(url)).job_id }))
  on('sources:list', (pid: string) => api().listSources(pid))
  on('sources:add', async (pid: string, url: string) => ({ jobId: (await api().addSource(pid, url)).job_id }))
  on('sources:remove', (pid: string, name: string) => api().removeSource(pid, name))

  // Bộ nhớ làm việc (W10): mọi ghi đi qua engine, engine giữ khoá ghi của dự án.
  on('memory:recall', (pid: string, q: { node?: string; q?: string }) => api().recallMemory(pid, q))
  on('memory:add', (pid: string, kind: MemoryKind, text: string, nodeIds: string[]) => api().addMemory(pid, kind, text, nodeIds))
  on('memory:rate', (pid: string, rating: AnswerRating) => api().rateAnswer(pid, rating))
  on('memory:lessons', (pid: string) => api().lessons(pid))
  // Graph chung nhiều repo (W8): thư mục xuất chọn ở main, renderer không gửi path.
  on('global:list', () => api().globalList())
  on('global:add', async (pid: string) => ({ jobId: (await api().globalAdd(pid)).job_id }))
  on('global:remove', (pid: string) => api().globalRemove(pid))
  on('global:search', (q: string, limit?: number, pids?: string[]) => api().globalSearch(q, limit, pids))
  on('global:graph', (pids: string[], limit?: number) => api().globalGraph(pids, limit))
  on('global:export', async (pids: string[]) => {
    const win = getWindow()
    const opts = {
      properties: ['openDirectory' as const, 'createDirectory' as const],
      title: 'Chọn thư mục lưu graph.json gộp',
      defaultPath: app.getPath('downloads')
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    return api().globalExport(pids, r.filePaths[0])
  })
  // Pull request (W7): engine gọi `gh` chỉ đọc; số PR được engine kiểm lại.
  on('prs:status', (pid: string) => api().prStatus(pid))
  on('prs:list', (pid: string) => api().listPrs(pid))
  on('prs:detail', (pid: string, n: number) => api().prDetail(pid, n))
  // Phân tích ngữ nghĩa bằng AI (W9). Mặc định tắt theo dự án; key chỉ đọc ở đây và chỉ đi xuống engine ở đường B.
  const semanticRuns = new Map<string, AbortController>()
  on('semantic:get-settings', (pid: string) => api().aiSettings(pid))
  on('semantic:set-settings', async (pid: string, settings: ProjectAiSettings) => {
    await rootOf(pid)
    const transport = settings?.transport === 'direct' || settings?.transport === 'app' ? settings.transport : null
    const model = transport ? selectedModelLabel(await acc()) : null
    return api().setAiSettings(pid, { enabled: settings?.enabled === true, transport, model })
  })
  on('semantic:estimate', (pid: string, target: SemanticTarget) => api().semanticEstimate(pid, target))
  on('semantic:start', async (pid: string, target: SemanticTarget, budget?: number) => {
    const settings = await api().aiSettings(pid)
    if (!settings.enabled) throw new AgentError('ai_disabled', 'Chưa bật phân tích bằng AI cho dự án này.')
    const a = await acc()
    const max = Number.isFinite(budget) && budget! > 0 ? Math.floor(budget!) : 1_000_000
    const transport = settings.transport === 'direct' ? await directTransport(a) : { kind: 'app' as const, model_label: selectedModelLabel(a) }
    const jobId = (await api().startSemantic(pid, { targets: target, transport, max_tokens_budget: max })).job_id
    if (transport.kind === 'app') {
      const ac = new AbortController()
      semanticRuns.set(jobId, ac)
      void runSemanticJob(jobId, {
        jobState: async (id) => (await api().getJob(id)).state,
        next: (id) => api().llmNext(id),
        answer: (id, chunkId, body) => api().llmAnswer(id, chunkId, body)
      }, piComplete(a), { signal: ac.signal, budget: max })
        .catch((e) => console.warn(`[semantic] ${jobId}: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => semanticRuns.delete(jobId))
    }
    return { jobId }
  })
  on('semantic:cancel', async (jobId: string) => {
    semanticRuns.get(jobId)?.abort()
    await api().cancelJob(jobId)
  })
}
