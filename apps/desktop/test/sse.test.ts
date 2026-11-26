import { describe, expect, it } from 'vitest'
import { parseSse } from '../src/main/platform/engine/events'

const ev = (o: object) => `data: ${JSON.stringify(o)}\n\n`

describe('parseSse', () => {
  it('parses a complete event', () => {
    const r = parseSse(ev({ type: 'graph_updated', project_id: 'p' }))
    expect(r.events).toEqual([{ type: 'graph_updated', project_id: 'p' }])
    expect(r.rest).toBe('')
  })

  it('keeps an event cut across chunks until it completes', () => {
    const full = ev({ type: 'graph_updated', project_id: 'p' })
    const first = parseSse(full.slice(0, 12))
    expect(first.events).toEqual([])
    const second = parseSse(first.rest + full.slice(12))
    expect(second.events).toEqual([{ type: 'graph_updated', project_id: 'p' }])
  })

  it('parses two events in one chunk', () => {
    const r = parseSse(ev({ a: 1 }) + ev({ a: 2 }))
    expect(r.events).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('ignores ping comments and bad JSON without throwing', () => {
    const r = parseSse(': ping\n\n' + 'data: {oops\n\n' + ev({ ok: true }))
    expect(r.events).toEqual([{ ok: true }])
  })

  it('handles CRLF separators and unicode', () => {
    const r = parseSse('data: {"message":"Đồ án"}\r\n\r\n')
    expect(r.events).toEqual([{ message: 'Đồ án' }])
  })
})
