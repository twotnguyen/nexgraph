import type { IndexOptions } from '../shared/graph-types'
import { readJson, writeJson } from './ai/settings'

/** Lựa chọn của hộp thoại Index được nhớ theo dự án; `force` và `subdir` là của một lần chạy nên không dính. */
const STICKY = ['exclude', 'includeDocs', 'includeMedia', 'includeConfig', 'workers'] as const
type Sticky = Pick<IndexOptions, (typeof STICKY)[number]>

const isSticky = (key: string): key is (typeof STICKY)[number] => (STICKY as readonly string[]).includes(key)

/** Kiểu đúng của từng trường nhớ; tệp hỏng tay/sai phiên bản chỉ mất đúng trường đó (review-50 M2). */
const wellTyped = (key: (typeof STICKY)[number], value: unknown): boolean => {
  if (key === 'exclude') return Array.isArray(value) && value.every((item) => typeof item === 'string')
  if (key === 'workers') return Number.isInteger(value)
  return typeof value === 'boolean'
}

const clean = (opts: IndexOptions | undefined): IndexOptions => {
  if (!opts) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(opts)) if (value !== undefined) out[key] = value
  return out as IndexOptions
}

/**
 * Nhớ lựa chọn lập chỉ mục theo dự án (A3 #7): "Index lại" chỉ gửi `{}` nên nếu không nhớ,
 * engine rơi về mặc định và tài liệu/nguồn đã bật biến mất khỏi graph.
 * Nguồn bổ sung (W11) do `IndexSourceStore` giữ; ở đây chỉ các cờ của hộp thoại.
 */
export class IndexOptionsStore {
  constructor(private readonly file: string) {}

  remembered(pid: string): Sticky | null {
    const entry = readJson(this.file)[pid]
    if (!entry || typeof entry !== 'object') return null
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (isSticky(key) && value !== undefined && wellTyped(key, value)) out[key] = value
    }
    return Object.keys(out).length > 0 ? (out as Sticky) : null
  }

  forget(pid: string): void {
    const all = readJson(this.file)
    if (!(pid in all)) return
    delete all[pid]
    writeJson(this.file, all)
  }

  /** Ghi phần lựa chọn được gửi tường minh rồi trả `opts` đã trộn với bản nhớ (bản gửi thắng). */
  resolve(pid: string, opts?: IndexOptions): IndexOptions | undefined {
    const given = clean(opts)
    const explicit = Object.fromEntries(Object.entries(given).filter(([key]) => isSticky(key)))
    const saved = this.remembered(pid)
    if (Object.keys(explicit).length > 0) {
      writeJson(this.file, { ...readJson(this.file), [pid]: { ...saved, ...explicit } })
    }
    if (!saved) return opts
    return { ...saved, ...given }
  }
}
