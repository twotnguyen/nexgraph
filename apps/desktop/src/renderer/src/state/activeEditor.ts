import { useSyncExternalStore } from 'react'
import type { EditorHandle } from '../components/editor/monaco'

/** Thẻ tệp đang hiện và editor của nó (thẻ báo vào khi hiện), cho lệnh cần "tệp đang mở": chia sẻ cộng tác, lệnh chèn văn bản của extension. */
export type ActiveEditor = { file: string; handle: EditorHandle; text: () => string }
let active: ActiveEditor | null = null
const listeners = new Set<() => void>()
export const setActiveEditor = (next: ActiveEditor | null): void => {
  if (active === next) return
  active = next
  for (const listener of listeners) listener()
}
export const getActiveEditor = (): ActiveEditor | null => active
export const subscribeActiveEditor = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const useActiveEditor = (): ActiveEditor | null => useSyncExternalStore(subscribeActiveEditor, getActiveEditor, () => null)
