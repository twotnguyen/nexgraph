import { useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * Lệnh của ứng dụng: danh sách tĩnh (để bảng lệnh và trang Phím tắt biết mọi lệnh) cộng handler do màn đang mở gắn vào.
 * Phím viết dạng "mod+shift+p"; hợp âm hai bước cách nhau dấu cách ("mod+k mod+t"). mod = ⌘ trên macOS, Ctrl nơi khác.
 */
export interface CommandDef {
  id: string
  title: string
  category: string
  key?: string
}

export const COMMANDS: readonly CommandDef[] = [
  { id: 'command_palette.toggle', category: 'Bảng lệnh', title: 'Mở bảng lệnh', key: 'mod+shift+p' },
  { id: 'file_finder.toggle', category: 'Tệp', title: 'Tìm và mở tệp', key: 'mod+p' },
  { id: 'theme_selector.toggle', category: 'Giao diện', title: 'Chọn theme', key: 'mod+k mod+t' },
  { id: 'settings.open', category: 'Ứng dụng', title: 'Mở cài đặt', key: 'mod+,' },
  { id: 'keymap.open', category: 'Ứng dụng', title: 'Mở phím tắt', key: 'mod+k mod+s' },
  { id: 'projects.open', category: 'Ứng dụng', title: 'Về danh sách dự án' },
  { id: 'agent.toggle', category: 'Trợ lý AI', title: 'Bật/tắt khung trợ lý', key: 'mod+l' },
  { id: 'explorer.toggle', category: 'Bảng công cụ', title: 'Hiện cây tệp', key: 'mod+shift+e' },
  { id: 'graph_search.toggle', category: 'Bảng công cụ', title: 'Tìm trong đồ thị' },
  { id: 'project_search.toggle', category: 'Bảng công cụ', title: 'Tìm và thay trong tệp', key: 'mod+shift+f' },
  { id: 'changes.toggle', category: 'Bảng công cụ', title: 'Hiện thay đổi', key: 'ctrl+shift+g' },
  { id: 'tour.toggle', category: 'Bảng công cụ', title: 'Hiện tour dự án' },
  { id: 'tab.close', category: 'Thẻ', title: 'Đóng thẻ đang mở', key: 'mod+w' },
  { id: 'editor.split_right', category: 'Editor', title: 'Chia đôi sang phải / bỏ chia đôi', key: 'mod+\\' },
  { id: 'editor.toggle_vim', category: 'Editor', title: 'Bật/tắt chế độ Vim' },
  { id: 'terminal.toggle', category: 'Terminal', title: 'Bật/tắt terminal', key: 'ctrl+`' },
  { id: 'terminal.new', category: 'Terminal', title: 'Terminal mới', key: 'ctrl+shift+`' },
  { id: 'view.arch', category: 'Xem', title: 'Kiến trúc' },
  { id: 'view.map', category: 'Xem', title: 'Bản đồ' },
  { id: 'view.flows', category: 'Xem', title: 'Luồng' },
  { id: 'view.graph', category: 'Xem', title: 'Graph' },
  { id: 'view.tree', category: 'Xem', title: 'Cây' },
  { id: 'view.report', category: 'Xem', title: 'Báo cáo' },
  { id: 'graph.export', category: 'Đồ thị', title: 'Xuất đồ thị' },
  { id: 'project.overview', category: 'Dự án', title: 'Về tổng quan dự án' }
]

const handlers = new Map<string, (() => void)[]>()

/** Gắn handler cho lệnh khi component còn mount; component gắn sau cùng thắng. */
export function useCommand(id: string, run: () => void, enabled = true): void {
  const latest = useRef(run)
  latest.current = run
  useEffect(() => {
    if (!enabled) return
    const fn = () => latest.current()
    const list = handlers.get(id) ?? []
    handlers.set(id, [...list, fn])
    return () => {
      const rest = (handlers.get(id) ?? []).filter((item) => item !== fn)
      if (rest.length) handlers.set(id, rest)
      else handlers.delete(id)
    }
  }, [id, enabled])
}

export function runCommand(id: string): boolean {
  const fn = handlers.get(id)?.at(-1)
  if (!fn) return false
  fn()
  return true
}

/** Lệnh đang chạy được ở màn hiện tại. */
export const availableCommands = (): CommandDef[] => COMMANDS.filter((command) => handlers.has(command.id))

// --- Phím tắt người dùng: lưu phần khác mặc định ("" = bỏ phím). ---
const STORE = 'nexgraph.keybindings'
const CHANGED = 'nexgraph:keybindings'
let overrides: Record<string, string> = (() => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORE) ?? '{}')
    return parsed && typeof parsed === 'object' ? Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) : {}
  } catch {
    return {}
  }
})()

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
// Ngoài macOS phím Ctrl chính là "mod": phím mặc định viết "ctrl+…" (như ctrl+` của Wu) phải khớp với lần nhấn đã chuẩn hoá thành "mod+…".
const forPlatform = (key: string) => (IS_MAC ? key : key.replace(/\bctrl\+/g, 'mod+'))
export const bindingFor = (id: string): string => overrides[id] ?? forPlatform(COMMANDS.find((command) => command.id === id)?.key ?? '')
export const isCustomBinding = (id: string): boolean => Object.hasOwn(overrides, id)

