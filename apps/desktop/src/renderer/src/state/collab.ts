import { useSyncExternalStore } from 'react'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import type { EditorHandle } from '../components/editor/monaco'
import { errorText } from './errorText'

/**
 * Cộng tác LAN kiểu Wu (ngang hàng, không máy chủ đám mây): một tệp chung là một Y.Doc; bản cập nhật Yjs (gói loại 0)
 * và trạng thái con trỏ (gói loại 1) đi qua WebSocket do main mở. Bên chia sẻ giữ tệp thật và lưu bằng ⌘S như thường.
 */
const UPDATE = 0
const AWARENESS = 1
const REMOTE = Symbol('remote')
const COLORS = ['#e5484d', '#3e9b4f', '#0090ff', '#e3a008', '#8e4ec6', '#12a594', '#d6409f']

export type CollabState = {
  role: 'host' | 'guest' | null
  file: string | null
  peers: number
  share: { addresses: string[]; port: number; code: string } | null
  remote: { name: string; color: string }[]
  error: string | null
}
let state: CollabState = { role: null, file: null, peers: 0, share: null, remote: [], error: null }
const listeners = new Set<() => void>()
const patch = (next: Partial<CollabState>) => { state = { ...state, ...next }; for (const l of listeners) l() }
export const useCollab = (): CollabState => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, () => state)

export const collabName = (): string => { try { return localStorage.getItem('nexgraph.collab.name') || 'Người dùng' } catch { return 'Người dùng' } }
export const setCollabName = (name: string): void => { try { localStorage.setItem('nexgraph.collab.name', name.trim().slice(0, 40)) } catch { /* bỏ qua */ } }

type Live = { doc: Y.Doc; awareness: Awareness; off: () => void; unbind: (() => void) | null; style: HTMLStyleElement }
let live: Live | null = null

/** Tệp đang mở và editor của nó (thẻ tệp đang hiện báo vào), để lệnh "Chia sẻ" biết chia sẻ gì. */
let activeEditor: { file: string; handle: EditorHandle; text: () => string } | null = null
export const setActiveEditor = (next: typeof activeEditor): void => { activeEditor = next }

const frame = (kind: number, body: Uint8Array) => { const out = new Uint8Array(body.length + 1); out[0] = kind; out.set(body, 1); return out }
const send = (data: Uint8Array) => void window.nexgraph.collab?.send(data).catch(() => {})
const message = errorText

// Màu và tên nhãn con trỏ người khác: y-monaco gắn lớp yRemoteSelection(Head)-<clientID>.
function paintRemote(awareness: Awareness, style: HTMLStyleElement) {
  const rules: string[] = []
  const remote: CollabState['remote'] = []
  awareness.getStates().forEach((value, clientId) => {
    if (clientId === awareness.clientID) return
    const user = (value as { user?: { name?: string; color?: string } }).user
    const color = /^#[0-9a-f]{6}$/i.test(user?.color ?? '') ? user!.color! : '#888888'
    const name = (user?.name ?? 'Khách').replace(/["\\\n]/g, '')
    remote.push({ name, color })
    rules.push(`.yRemoteSelection-${clientId}{background:${color}33}`,
      `.yRemoteSelectionHead-${clientId}{position:absolute;height:100%;border-left:2px solid ${color}}`,
      `.yRemoteSelectionHead-${clientId}::after{content:"${name}";position:absolute;top:-1.2em;left:-2px;padding:0 4px;border-radius:3px;background:${color};color:#fff;font-size:10px;white-space:nowrap}`)
  })
  style.textContent = rules.join('\n')
  patch({ remote })
}

function open(role: 'host' | 'guest'): Live {
  close()
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  awareness.setLocalStateField('user', { name: collabName(), color: COLORS[doc.clientID % COLORS.length] })
  const style = document.createElement('style')
  document.head.appendChild(style)
  doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== REMOTE) send(frame(UPDATE, update)) })
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== REMOTE) send(frame(AWARENESS, encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])))
  })
  awareness.on('change', () => paintRemote(awareness, style))
  const off = window.nexgraph.collab?.onEvent((event) => {
    if (event.type === 'message') {
      const body = event.data.subarray(1)
      if (event.data[0] === UPDATE) Y.applyUpdate(doc, body, REMOTE)
      else if (event.data[0] === AWARENESS) applyAwarenessUpdate(awareness, body, REMOTE)
    } else if (event.type === 'joined' && role === 'host') {
      // Người mới: gửi toàn bộ tài liệu và con trỏ hiện có.
      send(frame(UPDATE, Y.encodeStateAsUpdate(doc)))
      send(frame(AWARENESS, encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()])))
    } else if (event.type === 'peers') patch({ peers: event.count })
    else if (event.type === 'closed') { close(); patch({ error: 'Máy chia sẻ đã dừng phiên' }) }
  }) ?? (() => {})
  live = { doc, awareness, off, unbind: null, style }
  return live
}

/** Chia sẻ tệp đang mở: dựng Y.Text từ nội dung hiện tại rồi gắn vào chính editor của thẻ đó. */
export async function shareActiveFile(): Promise<void> {
  const target = activeEditor
  if (!window.nexgraph.collab || !target?.handle.bindCollab) return patch({ error: 'Mở một tệp trong editor rồi chia sẻ' })
  const session = open('host')
  session.doc.getText('content').insert(0, target.text())
  session.unbind = target.handle.bindCollab(session.doc.getText('content'), session.awareness)
  try {
    const share = await window.nexgraph.collab.host({ file: target.file, host: collabName() })
    patch({ role: 'host', file: target.file, share, peers: 0, error: null })
  } catch (e) {
    close()
    patch({ error: message(e) })
  }
}

/** Tham gia: Y.Doc tạo trước khi nối để không lỡ gói đầu tiên; editor của thẻ cộng tác gắn sau bằng bindGuestEditor. */
export async function joinSession(address: string, code: string): Promise<void> {
  if (!window.nexgraph.collab) return
  open('guest')
  try {
    const hello = await window.nexgraph.collab.join(address.trim(), code.trim())
    patch({ role: 'guest', file: hello.file, share: null, peers: 1, error: null })
  } catch (e) {
    close()
    patch({ error: message(e) })
    throw e
  }
}

export function bindGuestEditor(handle: EditorHandle): () => void {
  if (!live || !handle.bindCollab) return () => {}
  live.unbind?.()
  const unbind = handle.bindCollab(live.doc.getText('content'), live.awareness)
  live.unbind = unbind
  return () => { unbind(); if (live?.unbind === unbind) live.unbind = null }
}

function close() {
  if (!live) return
  const session = live
  live = null
  session.unbind?.()
  removeAwarenessStates(session.awareness, [session.doc.clientID], 'local')
  session.off()
  session.awareness.destroy()
  session.doc.destroy()
  session.style.remove()
  patch({ role: null, file: null, peers: 0, share: null, remote: [] })
}

export function leaveSession(): void {
  void window.nexgraph.collab?.stop().catch(() => {})
  close()
}
export const clearCollabError = (): void => patch({ error: null })
