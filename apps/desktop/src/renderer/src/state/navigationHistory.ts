/** Lịch sử điều hướng tệp theo dự án; mỗi mục là một vị trí 1-based đã mở trong workspace. */
export type NavigationEntry = { file: string; line: number; column: number }
export type NavigationState = { entries: NavigationEntry[]; index: number }

const LIMIT = 100
const storageKey = (projectId: string) => `nexgraph.navigation:${projectId}`
const same = (a: NavigationEntry | undefined, b: NavigationEntry): boolean =>
  !!a && a.file === b.file && a.line === b.line && a.column === b.column

/** Đọc dữ liệu cũ, bỏ mục hỏng/trùng liên tiếp và giới hạn 100 mục. */
export function parseNavigation(raw: string | null): NavigationState {
  try {
    const parsed: unknown = raw === null ? { entries: [] } : JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { entries: [], index: -1 }
    const value = parsed as Partial<NavigationState>
    const entries: NavigationEntry[] = []
    if (Array.isArray(value.entries)) for (const item of value.entries) {
      if (!item || typeof item !== 'object') continue
      const v = item as Partial<NavigationEntry>
      if (typeof v.file !== 'string' || !v.file || !Number.isInteger(v.line) || (v.line ?? 0) < 1
        || !Number.isInteger(v.column) || (v.column ?? 0) < 1) continue
      const entry: NavigationEntry = { file: v.file, line: v.line as number, column: v.column as number }
      if (!same(entries[entries.length - 1], entry)) entries.push(entry)
    }
    const limited = entries.slice(-LIMIT)
    const index = Number.isInteger(value.index)
      ? Math.min(Math.max(value.index as number, -1), limited.length - 1)
      : limited.length - 1
    return { entries: limited, index }
  } catch { return { entries: [], index: -1 } }
}

const caches = new Map<string, NavigationState>()
function load(projectId: string): NavigationState {
  let state = caches.get(projectId)
  if (!state) {
    let raw: string | null = null
    try { raw = localStorage.getItem(storageKey(projectId)) } catch { /* không đọc được thì bắt đầu từ đầu */ }
    state = parseNavigation(raw)
    caches.set(projectId, state)
  }
  return state
}
function commit(projectId: string, state: NavigationState): void {
  caches.set(projectId, state)
  try { localStorage.setItem(storageKey(projectId), JSON.stringify(state)) } catch { /* đầy hoặc bị khoá vẫn đi tiếp trong phiên này */ }
}

/** Thêm vị trí mới; mở lại đúng vị trí hiện tại thì không ghi, còn đi tiếp sẽ cắt lịch sử tương lai. */
export function recordNavigation(projectId: string, location: NavigationEntry): void {
  const state = load(projectId)
  if (same(state.entries[state.index], location)) return
  const entries = [...state.entries.slice(0, state.index + 1), location].slice(-LIMIT)
  commit(projectId, { entries, index: entries.length - 1 })
}

export function navigationBack(projectId: string): NavigationEntry | null {
  const state = load(projectId)
  if (state.index <= 0) return null
  const index = state.index - 1
  commit(projectId, { ...state, index })
  return state.entries[index] ?? null
}

export function navigationForward(projectId: string): NavigationEntry | null {
  const state = load(projectId)
  if (state.index >= state.entries.length - 1) return null
  const index = state.index + 1
  commit(projectId, { ...state, index })
  return state.entries[index] ?? null
}
