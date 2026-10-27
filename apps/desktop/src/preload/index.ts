import { contextBridge, ipcRenderer } from 'electron'
import type { NexGraphApi } from '../shared/api'
import type { EngineStatus } from '../shared/engine-status'
import type { EngineEvent } from '../shared/graph-types'

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!r.ok) throw Object.assign(new Error(r.error.message), { code: r.error.code })
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
    onStatus: (cb) => subscribe<EngineStatus>('engine:status-changed', cb)
  },
  project: {
    pickFolder: () => call('project:pick-folder'),
    open: (path) => call('project:open', path),
    list: () => call('project:list')
  },
  index: {
    start: (projectId) => call('index:start', projectId),
    cancel: (jobId) => call('index:cancel', jobId),
    onEvent: (cb) => subscribe<EngineEvent>('engine:event', cb)
  },
  graph: {
    stats: (pid) => call('graph:stats', pid),
    neighbors: (pid, q) => call('graph:neighbors', pid, q),
    node: (pid, id) => call('graph:node', pid, id),
    code: (pid, file, start, end) => call('graph:code', pid, file, start, end)
  }
}

contextBridge.exposeInMainWorld('nexgraph', api)
