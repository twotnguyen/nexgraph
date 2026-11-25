import { contextBridge, ipcRenderer } from 'electron'
import type { AppMenuAction, NexGraphApi } from '../shared/api'
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
  file: { pickOpen: (projectId) => call('file:pick-open', projectId) },
  window: { openNew: () => call('window:open-new') },
  menu: { onAction: (cb) => subscribe<AppMenuAction>('app-menu:action', cb), setLocale: (locale) => call('app-menu:set-locale', locale) },
  licenses: { read: () => call('licenses:read') },
  app: { version: () => call('app:version') },
  index: {
    scan: (projectId) => call('index:scan', projectId),
    start: (projectId, opts) => call('index:start', projectId, opts),
    options: (projectId) => call('index:options', projectId),
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
    report: (pid, lang) => call('graph:report', pid, lang),
    explain: (pid, nodeId) => call('graph:explain', pid, nodeId),
    section: (pid, nodeId) => call('graph:section', pid, nodeId),
    paths: (pid, nodeIds, opts) => call('graph:paths', pid, nodeIds, opts),
    impactOf: (pid, nodeId) => call('graph:impact-of', pid, nodeId),
    ask: (pid, question, opts) => call('graph:ask', pid, question, opts),
    recluster: (pid) => call('graph:recluster', pid),
    flows: (pid, opts) => call('graph:flows', pid, opts),
    flow: (pid, flowId) => call('graph:flow', pid, flowId),
    tour: (pid, lang) => call('graph:tour', pid, lang),
    locate: (pid, file, line) => call('graph:locate', pid, file, line),
    context: (pid, q, budget) => call('graph:context', pid, q, budget),
    map: (pid, opts) => call('graph:map', pid, opts),
    cycles: (pid, limit) => call('graph:cycles', pid, limit)
  },
  fs: {
    list: (pid, directory) => call('fs:list', pid, directory),
    read: (pid, relPath) => call('fs:read', pid, relPath),
    readBinary: (pid, relPath) => call('fs:read-binary', pid, relPath),
    files: (pid) => call('fs:files', pid),
    write: (pid, relPath, text, opts) => call('fs:write', pid, relPath, text, opts),
    createFile: (pid, path) => call('fs:create-file', pid, path),
    createDir: (pid, path) => call('fs:create-dir', pid, path),
    rename: (pid, from, to) => call('fs:rename', pid, from, to),
    copy: (pid, from, directory) => call('fs:copy', pid, from, directory),
    trash: (pid, path) => call('fs:trash', pid, path),
    reveal: (pid, path) => call('fs:reveal', pid, path),
    searchText: (pid, query) => call('fs:search-text', pid, query),
    replaceText: (pid, query, replacement, files) => call('fs:replace-text', pid, query, replacement, files)
  },
  lsp: {
    definition: (pid, file, text, line, column) => call('lsp:definition', pid, file, text, line, column),
    declaration: (pid, file, text, line, column) => call('lsp:declaration', pid, file, text, line, column),
    typeDefinition: (pid, file, text, line, column) => call('lsp:type-definition', pid, file, text, line, column),
    completion: (pid, file, text, line, column) => call('lsp:completion', pid, file, text, line, column),
    hover: (pid, file, text, line, column) => call('lsp:hover', pid, file, text, line, column),
    references: (pid, file, text, line, column) => call('lsp:references', pid, file, text, line, column),
    implementation: (pid, file, text, line, column) => call('lsp:implementation', pid, file, text, line, column),
    rename: (pid, file, text, line, column, newName) => call('lsp:rename', pid, file, text, line, column, newName),
    format: (pid, file, text, options) => call('lsp:format', pid, file, text, options),
    documentSymbols: (pid, file, text) => call('lsp:document-symbols', pid, file, text),
    callHierarchyPrepare: (pid, file, text, line, column) => call('lsp:call-hierarchy-prepare', pid, file, text, line, column),
    callHierarchyIncoming: (pid, file, text, line, column, item) => call('lsp:call-hierarchy-incoming', pid, file, text, line, column, item),
    callHierarchyOutgoing: (pid, file, text, line, column, item) => call('lsp:call-hierarchy-outgoing', pid, file, text, line, column, item),
    workspaceSymbols: (pid, query) => call('lsp:workspace-symbols', pid, query),
    signatureHelp: (pid, file, text, line, column) => call('lsp:signature-help', pid, file, text, line, column),
    codeActions: (pid, file, text, range) => call('lsp:code-actions', pid, file, text, range),
    onDiagnostics: (cb) => subscribe('lsp:diagnostics', cb),
    close: (pid, file) => call('lsp:close', pid, file),
    open: (pid, file, text) => call('lsp:open', pid, file, text)
  },
  terminal: {
    create: (pid, cols, rows, task) => call('terminal:create', pid, cols, rows, task),
    write: (id, data) => call('terminal:write', id, data),
    resize: (id, cols, rows) => call('terminal:resize', id, cols, rows),
    kill: (id) => call('terminal:kill', id),
    resolvePath: (pid, path) => call('terminal:resolve-path', pid, path),
    onEvent: (cb) => subscribe('terminal:event', cb)
  },
  tasks: {
    list: (pid) => call('tasks:list', pid),
    configFile: (pid) => call('tasks:config-file', pid),
    resolve: (pid, task, context) => call('tasks:resolve', pid, task, context)
  },
  git: {
    status: (pid) => call('git:status', pid),
    stage: (pid, files) => call('git:stage', pid, files),
    unstage: (pid, files) => call('git:unstage', pid, files),
    commit: (pid, message, amend, coAuthors) => call('git:commit', pid, message, amend, coAuthors),
    diff: (pid, file, staged, base) => call('git:diff', pid, file, staged, base),
    blame: (pid, file) => call('git:blame', pid, file),
    restore: (pid, file) => call('git:restore', pid, file),
    branches: (pid) => call('git:branches', pid),
    switchBranch: (pid, name, create) => call('git:switch-branch', pid, name, create),
    remote: (pid, op) => call('git:remote', pid, op),
    history: (pid, all) => call('git:history', pid, all),
    commitFiles: (pid, sha) => call('git:commit-files', pid, sha),
    commitDiff: (pid, sha, file, from) => call('git:commit-diff', pid, sha, file, from),
    hunks: (pid, file, staged) => call('git:hunks', pid, file, staged),
    applyHunk: (pid, file, staged, id) => call('git:apply-hunk', pid, file, staged, id),
    stashes: (pid) => call('git:stashes', pid),
    stashSave: (pid, message) => call('git:stash-save', pid, message),
    stashAction: (pid, ref, action) => call('git:stash-action', pid, ref, action),
    suggestMessage: (pid) => call('git:suggest-message', pid),
    worktrees: (pid) => call('git:worktrees', pid),
    worktreeAdd: (pid, branch, existing) => call('git:worktree-add', pid, branch, existing),
    worktreeRemove: (pid, path) => call('git:worktree-remove', pid, path),
    permalink: (pid, file, start, end, text) => call('git:permalink', pid, file, start, end, text)
  },
  debug: {
    adapterStatus: () => call('debug:adapter-status'),
    installAdapter: (kind) => call('debug:install-adapter', kind),
    start: (pid, kind, file, breakpoints) => call('debug:start', pid, kind, file, breakpoints),
    configs: (pid) => call('debug:configs', pid),
    configFile: (pid) => call('debug:config-file', pid),
    startConfig: (pid, config, file, breakpoints) => call('debug:start-config', pid, config, file, breakpoints),
    attach: (pid, kind, host, port, breakpoints) => call('debug:attach', pid, kind, host, port, breakpoints),
    setBreakpoints: (file, points) => call('debug:set-breakpoints', file, points),
    step: (action, threadId) => call('debug:step', action, threadId),
    pause: () => call('debug:pause'),
    restart: () => call('debug:restart'),
    evaluate: (expression, frameId, context) => call('debug:evaluate', expression, frameId, context),
    stackTrace: (threadId) => call('debug:stack-trace', threadId),
    scopes: (frameId) => call('debug:scopes', frameId),
    variables: (ref) => call('debug:variables', ref),
    modules: () => call('debug:modules'),
    loadedSources: () => call('debug:loaded-sources'),
    stop: () => call('debug:stop'),
    onEvent: (cb) => subscribe('debug:event', cb)
  },
  collab: {
    host: (hello) => call('collab:host', hello),
    join: (address, code) => call('collab:join', address, code),
    send: (data) => call('collab:send', data),
    stop: () => call('collab:stop'),
    onEvent: (cb) => subscribe('collab:event', cb)
  },
  extensions: {
    list: () => call('extensions:list'),
    install: () => call('extensions:install'),
    remove: (id) => call('extensions:remove', id)
  },
  exporter: {
    pickDir: (pid) => call('export:pick-dir', pid),
    run: (pid, format, scope, lang) => call('export:run', pid, format, scope, lang),
    push: (pid, req) => call('export:push', pid, req),
    png: (pid, rect) => call('export:png', pid, rect),
    reveal: (pid, path) => call('export:reveal', pid, path)
  },
  hook: {
    status: (pid) => call('hook:status', pid),
    preview: (pid) => call('hook:preview', pid),
    install: (pid) => call('hook:install', pid),
    uninstall: (pid) => call('hook:uninstall', pid),
    branch: (pid) => call('hook:branch', pid)
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
    onPrompt: (cb) => subscribe<AuthPromptView>('auth:login-prompt', cb),
    onNotice: (cb) => subscribe<{ message: string }>('auth:notice', cb),
    onModelsChanged: (cb) => subscribe<{ providerId: string }>('auth:models-changed', cb)
  },
  agent: {
    prompt: (pid, text, target, options) => call('agent:prompt', pid, text, target, options),
    abort: (pid) => call('agent:abort', pid),
    setMode: (pid, mode) => call('agent:set-mode', pid, mode),
    getMode: (pid) => call('agent:get-mode', pid),
    setDisabledTools: (pid, tools) => call('agent:set-disabled-tools', pid, tools),
    getDisabledTools: (pid) => call('agent:get-disabled-tools', pid),
    toolNames: () => call('agent:tool-names'),
    approve: (pid, id, allow) => call('agent:approve', pid, id, allow),
    close: (pid) => call('agent:close', pid),
    snapshot: (pid) => call('agent:snapshot', pid),
    listSessions: (pid) => call('agent:list-sessions', pid),
    newSession: (pid) => call('agent:new-session', pid),
    forkSession: (pid, sessionId) => call('agent:fork-session', pid, sessionId),
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
    notify: (title, body) => call('agent:notify', title, body),
    onEvent: (cb) => subscribe<{ projectId: string; event: AgentEvent }>('agent:event', (v) => cb(v.projectId, v.event))
  },
  mcp: {
    config: (pid) => call('mcp:config', pid),
    plan: (agent, pid, opts) => call('mcp:plan', agent, pid, opts),
    apply: (agent, pid, opts) => call('mcp:apply', agent, pid, opts),
    planRemove: (agent, pid) => call('mcp:plan-remove', agent, pid),
    remove: (agent, pid) => call('mcp:remove', agent, pid),
    startHttp: (pid) => call('mcp:start-http', pid),
    stopHttp: (pid) => call('mcp:stop-http', pid),
    httpStatus: (pid) => call('mcp:http-status', pid)
  },
  watch: {
    start: (pid) => call('watch:start', pid),
    stop: (pid) => call('watch:stop', pid),
    onError: (cb) => subscribe('watch:error', cb),
    onRecovered: (cb) => subscribe('watch:ok', cb)
  },
  sources: {
    clone: (url) => call('sources:clone', url),
    list: (pid) => call('sources:list', pid),
    add: (pid, url) => call('sources:add', pid, url),
    remove: (pid, name) => call('sources:remove', pid, name)
  },
  indexSources: {
    hasDsn: (pid) => call('index-sources:has-dsn', pid),
    saveDsn: (pid, dsn) => call('index-sources:save-dsn', pid, dsn),
    pickFile: (kind) => call('index-sources:pick-file', kind),
    remembered: (pid) => call('index-sources:remembered', pid)
  },
  memory: {
    recall: (pid, q) => call('memory:recall', pid, q),
    add: (pid, kind, text, nodeIds) => call('memory:add', pid, kind, text, nodeIds),
    rate: (pid, rating) => call('memory:rate', pid, rating),
    lessons: (pid) => call('memory:lessons', pid)
  },
  globalGraph: {
    list: () => call('global:list'),
    add: (pid) => call('global:add', pid),
    remove: (pid) => call('global:remove', pid),
    search: (q, limit, pids) => call('global:search', q, limit, pids),
    graph: (pids, limit) => call('global:graph', pids, limit),
    export: (pids) => call('global:export', pids)
  },
  prs: {
    status: (pid) => call('prs:status', pid),
    list: (pid) => call('prs:list', pid),
    detail: (pid, n) => call('prs:detail', pid, n)
  },
  semantic: {
    getSettings: (pid) => call('semantic:get-settings', pid),
    setSettings: (pid, settings) => call('semantic:set-settings', pid, settings),
    estimate: (pid, target, noCache) => call('semantic:estimate', pid, target, noCache),
    start: (pid, target, budget, noCache) => call('semantic:start', pid, target, budget, noCache),
    usage: (jobId) => call('semantic:usage', jobId),
    cancel: (jobId) => call('semantic:cancel', jobId)
  }
}

contextBridge.exposeInMainWorld('nexgraph', api)
