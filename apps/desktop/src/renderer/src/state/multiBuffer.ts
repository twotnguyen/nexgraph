export type BufferExcerpt = { id: string; file: string; startLine: number; endLine: number; label?: string }
import type { Message } from './messages'

export type MultiBufferRequest = { id: string; title: Message; excerpts: BufferExcerpt[] }

let pending: MultiBufferRequest | null = null
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

export function requestMultiBuffer(req: MultiBufferRequest): void {
  pending = req
  notify()
}

export function subscribeMultiBuffer(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getPendingMultiBuffer(): MultiBufferRequest | null {
  return pending
}

export function consumePendingMultiBuffer(): void {
  if (!pending) return
  pending = null
  notify()
}

/** Mỗi dòng thành một đoạn quanh dòng đó; các đoạn chồng lắp (hoặc kề nhau) cùng tệp gộp thành một. */
export function buildExcerpts(files: { file: string; line: number }[], contextLines = 2): BufferExcerpt[] {
  const byFile = new Map<string, BufferExcerpt[]>()
  for (const { file, line } of files) {
    const startLine = Math.max(1, line - contextLines)
    const endLine = line + contextLines
    const ranges = byFile.get(file) ?? []
    ranges.push({ id: `${file}:${startLine}-${endLine}`, file, startLine, endLine })
    byFile.set(file, ranges)
  }
  const result: BufferExcerpt[] = []
  for (const ranges of byFile.values()) {
    ranges.sort((a, b) => a.startLine - b.startLine)
    for (const next of ranges) {
      const last = result.at(-1)
      if (last && last.file === next.file && next.startLine <= last.endLine + 1) {
        last.endLine = Math.max(last.endLine, next.endLine)
        last.id = `${last.file}:${last.startLine}-${last.endLine}`
      } else result.push({ ...next })
    }
  }
  return result
}
