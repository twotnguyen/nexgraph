// Thay module `electron` cho preload cũ (apps/desktop/src/preload) khi chạy trong webview:
// ipcRenderer đi qua postMessage tới extension host, nên `window.nexgraph` giữ nguyên hợp đồng NexGraphApi.
declare function acquireVsCodeApi(): { postMessage(m: unknown): void }

type Listener = (event: unknown, payload: unknown) => void
const vscode = acquireVsCodeApi()
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const listeners = new Map<string, Set<Listener>>()
let seq = 0

window.addEventListener('message', ({ data }) => {
  if (data.event) return void listeners.get(data.event)?.forEach((l) => l(null, data.payload))
  const p = pending.get(data.id)
  if (!p) return
  pending.delete(data.id)
  if (data.ok) p.resolve(data.value)
  else p.reject(new Error(data.message))
})

export const ipcRenderer = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      vscode.postMessage({ id, channel, args })
    }),
  on(channel: string, l: Listener): void {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(l)
  },
  removeListener: (channel: string, l: Listener): void => void listeners.get(channel)?.delete(l)
}

export const contextBridge = {
  exposeInMainWorld: (name: string, api: unknown): void => void ((window as unknown as Record<string, unknown>)[name] = api)
}
