import { useSyncExternalStore } from 'react'
import { tr } from '../../i18n/strings'
import { formatNumber } from '../../shared/lib/locale'

/** Tin nhắn soạn sẵn cho trợ lý: lưu ở máy, dùng chung mọi dự án; chọn để chèn lại vào ô soạn. */
export type SavedPrompt = { id: string; name: string; text: string; savedAt: number }

const STORE = 'nexgraph.agent.savedPrompts'
const CHANGED = 'nexgraph:agent-saved-prompts'
export const MAX_SAVED = 50
export const MAX_TEXT = 20_000
export const MAX_NAME = 60

const valid = (value: unknown): value is SavedPrompt => !!value && typeof value === 'object'
  && 'id' in value && typeof value.id === 'string' && value.id !== ''
  && 'name' in value && typeof value.name === 'string' && value.name.trim() !== '' && value.name.length <= MAX_NAME
  && 'text' in value && typeof value.text === 'string' && value.text.trim() !== '' && value.text.length <= MAX_TEXT
  && 'savedAt' in value && typeof value.savedAt === 'number' && Number.isFinite(value.savedAt)

/** Đọc kho đã lưu; dữ liệu hỏng thì bỏ mục hỏng chứ không bỏ cả danh sách. */
export function parseSavedPrompts(raw: string | null): SavedPrompt[] {
  try {
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const seen = new Set<string>()
    const list: SavedPrompt[] = []
    for (const item of parsed) if (valid(item) && !seen.has(item.id)) { seen.add(item.id); list.push(item) }
    return list.slice(0, MAX_SAVED)
  } catch { return [] }
}

/** Tên gợi ý: dòng đầu có chữ, gọn khoảng trắng, cắt ở 40 ký tự. */
export function suggestName(text: string): string {
  const line = (text.split('\n').find((part) => part.trim()) ?? '').replace(/\s+/g, ' ').trim()
  return line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line
}

/** Thêm tin lên đầu danh sách; trùng tên (không phân biệt hoa thường) thì thay nội dung của tin cũ. */
export function upsertPrompt(list: readonly SavedPrompt[], name: string, text: string, now: number, id: string): SavedPrompt[] {
  const key = name.toLocaleLowerCase('vi')
  const same = list.find((item) => item.name.toLocaleLowerCase('vi') === key)
  return [{ id: same?.id ?? id, name, text, savedAt: now }, ...list.filter((item) => item !== same)]
}

let prompts: SavedPrompt[] = (() => { try { return parseSavedPrompts(localStorage.getItem(STORE)) } catch { return [] } })()

/** Ghi bền rồi mới đổi bộ nhớ: danh sách đang hiện luôn là danh sách sẽ còn sau khi khởi động lại. */
function commit(next: SavedPrompt[]): boolean {
  try { localStorage.setItem(STORE, JSON.stringify(next)) } catch { return false }
  prompts = next
  window.dispatchEvent(new Event(CHANGED))
  return true
}

/** Lưu nội dung ô soạn. Trả về lý do khi không lưu được, `null` khi xong. Tên trống thì lấy tên gợi ý. */
export function savePrompt(name: string, text: string): string | null {
  if (!text.trim()) return tr('Ô soạn đang trống.')
  if (text.length > MAX_TEXT) return tr('Tin dài quá {max} ký tự nên không lưu được.', { max: formatNumber(MAX_TEXT) })
  const title = name.trim().slice(0, MAX_NAME) || suggestName(text)
  const next = upsertPrompt(prompts, title, text, Date.now(), `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
  if (next.length > MAX_SAVED) return tr('Chỉ lưu tối đa {max} tin. Hãy xóa bớt tin cũ.', { max: formatNumber(MAX_SAVED) })
  return commit(next) ? null : tr('Không ghi được vào bộ nhớ của ứng dụng.')
}

export function deletePrompt(id: string): void {
  commit(prompts.filter((item) => item.id !== id))
}

const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGED, notify)
  return () => window.removeEventListener(CHANGED, notify)
}
export const useSavedPrompts = (): SavedPrompt[] => useSyncExternalStore(subscribe, () => prompts)
