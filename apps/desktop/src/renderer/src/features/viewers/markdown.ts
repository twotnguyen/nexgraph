export type MarkdownReference =
  | { kind: 'file'; file: string; fragment: string }
  | { kind: 'fragment'; fragment: string }
  | { kind: 'external'; url: string }

/** Đường dẫn Markdown tương đối với tệp nguồn; dấu / đầu chỉ gốc dự án. */
export function resolveReference(sourceFile: string, raw: string): MarkdownReference | null {
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      return url.username || url.password ? null : { kind: 'external', url: url.href }
    } catch { return null }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('//')) return null
  const hash = raw.indexOf('#')
  const fragment = hash < 0 ? '' : raw.slice(hash + 1)
  const withoutFragment = hash < 0 ? raw : raw.slice(0, hash)
  const path = withoutFragment.split('?')[0]
  if (!path) return fragment ? { kind: 'fragment', fragment } : null
  let decoded: string
  try { decoded = decodeURIComponent(path).replace(/\\/g, '/') } catch { return null }
  if (decoded.includes('\0') || /^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith('//')) return null
  const parts = decoded.startsWith('/') ? [] : sourceFile.replace(/\\/g, '/').split('/').slice(0, -1)
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else parts.push(part)
  }
  return parts.length ? { kind: 'file', file: parts.join('/'), fragment } : null
}

export type TaskEdit = { line: number; startColumn: number; endColumn: number; text: string }

/** Vị trí marker từ vị trí list item do parser Markdown cung cấp (dòng/cột tính từ 1). */
export function taskEdit(source: string, line: number, column: number, checked: boolean): TaskEdit | null {
  const current = source.split('\n')[line - 1]
  if (!current || column < 1) return null
  const match = /^(?:[-+*]|\d+[.)])\s+\[([ xX])\](?=\s|$)/.exec(current.slice(column - 1))
  if (!match || (match[1].toLowerCase() === 'x') === checked) return null
  const startColumn = column + match[0].length - 3
  return { line, startColumn, endColumn: startColumn + 3, text: checked ? '[x]' : '[ ]' }
}

/** Khối code rào (``` hoặc ~~~) đã có dòng đóng; khối chưa đóng kéo dài đến hết tài liệu nên chưa vẽ sơ đồ khi người dùng còn đang gõ. */
export function isFenceClosed(source: string, start: number, end: number): boolean {
  const lines = source.slice(start, end).split('\n')
  const open = /^\s*(`{3,}|~{3,})/.exec(lines[0])
  const close = /^[\s>]*(`{3,}|~{3,})\s*$/.exec(lines[lines.length - 1])
  return lines.length > 1 && !!open && !!close && close[1][0] === open[1][0] && close[1].length >= open[1].length
}
