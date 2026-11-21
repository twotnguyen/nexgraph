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

const BLAME = 'nexgraph.editor.blame'
let blame = (() => { try { return localStorage.getItem(BLAME) === '1' } catch { return false } })()
export function setBlame(on: boolean): void {
  blame = on
  try { localStorage.setItem(BLAME, on ? '1' : '0') } catch { /* chỉ là tuỳ chọn */ }
  window.dispatchEvent(new Event(CHANGED))
}
/** Blame của Git ở dòng có con trỏ (inline blame của Wu). */
export const useBlame = (): boolean => useSyncExternalStore(subscribe, () => blame)

export type EditorPrefs = {
  fontSize: number
  terminalFontSize: number
  tabSize: 2 | 4 | 8
  wordWrap: 'off' | 'on'
  formatOnSave: boolean
  autoSave: 'off' | 'afterDelay' | 'onFocusChange'
  autoSaveDelay: number
  iconTheme: 'symbols' | 'mono'
  /** Chờ bao lâu (ms) sau khi con trỏ đổi dòng mới hiện inline blame; đổi dòng lại thì tính từ đầu. */
  blameDelay: number
  /** Inline blame kèm tóm tắt commit. */
  blameSummary: boolean
}

const STORE = 'nexgraph.editor.preferences'
const DEFAULTS: EditorPrefs = {
  fontSize: 13, terminalFontSize: 12, tabSize: 4, wordWrap: 'off', formatOnSave: false,
  autoSave: 'off', autoSaveDelay: 1000, iconTheme: 'symbols', blameDelay: 0, blameSummary: true
}
const numberIn = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

export function parseEditorPrefs(raw: string | null): EditorPrefs {
  let value: Partial<Record<keyof EditorPrefs, unknown>> = {}
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed
  } catch { /* dùng mặc định */ }
  return {
    fontSize: numberIn(value.fontSize, DEFAULTS.fontSize, 8, 32),
    terminalFontSize: numberIn(value.terminalFontSize, DEFAULTS.terminalFontSize, 8, 32),
    tabSize: value.tabSize === 2 || value.tabSize === 4 || value.tabSize === 8 ? value.tabSize : DEFAULTS.tabSize,
    wordWrap: value.wordWrap === 'on' ? 'on' : 'off',
    formatOnSave: value.formatOnSave === true,
    autoSave: value.autoSave === 'afterDelay' || value.autoSave === 'onFocusChange' ? value.autoSave : 'off',
    autoSaveDelay: numberIn(value.autoSaveDelay, DEFAULTS.autoSaveDelay, 1, 2147483647),
    iconTheme: value.iconTheme === 'mono' ? 'mono' : 'symbols',
    blameDelay: numberIn(value.blameDelay, DEFAULTS.blameDelay, 0, 5000),
    blameSummary: value.blameSummary !== false
  }
}

let prefs = (() => { try { return parseEditorPrefs(localStorage.getItem(STORE)) } catch { return parseEditorPrefs(null) } })()
let fontZoom = 0
export const getEditorPrefs = (): EditorPrefs => prefs
export const useEditorPrefs = (): EditorPrefs => useSyncExternalStore(subscribe, getEditorPrefs)
export const useIconTheme = (): EditorPrefs['iconTheme'] => useSyncExternalStore(subscribe, () => prefs.iconTheme)
export const observeEditorPrefs = subscribe
export const editorFontSize = (): number => Math.min(32, Math.max(8, prefs.fontSize + fontZoom))

/** Thu phóng chỉ trong phiên; ⌘0 về cỡ chữ đã đặt, không ghi đè cài đặt. */
export function zoomEditorFont(step: number | 'reset'): void {
  fontZoom = step === 'reset' ? 0 : Math.min(32, Math.max(8, editorFontSize() + step)) - prefs.fontSize
  window.dispatchEvent(new Event(CHANGED))
}

export function setEditorPrefs(next: Partial<EditorPrefs>): void {
  const updated = parseEditorPrefs(JSON.stringify({ ...prefs, ...next }))
  if (updated.fontSize !== prefs.fontSize) fontZoom = 0
  prefs = updated
  try { localStorage.setItem(STORE, JSON.stringify(prefs)) } catch { /* chỉ là tuỳ chọn */ }
  window.dispatchEvent(new Event(CHANGED))
}