/** key = null: về mặc định. Một phím chỉ thuộc một lệnh: lệnh khác đang giữ phím đó bị bỏ phím. */
export function setBinding(id: string, key: string | null): void {
  const next = { ...overrides }
  if (key === null) delete next[id]
  else {
    for (const command of COMMANDS) if (command.id !== id && bindingFor(command.id) === key) next[command.id] = ''
    next[id] = key
  }
  for (const command of COMMANDS) if (next[command.id] === forPlatform(command.key ?? '')) delete next[command.id]
  overrides = next
  try { localStorage.setItem(STORE, JSON.stringify(next)) } catch { /* bộ nhớ đầy: vẫn áp dụng trong phiên */ }
  window.dispatchEvent(new Event(CHANGED))
}

const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGED, notify)
  return () => window.removeEventListener(CHANGED, notify)
}
/** Re-render khi phím tắt đổi; trả về bảng ghi đè hiện tại (đổi tham chiếu mỗi lần lưu). */
export const useKeybindings = (): Record<string, string> => useSyncExternalStore(subscribe, () => overrides)

const MODIFIERS: Record<string, true> = { Meta: true, Control: true, Alt: true, Shift: true }

// Phím ký hiệu đọc theo code để Shift không đổi ký tự (shift+` ra "~" trên bàn phím US).
const SYMBOL_CODE: Record<string, string> = { Backquote: '`', Backslash: '\\', Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'" }

/** Một lần nhấn → "mod+shift+p"; null nếu chỉ là phím bổ trợ. Dùng code cho chữ/số/ký hiệu để Option (macOS), Shift và bố cục bàn phím không làm đổi phím. */
export function eventToStroke(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string | null {
  if (MODIFIERS[event.key]) return null
  const code = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code)
  const key = code ? (code[1] ?? code[2]).toLowerCase() : SYMBOL_CODE[event.code] ?? (event.key === ' ' ? 'space' : event.key.toLowerCase())
  const parts: string[] = []
  if (IS_MAC ? event.metaKey : event.ctrlKey) parts.push('mod')
  if (IS_MAC && event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

const MAC_GLYPH: Record<string, string> = { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', enter: '↩', escape: '⎋', backspace: '⌫', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', space: '␣' }
const PC_NAME: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', escape: 'Esc', space: 'Space' }

/** "mod+shift+p" → "⌘⇧P" (macOS) hoặc "Ctrl+Shift+P"; hợp âm nối bằng dấu cách. */
export function formatKey(key: string, mac = IS_MAC): string {
  return key.split(' ').filter(Boolean).map((stroke) => {
    const parts = stroke.split('+').map((part) => {
      const known = (mac ? MAC_GLYPH : PC_NAME)[part]
      return known ?? (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))
    })
    return parts.join(mac ? '' : '+')
  }).join(' ')
}

/**
 * Bộ phân phối phím toàn cục (pha capture để đi trước Monaco). Lệnh chưa có handler ở màn hiện tại thì bỏ qua để phím rơi về chỗ cũ.
 * Bỏ qua khi đang ghi phím ở trang Phím tắt ([data-keymap-recorder]).
 */
export function installKeymap(target: Window = window): () => void {
  let pending: { stroke: string; at: number } | null = null
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-keymap-recorder]'))) return
    const stroke = eventToStroke(event)
    if (!stroke) return
    const sequence = pending && Date.now() - pending.at < 1500 ? `${pending.stroke} ${stroke}` : stroke
    pending = null
    const live = COMMANDS.filter((command) => handlers.has(command.id))
    const exact = live.find((command) => bindingFor(command.id) === sequence)
    if (exact) {
      event.preventDefault()
      event.stopPropagation()
      runCommand(exact.id)
      return
    }
    if (!sequence.includes(' ') && live.some((command) => bindingFor(command.id).startsWith(`${sequence} `))) {
      event.preventDefault()
      event.stopPropagation()
      pending = { stroke, at: Date.now() }
    }
  }
  target.addEventListener('keydown', onKey, true)
  return () => target.removeEventListener('keydown', onKey, true)
}
