import { contextBridge, ipcRenderer } from 'electron'
import type { NexGraphApi } from '../shared/api'
import type { EngineStatus } from '../shared/engine-status'
import type { EngineEvent } from '../shared/graph-types'

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  // contextBridge chỉ chuyển `message` của Error và làm mất thuộc tính khác, nên lỗi phải là đối tượng thường có `code`.
  if (!r.ok) throw { name: 'EngineError', code: r.error.code, message: r.error.message }
  return r.data
}

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: NexGraphApi = {
  engine: {
    status: () => ipcRenderer.invoke('engine:status'),
    restart: () => ipcRenderer.invoke('engine:restart'),
    tools: () => call('engine:tools'),
    onStatus: (cb) => subscribe<EngineStatus>('engine:status-changed', cb)
  },
  project: {
    pickFolder: () => call('project:pick-folder'),
    open: (path) => call('project:open', path),
    list: () => call('project:list')
  },
  index: {
    scan: (projectId) => call('index:scan', projectId),
    start: (projectId, opts) => call('index:start', projectId, opts),
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
    paths: (pid, nodeIds, opts) => call('graph:paths', pid, nodeIds, opts),
    impactOf: (pid, nodeId) => call('graph:impact-of', pid, nodeId),
    ask: (pid, question, opts) => call('graph:ask', pid, question, opts),
    recluster: (pid) => call('graph:recluster', pid),
    flows: (pid, opts) => call('graph:flows', pid, opts),
    flow: (pid, flowId) => call('graph:flow', pid, flowId),
    locate: (pid, file, line) => call('graph:locate', pid, file, line),
    context: (pid, q, budget) => call('graph:context', pid, q, budget),
    map: (pid, opts) => call('graph:map', pid, opts),
    cycles: (pid, limit) => call('graph:cycles', pid, limit)
  },
  exporter: {
    pickDir: () => call('export:pick-dir'),
    run: (pid, format, scope, outDir) => call('export:run', pid, format, scope, outDir),
    push: (pid, req) => call('export:push', pid, req),
    png: (rect) => call('export:png', rect),
    reveal: (path) => call('export:reveal', path)
  },
  mcp: {
    config: (projectPath) => call('mcp:config', projectPath),
    startHttp: (pid, projectPath) => call('mcp:start-http', pid, projectPath),
    stopHttp: (pid) => call('mcp:stop-http', pid),
    httpStatus: (pid) => call('mcp:http-status', pid)
  },
  watch: {
    start: (pid, path) => call('watch:start', pid, path),
    stop: (pid) => call('watch:stop', pid)
  }
}

contextBridge.exposeInMainWorld('nexgraph', api)
