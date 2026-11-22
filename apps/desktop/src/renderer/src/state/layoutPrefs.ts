import { useSyncExternalStore } from 'react'

/**
 * Tuỳ chọn bố cục của trang Panels. Đọc thẳng localStorage mỗi lần (không giữ bản sao trong module) và phát sự kiện khi ghi:
 * đổi ở Cài đặt thì Workspace đang ẩn phía sau vẽ lại ngay, kéo thanh chia thì Cài đặt thấy giá trị mới.
 */
const CHANGED = 'nexgraph:layout-prefs'
const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGED, notify)
  return () => window.removeEventListener(CHANGED, notify)
}

/** Một tuỳ chọn → [hook, đọc, ghi]. `parse` đưa chuỗi đã lưu (thiếu hoặc hỏng cũng được) về giá trị hợp lệ; ghi cũng đi qua `parse` nên luôn nằm trong giới hạn. */
function pref<T>(key: string, parse: (raw: string | null) => T, format: (value: T) => string = String) {
  const read = (): T => {
    try { return parse(localStorage.getItem(key)) } catch { return parse(null) }
  }
  const write = (value: T): void => {
    try { localStorage.setItem(key, format(parse(format(value)))) } catch { /* chỉ là tuỳ chọn */ }
    window.dispatchEvent(new Event(CHANGED))
  }
  const fallback = parse(null)
  return [() => useSyncExternalStore(subscribe, read), read, write, fallback] as const
}

const int = (min: number, max: number, fallback: number) => (raw: string | null): number => {
  const n = raw?.trim() ? Math.round(Number(raw)) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const enabled = (raw: string | null): boolean => raw !== '0'
const flag = (value: boolean): string => (value ? '1' : '0')

export const CHAT_WIDTH = { min: 300, max: 640 }
export const TERMINAL_HEIGHT = { min: 120, max: 2000 }

/** Khung trợ lý ở trái (dùng chung chỗ với cây tệp như Wu) hoặc phải; chưa lưu thì mặc định bên phải. */
export const [useChatDock, , setChatDock, defaultChatDock] = pref<'left' | 'right'>('nexgraph.chat.dock', (raw) => (raw === 'left' ? 'left' : 'right'))
export const [useChatWidth, , setChatWidth, defaultChatWidth] = pref('nexgraph.chat.width', int(CHAT_WIDTH.min, CHAT_WIDTH.max, 360))
/** Chiều cao panel dưới (terminal). */
export const [useTerminalHeight, , setTerminalHeight, defaultTerminalHeight] = pref('nexgraph.terminal.height', int(TERMINAL_HEIGHT.min, TERMINAL_HEIGHT.max, 280))
/** Vào dự án thì mở sẵn cây tệp (chỉ lần dựng màn đầu tiên; sau đó theo thao tác của người dùng). */
export const [useExplorerOpen, getExplorerOpen, setExplorerOpen, defaultExplorerOpen] = pref('nexgraph.layout.explorer', enabled, flag)
export const [useStatusBar, , setStatusBar, defaultStatusBar] = pref('nexgraph.layout.statusbar', enabled, flag)
/** Giá trị mặc định để modal “cài đặt mặc định” lấy từ chính nguồn định nghĩa pref, không cần copy lại. */
export const LAYOUT_DEFAULTS = { chatDock: defaultChatDock, chatWidth: defaultChatWidth, terminalHeight: defaultTerminalHeight, explorerOpen: defaultExplorerOpen, statusBar: defaultStatusBar }

/** Mục thanh trạng thái bị ẩn: mỗi mục một khoá riêng để Cài đặt bật lại từng cái. */
export const STATUS_HIDDEN_PREFIX = 'nexgraph.statusbar.hidden:'
export const statusItemHiddenKey = (id: string) => `${STATUS_HIDDEN_PREFIX}${id}`
export const isStatusItemHidden = (id: string): boolean => {
  try { return localStorage.getItem(statusItemHiddenKey(id)) === '1' } catch { return false }
}
let hiddenItems: Set<string> | null = null
const EMPTY_HIDDEN: ReadonlySet<string> = new Set()
const readHiddenItems = (): ReadonlySet<string> => hiddenItems ??= new Set(
  Object.keys(localStorage).filter((key) => key.startsWith(STATUS_HIDDEN_PREFIX) && localStorage.getItem(key) === '1')
    .map((key) => key.slice(STATUS_HIDDEN_PREFIX.length))
)
export const useHiddenStatusItems = (): ReadonlySet<string> => useSyncExternalStore(subscribe, readHiddenItems, () => EMPTY_HIDDEN)
export function setStatusItemHidden(id: string, hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(statusItemHiddenKey(id), '1')
    else localStorage.removeItem(statusItemHiddenKey(id))
  } catch { /* chỉ là tuỳ chọn */ }
  hiddenItems = null
  window.dispatchEvent(new Event(CHANGED))
}
