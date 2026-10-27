import { contextBridge, ipcRenderer } from 'electron'
import type { NexGraphApi } from '../shared/api'
import type { EngineStatus } from '../shared/engine-status'

const api: NexGraphApi = {
  engine: {
    status: () => ipcRenderer.invoke('engine:status'),
    restart: () => ipcRenderer.invoke('engine:restart'),
    onStatus(cb) {
      const listener = (_e: unknown, s: EngineStatus): void => cb(s)
      ipcRenderer.on('engine:status-changed', listener)
      return () => ipcRenderer.removeListener('engine:status-changed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('nexgraph', api)
