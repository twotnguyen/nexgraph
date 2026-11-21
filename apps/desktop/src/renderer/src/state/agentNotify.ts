import { useSyncExternalStore } from 'react'

/** Báo khi trợ lý xong lúc cửa sổ không được chọn: thông báo hệ thống (mặc định bật) và tiếng chuông (mặc định tắt). */
export type NotifyPrefs = { notify: boolean; sound: boolean }
/** Hết lượt, lượt lỗi, hoặc đang chờ người dùng duyệt. */
export type AgentAlert = 'done' | 'error' | 'approval'

const STORE = 'nexgraph.agent.notify'
const CHANGED = 'nexgraph:agent-notify'
const DEFAULTS: NotifyPrefs = { notify: true, sound: false }

export function parseNotifyPrefs(raw: string | null): NotifyPrefs {
  let value: Partial<Record<keyof NotifyPrefs, unknown>> = {}
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed
  } catch { /* dùng mặc định */ }
  return {
    notify: typeof value.notify === 'boolean' ? value.notify : DEFAULTS.notify,
    sound: typeof value.sound === 'boolean' ? value.sound : DEFAULTS.sound
  }
}

let prefs = (() => { try { return parseNotifyPrefs(localStorage.getItem(STORE)) } catch { return parseNotifyPrefs(null) } })()
export const getNotifyPrefs = (): NotifyPrefs => prefs

export function setNotifyPrefs(next: Partial<NotifyPrefs>): void {
  prefs = parseNotifyPrefs(JSON.stringify({ ...prefs, ...next }))
  try { localStorage.setItem(STORE, JSON.stringify(prefs)) } catch { /* chỉ là tuỳ chọn */ }
  window.dispatchEvent(new Event(CHANGED))
}

const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGED, notify)
  return () => window.removeEventListener(CHANGED, notify)
}
export const useNotifyPrefs = (): NotifyPrefs => useSyncExternalStore(subscribe, getNotifyPrefs)

/** Chỉ báo khi cửa sổ không được chọn (đang ở app khác hoặc đã thu nhỏ), và từng kênh theo đúng cài đặt của nó. */
export const alertsFor = (settings: NotifyPrefs, focused: boolean): NotifyPrefs =>
  focused ? { notify: false, sound: false } : settings

const BODY: Record<AgentAlert, string> = {
  done: 'Trợ lý đã trả lời xong',
  error: 'Trợ lý gặp lỗi',
  approval: 'Trợ lý đang chờ bạn duyệt thay đổi'
}
// Cao dần = xong, lặp một nốt = cần bạn, thấp dần = lỗi.
const TONES: Record<AgentAlert, number[]> = { done: [660, 880], approval: [740, 740], error: [330, 247] }

/** Tiếng chuông ngắn tổng hợp bằng Web Audio nên không cần tệp âm thanh; mỗi lần dùng một context rồi đóng. */
function chime(kind: AgentAlert): void {
  try {
    const context = new window.AudioContext()
    TONES[kind].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.16
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.12, start)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.15)
    })
    setTimeout(() => void context.close(), 600)
  } catch { /* âm thanh chỉ là phụ */ }
}

/** Báo một lượt của trợ lý theo cài đặt; `title` là tên hội thoại hoặc dự án. */
export function announceAgent(kind: AgentAlert, title: string, focused = document.hasFocus()): void {
  const { notify, sound } = alertsFor(prefs, focused)
  if (sound) chime(kind)
  if (notify) void Promise.resolve(window.nexgraph.agent.notify?.(title.trim() || 'NexGraph', BODY[kind])).catch(() => {})
}
