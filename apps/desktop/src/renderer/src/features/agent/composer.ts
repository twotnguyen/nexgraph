import { tr } from '../../i18n/strings'

export type CompletionToken = { kind: 'command' | 'mention'; start: number; end: number; query: string }

/** Chỉ mở gợi ý ở đầu một từ; đường dẫn tuyệt đối không phải lệnh. */
export function completionToken(text: string, cursor: number): CompletionToken | null {
  if (cursor < 0 || cursor > text.length) return null
  let start = cursor
  while (start > 0 && !/[\s([{>]/.test(text[start - 1])) start--
  const marker = text[start]
  if (marker !== '/' && marker !== '@') return null
  const kind = marker === '/' ? 'command' : 'mention'
  const valid = kind === 'command' ? /[\p{L}\p{N}_.:-]/u : /[^\s@`]/u
  const query = text.slice(start + 1, cursor)
  if (![...query].every((character) => valid.test(character))) return null
  let end = cursor
  while (end < text.length && valid.test(text[end])) end++
  if (kind === 'command' && text[end] === '/') return null
  return { kind, start, end, query }
}

export function filterSlashCommands<T extends { name: string }>(commands: readonly T[], query: string): T[] {
  const needle = query.toLowerCase()
  const prefix: T[] = []
  const rest: T[] = []
  for (const command of commands) {
    const name = command.name.toLowerCase()
    if (name.startsWith(needle)) prefix.push(command)
    else if (name.includes(needle)) rest.push(command)
  }
  return [...prefix, ...rest]
}

export function imageError(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) return tr('{name}: chỉ hỗ trợ ảnh PNG, JPG, GIF hoặc WebP.', { name: file.name })
  if (file.size === 0) return tr('{name}: tệp ảnh rỗng.', { name: file.name })
  if (file.size > 24 * 1024 * 1024) return tr('{name}: ảnh lớn hơn 24 MB.', { name: file.name })
  return null
}

export function removeQueued<T extends { id: number }>(queue: readonly T[], id: number): T[] {
  return queue.filter((item) => item.id !== id)
}

export function replaceQueued<T extends { id: number }>(queue: readonly T[], id: number, replacement: T): T[] {
  return queue.map((item) => item.id === id ? replacement : item)
}

export function takeQueued<T extends { id: number }>(queue: readonly T[], editing?: number | null): { item: T; queue: T[] } | null {
  const index = queue.findIndex((item) => item.id !== editing)
  return index < 0 ? null : { item: queue[index], queue: [...queue.slice(0, index), ...queue.slice(index + 1)] }
}
