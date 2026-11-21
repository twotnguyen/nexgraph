import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react'

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

/** Lệnh dựng sẵn; extension thêm lệnh vào cuối bằng `addCommands`. */
export const COMMANDS: CommandDef[] = [
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
  { id: 'changes.toggle', category: 'Bảng công cụ', title: 'Hiện thay đổi và vùng ảnh hưởng' },
  { id: 'git_panel.toggle', category: 'Git', title: 'Hiện Git panel', key: 'ctrl+shift+g' },
  { id: 'git.blame', category: 'Git', title: 'Bật/tắt blame từng dòng' },
  { id: 'debug.toggle', category: 'Gỡ lỗi', title: 'Hiện bảng Gỡ lỗi', key: 'mod+shift+d' },
  { id: 'debug.start', category: 'Gỡ lỗi', title: 'Bắt đầu / chạy tiếp', key: 'f5' },
  { id: 'debug.step_over', category: 'Gỡ lỗi', title: 'Bước qua', key: 'f10' },
  { id: 'debug.step_into', category: 'Gỡ lỗi', title: 'Bước vào', key: 'f11' },
  { id: 'debug.step_out', category: 'Gỡ lỗi', title: 'Bước ra', key: 'shift+f11' },
  { id: 'debug.stop', category: 'Gỡ lỗi', title: 'Dừng gỡ lỗi', key: 'shift+f5' },
  { id: 'debug.pause', category: 'Gỡ lỗi', title: 'Tạm dừng', key: 'f6' },
  { id: 'debug.restart', category: 'Gỡ lỗi', title: 'Chạy lại phiên', key: 'mod+shift+f5' },
  { id: 'debug.toggle_breakpoint', category: 'Gỡ lỗi', title: 'Bật/tắt điểm dừng', key: 'f9' },
  { id: 'debug.edit_breakpoint', category: 'Gỡ lỗi', title: 'Sửa điểm dừng', key: 'shift+f9' },
  { id: 'debug.clear_breakpoints', category: 'Gỡ lỗi', title: 'Xoá tất cả điểm dừng' },
  { id: 'collab.share', category: 'Cộng tác', title: 'Chia sẻ tệp đang mở trong mạng LAN' },
  { id: 'collab.join', category: 'Cộng tác', title: 'Tham gia phiên của máy khác' },
  { id: 'collab.leave', category: 'Cộng tác', title: 'Rời / dừng phiên cộng tác' },
  { id: 'tour.toggle', category: 'Bảng công cụ', title: 'Hiện tour dự án' },
  { id: 'tab.close', category: 'Thẻ', title: 'Đóng thẻ đang mở', key: 'mod+w' },
  { id: 'tab.reopen', category: 'Thẻ', title: 'Mở lại thẻ vừa đóng', key: 'mod+shift+t' },
  { id: 'tab.next_mru', category: 'Thẻ', title: 'Chuyển sang thẻ dùng gần đây', key: 'ctrl+tab' },
  { id: 'tab.previous_mru', category: 'Thẻ', title: 'Chuyển ngược thẻ dùng gần đây', key: 'ctrl+shift+tab' },
  ...Array.from({ length: 10 }, (_, n) => ({ id: `tab.activate_${n}`, category: 'Thẻ', title: n ? `Mở thẻ ${n}` : 'Mở thẻ cuối', key: `ctrl+${n}` })),
  { id: 'tab.pin', category: 'Thẻ', title: 'Ghim / bỏ ghim thẻ', key: 'mod+k shift+enter' },
  { id: 'dock.left', category: 'Bảng công cụ', title: 'Ẩn / hiện bảng bên trái', key: 'mod+b' },
  { id: 'dock.bottom', category: 'Terminal', title: 'Ẩn / hiện terminal', key: 'mod+j' },
  { id: 'editor.split_right', category: 'Editor', title: 'Chia đôi sang phải / bỏ chia đôi', key: 'mod+\\' },
  { id: 'editor.toggle_vim', category: 'Editor', title: 'Bật/tắt chế độ Vim' },
  { id: 'editor.goto_line', category: 'Editor', title: 'Đi đến dòng', key: 'ctrl+g' },
  { id: 'editor.document_symbols', category: 'Editor', title: 'Tìm ký hiệu trong tệp', key: 'mod+shift+o' },
  { id: 'editor.workspace_symbols', category: 'Editor', title: 'Tìm ký hiệu trong dự án', key: 'mod+t' },
  { id: 'editor.diagnostics', category: 'Editor', title: 'Hiện lỗi trong dự án', key: 'mod+shift+m' },
  { id: 'editor.rename', category: 'Editor', title: 'Đổi tên ký hiệu', key: 'f2' },
  { id: 'editor.implementation', category: 'Editor', title: 'Đi đến phần triển khai', key: 'shift+f12' },
  { id: 'editor.references', category: 'Editor', title: 'Tìm tham chiếu', key: 'alt+shift+f12' },
  { id: 'editor.next_diagnostic', category: 'Editor', title: 'Lỗi tiếp theo', key: 'f8' },
  { id: 'editor.previous_diagnostic', category: 'Editor', title: 'Lỗi trước đó', key: 'shift+f8' },
  { id: 'editor.format', category: 'Editor', title: 'Định dạng tệp', key: 'alt+shift+f' },
  { id: 'editor.code_actions', category: 'Editor', title: 'Thao tác mã', key: 'mod+.' },
  { id: 'markdown.preview', category: 'Markdown', title: 'Mở / đóng xem trước Markdown', key: 'mod+shift+v' },
  { id: 'markdown.preview_side', category: 'Markdown', title: 'Xem trước Markdown bên cạnh', key: 'mod+k v' },
  { id: 'image.zoom_in', category: 'Ảnh', title: 'Phóng to ảnh', key: 'mod+=' },
  { id: 'image.zoom_out', category: 'Ảnh', title: 'Thu nhỏ ảnh', key: 'mod+-' },
  { id: 'image.reset_zoom', category: 'Ảnh', title: 'Đặt lại độ phóng ảnh', key: 'mod+0' },
  { id: 'image.fit_to_view', category: 'Ảnh', title: 'Vừa khung xem', key: 'mod+shift+0' },
  { id: 'terminal.toggle', category: 'Terminal', title: 'Bật/tắt terminal', key: 'ctrl+`' },
  { id: 'terminal.new', category: 'Terminal', title: 'Terminal mới', key: 'ctrl+shift+`' },
  { id: 'task.spawn', category: 'Task', title: 'Chạy task', key: 'mod+shift+r' },
  { id: 'task.rerun', category: 'Task', title: 'Chạy lại task gần nhất', key: 'mod+alt+r' },
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

/** Cài đặt ẩn Không gian làm việc nhưng giữ buffer; không để lệnh của màn đã ẩn chạy. */
export const CommandsEnabled = createContext(true)

/** Gắn handler cho một lệnh; trả về hàm gỡ. Handler gắn sau cùng thắng. */
export function registerHandler(id: string, fn: () => void): () => void {
  handlers.set(id, [...(handlers.get(id) ?? []), fn])
  return () => {
    const rest = (handlers.get(id) ?? []).filter((item) => item !== fn)
    if (rest.length) handlers.set(id, rest)
    else handlers.delete(id)
  }
}

/** Gắn handler cho lệnh khi component còn mount. */
export function useCommand(id: string, run: () => void, enabled = true): void {
  const latest = useRef(run)
  latest.current = run
  const scoped = useContext(CommandsEnabled)
  useEffect(() => (enabled && scoped ? registerHandler(id, () => latest.current()) : undefined), [id, enabled, scoped])
}

/** Thêm lệnh của extension (bỏ id trùng); trang Phím tắt và bảng lệnh thấy ngay. */
export function addCommands(defs: readonly CommandDef[]): void {
  for (const def of defs) if (!COMMANDS.some((c) => c.id === def.id)) COMMANDS.push(def)
  notifyKeymap()
}
export function removeCommands(prefix: string): void {
  for (let i = COMMANDS.length - 1; i >= 0; i--) if (COMMANDS[i].id.startsWith(prefix)) COMMANDS.splice(i, 1)
  notifyKeymap()
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
/** Re-render khi phím tắt hoặc danh sách lệnh đổi; trả về bảng ghi đè hiện tại (đổi tham chiếu mỗi lần đổi). */
export const useKeybindings = (): Record<string, string> => useSyncExternalStore(subscribe, () => overrides)
// Danh sách lệnh đổi (extension): đổi tham chiếu bảng ghi đè để useKeybindings vẽ lại.
function notifyKeymap() {
  overrides = { ...overrides }
  window.dispatchEvent(new Event(CHANGED))
}

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
    if (event.target instanceof Element && event.target.closest('.terminal-panel') &&
      (stroke === 'shift+escape' || (event.target.closest('.terminal-view, .terminal-search') && ['mod+d', 'mod+f', 'mod+k'].includes(stroke)))) {
      pending = null
      return
    }
    const sequence = pending && Date.now() - pending.at < 1500 ? `${pending.stroke} ${stroke}` : stroke
    pending = null
    const element = event.target instanceof Element ? event.target : null
    const inDialog = !!element?.closest('[role=dialog]')
    const inInput = !!element?.closest('input, textarea, select, [contenteditable=true]') && !element?.closest('.monaco-editor')
    const live = COMMANDS.filter((command) => handlers.has(command.id)
      && !(command.id.startsWith('editor.') && (inDialog || inInput))
      && !(command.id === 'editor.rename' && element?.closest('[role=tree]')))
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
