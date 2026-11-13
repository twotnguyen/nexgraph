import { describe, expect, it, vi } from 'vitest'
import { EngineApiError, type EngineApi } from '../src/main/engine/api'
import { parseCitations, verifyCitations } from '../src/main/ai/citations'

describe('citations', () => {
  it('đọc các dạng trích dẫn', () => {
    expect(parseCitations('A [[src/auth.service.ts:28-52]] B [[lib/x.dart:55]] C [[src/auth.service.ts:28-52]] D [[không phải]]')).toEqual([
      { raw: '[[src/auth.service.ts:28-52]]', file: 'src/auth.service.ts', start: 28, end: 52 },
      { raw: '[[lib/x.dart:55]]', file: 'lib/x.dart', start: 55, end: 55 }])
  })

  it('kiểm chứng: hợp lệ, vượt cuối tệp, tệp không có', async () => {
    const code = vi.fn(async (_p: string, file: string, start: number, end: number) => {
      if (file === 'gone.ts') throw new EngineApiError(404, 'file_not_found', '')
      return { file, start, end: Math.min(end, 60), text: start > 60 ? '' : 'x', language: null, stale: false }
    })
    const c = await verifyCitations({ code } as unknown as EngineApi, 'p1', '[[a.ts:10-20]] [[a.ts:55-95]] [[a.ts:80-95]] [[gone.ts:1-2]]')
    expect(c.map((x) => [x.valid, x.reason])).toEqual([[true, null], [false, 'out_of_range'], [false, 'out_of_range'], [false, 'file_not_found']])
  })
})
