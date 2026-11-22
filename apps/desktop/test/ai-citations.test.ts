import { describe, expect, it, vi } from 'vitest'
import { EngineApiError, type EngineApi } from '../src/main/engine/api'
import { parseCitations, verifyCitations } from '../src/main/ai/citations'
import { NEXGRAPH_RULES, acpRules } from '../src/main/agent/skill'

describe('citations', () => {
  it('đọc các dạng trích dẫn', () => {
    expect(parseCitations('A [[src/auth.service.ts:28-52]] B [[lib/x.dart:55]] C [[src/auth.service.ts:28-52]] D [[không phải]]')).toEqual([
      { raw: '[[src/auth.service.ts:28-52]]', file: 'src/auth.service.ts', start: 28, end: 52 },
      { raw: '[[lib/x.dart:55]]', file: 'lib/x.dart', start: 55, end: 55 }])
  })

  it('AI-01: đọc trích dẫn không ngoặc như model thật trả lời, có cả gạch ngang dài', () => {
    expect(parseCitations('Xem lib/a.dart:10–42 rồi src/main/app.ts:7.')).toEqual([
      { raw: 'lib/a.dart:10–42', file: 'lib/a.dart', start: 10, end: 42 },
      { raw: 'src/main/app.ts:7', file: 'src/main/app.ts', start: 7, end: 7 }])
    // Câu văn tiếng Việt đứng ngay trước trích dẫn: không nuốt chữ vào đường dẫn.
    expect(parseCitations('Theo engine/src/nexgraph_engine/run.py:96-98 thì usage luôn 0.')).toEqual([
      { raw: 'engine/src/nexgraph_engine/run.py:96-98', file: 'engine/src/nexgraph_engine/run.py', start: 96, end: 98 }])
    // Dạng có ngoặc không bị đếm hai lần; dạng Markdown link vẫn đọc được.
    expect(parseCitations('[[lib/a.dart:10–42]]')).toEqual([{ raw: '[[lib/a.dart:10–42]]', file: 'lib/a.dart', start: 10, end: 42 }])
    expect(parseCitations('[lib/a.dart:10-42](https://example.com/x)')).toEqual([{ raw: 'lib/a.dart:10-42', file: 'lib/a.dart', start: 10, end: 42 }])
  })

  it('AI-01: không bắt nhầm giờ, mục, URL, số phiên bản hay placeholder', () => {
    expect(parseCitations('Lúc 10:30 · mục 3:12-15 · https://example.com:8080/a · bản 1.2.3:45 · [[không phải]] · [[file:start-end]] · ngày 2026-11-23:5-7')).toEqual([])
  })

  it('AI-01: chỉ dẫn hệ thống dạy đúng dạng có ngoặc mà parser đọc được', () => {
    expect(NEXGRAPH_RULES).toContain('[[đường_dẫn:dòng_đầu–dòng_cuối]]')
    const rules = acpRules('ask')
    expect(rules).toContain(NEXGRAPH_RULES)
    expect(rules).not.toContain('[[file:start-end]]')
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
