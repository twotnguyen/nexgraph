import type { LspDocumentSymbol, LspPosition, LspRange } from '@nexgraph/contracts/api'

/** Mọi toạ độ trong module này là LSP: dòng và cột đều tính từ 0. */
const compare = (a: LspPosition, b: LspPosition) => a.line - b.line || a.character - b.character

/** Biên cuối cũng tính là nằm trong: Monaco đặt con trỏ ở cuối sau setSelection. */
export function positionInRange(range: LspRange, position: LspPosition): boolean {
  return compare(position, range.start) >= 0 && compare(position, range.end) <= 0
}

const narrower = (a: LspRange, b: LspRange) => compare(a.start, b.start) > 0 ||
  (compare(a.start, b.start) === 0 && compare(a.end, b.end) < 0)

/** Node nhỏ nhất chứa con trỏ; không có symbol hoặc con trỏ ở ngoài cây thì trả null. */
export function smallestSymbolAt(symbols: readonly LspDocumentSymbol[], position: LspPosition): LspDocumentSymbol | null {
  let found: LspDocumentSymbol | null = null
  const visit = (list: readonly LspDocumentSymbol[]) => {
    for (const symbol of list) {
      if (positionInRange(symbol.range, position)) {
        if (!found || narrower(symbol.range, found.range)) found = symbol
        visit(symbol.children ?? [])
      }
    }
  }
  visit(symbols)
  return found
}

/** Node bao ngoài gần nhất, vẫn chứa con trỏ; trả null khi đã ở gốc. */
export function largerSymbolAt(symbols: readonly LspDocumentSymbol[], current: LspDocumentSymbol, position: LspPosition): LspDocumentSymbol | null {
  let found: LspDocumentSymbol | null = null
  const visit = (list: readonly LspDocumentSymbol[]) => {
    for (const symbol of list) {
      if (positionInRange(symbol.range, position) && narrower(current.range, symbol.range) && (!found || narrower(symbol.range, found.range))) found = symbol
      visit(symbol.children ?? [])
    }
  }
  visit(symbols)
  return found
}

/** Node trước đó trong history stack (lần thu hẹp gần nhất). */
export function previousFromHistory<T>(history: readonly T[]): T | null {
  return history.at(-1) ?? null
}

/** Anh/em cùng cha theo thứ tự nguồn; trả null khi không còn hướng đó. */
export function siblingSymbol(symbols: readonly LspDocumentSymbol[], current: LspDocumentSymbol, direction: 1 | -1): LspDocumentSymbol | null {
  let siblings: readonly LspDocumentSymbol[] = []
  let found = false
  const visit = (list: readonly LspDocumentSymbol[]) => {
    if (found) return
    if (list.some((symbol) => symbol === current)) { siblings = list; found = true; return }
    for (const symbol of list) visit(symbol.children ?? [])
  }
  visit(symbols)
  if (siblings.length === 0) return null
  const ordered = [...siblings].sort((a, b) => compare(a.range.start, b.range.start))
  return ordered[ordered.indexOf(current) + direction] ?? null
}
