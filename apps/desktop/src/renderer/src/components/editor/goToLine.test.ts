import { describe, expect, it } from 'vitest'
import { parseGoToLine } from './goToLine'

describe('parseGoToLine', () => {
  it('parses an absolute line with an optional column', () => {
    expect(parseGoToLine(' 12:5 ', 4, 30)).toEqual({ line: 12, column: 5 })
    expect(parseGoToLine('12', 4, 30)).toEqual({ line: 12, column: 1 })
  })

  it('parses relative offsets and clamps to the document', () => {
    expect(parseGoToLine('+3', 4, 30)).toEqual({ line: 7, column: 1 })
    expect(parseGoToLine('-9', 4, 30)).toEqual({ line: 1, column: 1 })
    expect(parseGoToLine('F40:2', 4, 30)).toEqual({ line: 30, column: 2 })
    expect(parseGoToLine('b2', 4, 30)).toEqual({ line: 2, column: 1 })
  })

  it('rejects malformed input, zero coordinates and unsafe integers', () => {
    for (const input of ['', '0', '2:0', '2:', '1:2:3', '2x', '+', '9007199254740992']) {
      expect(parseGoToLine(input, 4, 30)).toBeNull()
    }
  })
})
