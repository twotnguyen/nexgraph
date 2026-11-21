/** Đánh dấu dòng theo dự án và đường dẫn; lưu ở máy, sống qua lần mở lại thẻ. */
export type Bookmark = { file: string; line: number; label?: string }

const CHANGED = 'nexgraph:bookmarks'
const storageKey = (projectId: string) => `nexgraph.bookmarks:${projectId}`
const same = (a: Bookmark, b: Bookmark) => a.file === b.file && a.line === b.line
const order = (a: Bookmark, b: { file: string; line: number }) => a.file.localeCompare(b.file) || a.line - b.line

/** Bỏ mục hỏng và mục trùng file+dòng; một dòng chỉ có một mốc. */
export function parseBookmarks(raw: string | null): Bookmark[] {
  try {
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const list: Bookmark[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const value = item as Partial<Bookmark>
      if (typeof value.file !== 'string' || !value.file || !Number.isInteger(value.line) || (value.line ?? 0) < 1) continue
      const bookmark: Bookmark = { file: value.file, line: value.line as number }
      if (typeof value.label === 'string') bookmark.label = value.label
      if (!list.some((old) => same(old, bookmark))) list.push(bookmark)
    }
    return list
  } catch { return [] }
}

const caches = new Map<string, Bookmark[]>()
function load(projectId: string): Bookmark[] {
  let list = caches.get(projectId)
  if (!list) {
    let raw: string | null = null
    try { raw = localStorage.getItem(storageKey(projectId)) } catch { /* không đọc được thì bắt đầu từ danh sách rỗng */ }
    list = parseBookmarks(raw)
    caches.set(projectId, list)
  }
  return list
}

function commit(projectId: string, list: Bookmark[]): void {
  caches.set(projectId, list)
  // Bộ nhớ đầy hoặc bị khoá vẫn cho bật/tắt trong phiên này.
  try { localStorage.setItem(storageKey(projectId), JSON.stringify(list)) } catch { /* bỏ qua */ }
  window.dispatchEvent(new Event(CHANGED))
}

export function listBookmarks(projectId: string): Bookmark[] {
  return [...load(projectId)]
}

export function toggleBookmark(projectId: string, file: string, line: number): void {
  const list = load(projectId)
  const at = list.findIndex((item) => same(item, { file, line }))
  commit(projectId, at < 0 ? [...list, { file, line }] : list.filter((_, index) => index !== at))
}

export function setBookmarkLabel(projectId: string, file: string, line: number, label: string): void {
  const list = load(projectId)
  const at = list.findIndex((item) => same(item, { file, line }))
  commit(projectId, at < 0 ? [...list, { file, line, label }]
    : list.map((item, index) => index === at ? { ...item, label } : item))
}

export function subscribeBookmarks(cb: () => void): () => void {
  window.addEventListener(CHANGED, cb)
  return () => window.removeEventListener(CHANGED, cb)
}

/** Mốc kế tiếp theo thứ tự file+dòng, bỏ qua đúng dòng đang đứng và quay vòng ở hai đầu. */
export function nextBookmark(list: Bookmark[], file: string, line: number, direction: 1 | -1): Bookmark | null {
  if (!list.length) return null
  const sorted = [...list].sort(order)
  const here = { file, line }
  if (direction === 1) return sorted.find((item) => order(item, here) > 0) ?? sorted[0] ?? null
  return [...sorted].reverse().find((item) => order(item, here) < 0) ?? sorted[sorted.length - 1] ?? null
}
