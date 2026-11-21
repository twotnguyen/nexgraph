/** Dấu phân cách theo đuôi tệp; null nếu không phải CSV/TSV. */
export const delimiterFor = (file: string): string | null => /\.csv$/i.test(file) ? ',' : /\.tsv$/i.test(file) ? '\t' : null

export interface ParsedTable {
  /** Mỗi bản ghi giữ đúng số ô đọc được; dòng thiếu cột không được độn. */
  rows: string[][]
  /** Số ô của bản ghi dài nhất. */
  columns: number
  /** Dòng (từ 1) trong tệp nguồn nơi mỗi bản ghi bắt đầu; ô có xuống dòng làm một bản ghi trải nhiều dòng. */
  lines: number[]
  /** Còn bản ghi phía sau `limit` dòng đã trả về. */
  truncated: boolean
}

/**
 * Tách CSV/TSV theo RFC 4180: ô trong ngoặc kép có thể chứa dấu phân cách, xuống dòng và `""` (một dấu "). Chấp nhận `\n`, `\r\n`, `\r`.
 * Ngoặc kép chỉ mở ô ở đầu ô; ở giữa ô được giữ nguyên chữ. Dòng trống không phải bản ghi. Dừng sớm sau `limit` bản ghi.
 */
export function parseDelimited(text: string, delimiter: string, limit = Infinity): ParsedTable {
  const table: ParsedTable = { rows: [], columns: 0, lines: [], truncated: false }
  let row: string[] = []
  let field = ''
  let atStart = true
  let quoted = false
  let line = 1
  let rowLine = 1
  // true khi dừng vì bản ghi này vượt `limit`.
  const endRow = (): boolean => {
    row.push(field)
    if (row.length > 1 || row[0].trim()) {
      if (table.rows.length === limit) {
        table.truncated = true
        return true
      }
      table.rows.push(row)
      table.lines.push(rowLine)
      table.columns = Math.max(table.columns, row.length)
    }
    row = []
    field = ''
    atStart = true
    rowLine = line
    return false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') {
        field += c
        if (c === '\n') line++
      } else if (text[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
    } else if (c === delimiter) {
      row.push(field)
      field = ''
      atStart = true
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      line++
      if (endRow()) return table
    } else if (c === '"' && atStart) {
      quoted = true
      atStart = false
    } else {
      field += c
      atStart = false
    }
  }
  endRow()
  return table
}
