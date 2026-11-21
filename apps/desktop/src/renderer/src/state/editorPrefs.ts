import { useSyncExternalStore } from 'react'

const VIM = 'nexgraph.editor.vim'
const CHANGED = 'nexgraph:editor-prefs'

let vim = (() => { try { return localStorage.getItem(VIM) === '1' } catch { return false } })()

export function setVimMode(on: boolean): void {
  vim = on
  try { localStorage.setItem(VIM, on ? '1' : '0') } catch { /* chỉ là tuỳ chọn */ }
  window.dispatchEvent(new Event(CHANGED))
}

const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGED, notify)
  return () => window.removeEventListener(CHANGED, notify)
}
/** Chế độ Vim cho mọi editor (như cài đặt vim_mode của Wu). */
export const useVimMode = (): boolean => useSyncExternalStore(subscribe, () => vim)
