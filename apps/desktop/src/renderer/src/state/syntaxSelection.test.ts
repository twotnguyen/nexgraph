import { describe, expect, it } from 'vitest'
import type { LspDocumentSymbol, LspRange } from '@nexgraph/contracts/api'
import { largerSymbolAt, previousFromHistory, siblingSymbol, smallestSymbolAt } from './syntaxSelection'

const range = (startLine: number, startCharacter: number, endLine: number, endCharacter: number): LspRange => ({
  start: { line: startLine, character: startCharacter }, end: { line: endLine, character: endCharacter }
})
const symbol = (name: string, node: LspRange, children: LspDocumentSymbol[] = []): LspDocumentSymbol => ({
  name, kind: 5, range: node, selectionRange: node, children
})

const left = symbol('left', range(1, 2, 1, 8))
const right = symbol('right', range(2, 2, 2, 9))
const inner = symbol('inner', range(1, 0, 3, 0), [left, right])
const tree = [symbol('outer', range(0, 0, 4, 0), [inner])]

describe('syntaxSelection (toạ độ LSP 0-based)', () => {
  it('chọn node nhỏ nhất chứa con trỏ, trả null khi không có symbol', () => {
    expect(smallestSymbolAt(tree, { line: 1, character: 4 })).toBe(left)
    expect(smallestSymbolAt(tree, { line: 1, character: 1 })).toBe(inner)
    expect(smallestSymbolAt([], { line: 1, character: 4 })).toBeNull()
    expect(smallestSymbolAt(tree, { line: 9, character: 0 })).toBeNull()
  })

  it('mở rộng lên node chứa tiếp theo và dừng ở gốc', () => {
    expect(largerSymbolAt(tree, left, { line: 1, character: 4 })).toBe(inner)
    expect(largerSymbolAt(tree, inner, { line: 1, character: 4 })).toBe(tree[0])
    expect(largerSymbolAt(tree, tree[0], { line: 1, character: 4 })).toBeNull()
    expect(largerSymbolAt([], left, { line: 1, character: 4 })).toBeNull()
  })

  it('lấy node trước đó từ history và trả null khi history rỗng', () => {
    expect(previousFromHistory([tree[0], inner])).toBe(inner)
    expect(previousFromHistory([])).toBeNull()
  })

  it('chuyển sang sibling next/prev, trả null khi không có sibling', () => {
    expect(siblingSymbol(tree, left, 1)).toBe(right)
    expect(siblingSymbol(tree, right, -1)).toBe(left)
    expect(siblingSymbol(tree, tree[0], 1)).toBeNull()
    expect(siblingSymbol([], left, 1)).toBeNull()
  })
})
