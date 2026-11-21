import { describe, expect, it, vi } from 'vitest'
import { buildExcerpts, consumePendingMultiBuffer, getPendingMultiBuffer, requestMultiBuffer, subscribeMultiBuffer } from './multiBuffer'

describe('multiBuffer', () => {
  it('clamp đầu đoạn, gộp đoạn chồng lắp cùng tệp, giữ tệp khác', () => {
    expect(buildExcerpts([
      { file: 'a.ts', line: 1 },
      { file: 'b.ts', line: 10 },
      { file: 'a.ts', line: 4 },
      { file: 'a.ts', line: 20 }
    ])).toEqual([
      { id: 'a.ts:1-6', file: 'a.ts', startLine: 1, endLine: 6 },
      { id: 'a.ts:18-22', file: 'a.ts', startLine: 18, endLine: 22 },
      { id: 'b.ts:8-12', file: 'b.ts', startLine: 8, endLine: 12 }
    ])
  })

  it('yêu cầu được báo tới người nghe và tiêu thụ một lần', () => {
    const listener = vi.fn()
    const off = subscribeMultiBuffer(listener)
    const req = { id: 'm1', title: 'Nhiều đoạn', excerpts: buildExcerpts([{ file: 'a.ts', line: 3 }]) }
    requestMultiBuffer(req)
    expect(getPendingMultiBuffer()).toBe(req)
    expect(listener).toHaveBeenCalledTimes(1)
    consumePendingMultiBuffer()
    expect(getPendingMultiBuffer()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    requestMultiBuffer(req)
    expect(listener).toHaveBeenCalledTimes(2)
    consumePendingMultiBuffer()
  })
})
