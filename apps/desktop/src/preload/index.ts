import { contextBridge, ipcRenderer } from 'electron'
import type { NexGraphApi } from '../shared/api'
import type { EngineStatus } from '../shared/engine-status'
import type { EngineEvent } from '../shared/graph-types'
import type { AgentEvent, AuthEventView, AuthPromptView } from '../shared/agent-types'

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  // Giữ prototype Error để `instanceof Error` đúng, đồng thời giữ các thuộc tính own (name/code/message)
  // vì contextBridge chỉ chuyển message của Error thật và làm mất thuộc tính tuỳ biến.
  if (!r.ok) throw Object.assign(Object.create(Error.prototype) as Error, { name: 'EngineError', code: r.error.code, message: r.error.message })
  return r.data
}

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: NexGraphApi = {
  gemini: {
    status: () => call('gemini:status'),
    setup: () => call('gemini:setup'),
    login: () => call('gemini:login'),
    loginCancel: () => call('gemini:login-cancel'),
    disconnect: () => call('gemini:disconnect'),
    forget: () => call('gemini:forget'),
    activate: () => call('gemini:activate'),
    models: () => call('gemini:models'),
    selectModel: (id) => call('gemini:select-model', id),
    test: () => call('gemini:test'),
    onEvent: (cb) => subscribe('gemini:event', cb)
  },
  engine: {
    status: () => ipcRenderer.invoke('engine:status'),
    restart: () => ipcRenderer.invoke('engine:restart'),
    tools: () => call('engine:tools'),
    onStatus: (cb) => subscribe<EngineStatus>('engine:status-changed', cb)
  },
  project: {
    pickFolder: () => call('project:pick-folder'),
    open: (path) => call('project:open', path),
    list: () => call('project:list'),
    remove: (pid) => call('project:remove', pid)
  },
  index: {
    scan: (projectId) => call('index:scan', projectId),
    start: (projectId, opts) => call('index:start', projectId, opts),
    status: (jobId) => call('index:status', jobId),
    cancel: (jobId) => call('index:cancel', jobId),
    refresh: (projectId) => call('index:refresh', projectId),
    onEvent: (cb) => subscribe<EngineEvent>('engine:event', cb)
  },
  graph: {
    stats: (pid) => call('graph:stats', pid),
    neighbors: (pid, q) => call('graph:neighbors', pid, q),
    node: (pid, id) => call('graph:node', pid, id),
    code: (pid, file, start, end) => call('graph:code', pid, file, start, end),
    search: (pid, q, opts) => call('graph:search', pid, q, opts),
    architecture: (pid, parent) => call('graph:architecture', pid, parent),
    archEvidence: (pid, from, to, limit) => call('graph:arch-evidence', pid, from, to, limit),
    changes: (pid, opts) => call('graph:changes', pid, opts),
    report: (pid) => call('graph:report', pid),
    explain: (pid, nodeId) => call('graph:explain', pid, nodeId),
    section: (pid, nodeId) => call('graph:section', pid, nodeId),
    paths: (pid, nodeIds, opts) => call('graph:paths', pid, nodeIds, opts),
    impactOf: (pid, nodeId) => call('graph:impact-of', pid, nodeId),
    ask: (pid, question, opts) => call('graph:ask', pid, question, opts),
    recluster: (pid) => call('graph:recluster', pid),
    flows: (pid, opts) => call('graph:flows', pid, opts),
    flow: (pid, flowId) => call('graph:flow', pid, flowId),
    tour: (pid) => call('graph:tour', pid),
    locate: (pid, file, line) => call('graph:locate', pid, file, line),
    context: (pid, q, budget) => call('graph:context', pid, q, budget),
    map: (pid, opts) => call('graph:map', pid, opts),
    cycles: (pid, limit) => call('graph:cycles', pid, limit)
  },
  fs: {
    list: (pid, directory) => call('fs:list', pid, directory),
    read: (pid, relPath) => call('fs:read', pid, relPath),
    write: (pid, relPath, text, opts) => call('fs:write', pid, relPath, text, opts)
  },
  exporter: {
    pickDir: (pid) => call('export:pick-dir', pid),
    run: (pid, format, scope) => call('export:run', pid, format, scope),
    push: (pid, req) => call('export:push', pid, req),
    png: (rect) => call('export:png', rect),
    reveal: (pid, path) => call('export:reveal', pid, path)
  },
  hook: {
    status: (pid) => call('hook:status', pid),
    preview: (pid) => call('hook:preview', pid),
    install: (pid) => call('hook:install', pid),
    uninstall: (pid) => call('hook:uninstall', pid)
  },
  ai: {
    getSettings: () => call('ai:get-settings'),
    hasConsent: (pid, target) => call('ai:has-consent', pid, target),
    grantConsent: (pid, target) => call('ai:grant-consent', pid, target)
  },
  auth: {
    list: () => call('auth:list'),
    setKey: (providerId, key) => call('auth:set-key', providerId, key),
    removeKey: (providerId) => call('auth:remove-key', providerId),
    saveCustom: (p, apiKey) => call('auth:save-custom', p, apiKey),
    removeCustom: (id) => call('auth:remove-custom', id),
    login: (providerId) => call('auth:login', providerId),
    loginCancel: () => call('auth:login-cancel'),
    promptReply: (id, value) => call('auth:prompt-reply', id, value),
    logout: (providerId) => call('auth:logout', providerId),
    forgetRegistration: () => call('auth:forget-registration'),
    models: () => call('auth:models'),
    selectModel: (provider, id) => call('auth:select-model', provider, id),
    test: () => call('auth:test'),
    discoverLocal: (baseUrl) => call('auth:discover-local', baseUrl),
    connectLocal: (baseUrl, modelId) => call('auth:connect-local', baseUrl, modelId),
    onEvent: (cb) => subscribe<AuthEventView>('auth:login-event', cb),
    onPrompt: (cb) => subscribe<AuthPromptView>('auth:login-prompt', cb)
  },
  agent: {
    prompt: (pid, text, target, options) => call('agent:prompt', pid, text, target, options),
    abort: (pid) => call('agent:abort', pid),
    setMode: (pid, mode) => call('agent:set-mode', pid, mode),
    getMode: (pid) => call('agent:get-mode', pid),
    approve: (pid, id, allow) => call('agent:approve', pid, id, allow),
    close: (pid) => call('agent:close', pid),
    snapshot: (pid) => call('agent:snapshot', pid),
    listSessions: (pid) => call('agent:list-sessions', pid),
    newSession: (pid) => call('agent:new-session', pid),
    switchSession: (pid, sessionId) => call('agent:switch-session', pid, sessionId),
    renameSession: (pid, sessionId, title) => call('agent:rename-session', pid, sessionId, title),
    deleteSession: (pid, sessionId) => call('agent:delete-session', pid, sessionId),
    setExecution: (pid, settings) => call('agent:set-execution', pid, settings),
    getExecution: (pid) => call('agent:get-execution', pid),
    setLimits: (pid, limits) => call('agent:set-limits', pid, limits),
    getLimits: (pid) => call('agent:get-limits', pid),
    projectCommands: (pid) => call('agent:project-commands', pid),
    checkpoints: (pid, taskId) => call('agent:checkpoints', pid, taskId),
    rollback: (pid, taskId) => call('agent:rollback', pid, taskId),
    editorState: (pid, states) => call('agent:editor-state', pid, states),
    onEvent: (cb) => subscribe<{ projectId: string; event: AgentEvent }>('agent:event', (v) => cb(v.projectId, v.event))
  },
  mcp: {
    config: (pid) => call('mcp:config', pid),
    plan: (agent, pid) => call('mcp:plan', agent, pid),
    apply: (agent, pid) => call('mcp:apply', agent, pid),
    startHttp: (pid) => call('mcp:start-http', pid),
    stopHttp: (pid) => call('mcp:stop-http', pid),
    httpStatus: (pid) => call('mcp:http-status', pid)
  },
  watch: {
    start: (pid) => call('watch:start', pid),
    stop: (pid) => call('watch:stop', pid)
  },
  sources: {
    clone: (url) => call('sources:clone', url),
    list: (pid) => call('sources:list', pid),
    add: (pid, url) => call('sources:add', pid, url),
    remove: (pid, name) => call('sources:remove', pid, name)
  }
}

contextBridge.exposeInMainWorld('nexgraph', api)
