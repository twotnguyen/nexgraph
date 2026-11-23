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

  it('AI-01: đọc trích dẫn không ngoặc như model thật trả lời, có cả gạch ngang dài', async () => {
    expect(parseCitations('lib/a.dart:10–42\nsrc/main/app.ts:7.')).toEqual([
      { raw: 'lib/a.dart:10–42', file: 'lib/a.dart', start: 10, end: 42 },
      { raw: 'src/main/app.ts:7', file: 'src/main/app.ts', start: 7, end: 7 }])
    // Câu văn tiếng Việt đứng ngay trước trích dẫn: verifyCitations bỏ chữ thừa khi engine xác nhận tệp.
    const code = vi.fn(async (_p: string, file: string, start: number, end: number) => {
      if (file !== 'engine/src/nexgraph_engine/run.py') throw new EngineApiError(404, 'file_not_found', '')
      return { file, start, end, text: 'x', language: null, stale: false }
    })
    expect(await verifyCitations({ code } as unknown as EngineApi, 'p1', 'Theo engine/src/nexgraph_engine/run.py:96-98 thì usage luôn 0.')).toEqual([
      { raw: 'Theo engine/src/nexgraph_engine/run.py:96-98', file: 'engine/src/nexgraph_engine/run.py', start: 96, end: 98, valid: true, reason: null }])
    // Dạng có ngoặc không bị đếm hai lần; dạng Markdown link vẫn đọc được.
    expect(parseCitations('[[lib/a.dart:10–42]]')).toEqual([{ raw: '[[lib/a.dart:10–42]]', file: 'lib/a.dart', start: 10, end: 42 }])
    expect(parseCitations('[lib/a.dart:10-42](https://example.com/x)')).toEqual([{ raw: 'lib/a.dart:10-42', file: 'lib/a.dart', start: 10, end: 42 }])
  })

  it('M1: bỏ tiền tố gạch đầu dòng/số thứ tự/tiêu đề để số đếm khớp đúng chip sẽ vẽ', () => {
    // Markdown bỏ "- ", "1. ", "## " trước khi renderer thấy text node; `raw` phải bỏ luôn,
    // nếu không panel báo "N/N đã xác minh" mà không có chip nào bấm được.
    expect(parseCitations('- service.py:1-2\n1. app.py:8-9\n## flow app/service.py:4-7')).toEqual([
      { raw: 'service.py:1-2', file: 'service.py', start: 1, end: 2 },
      { raw: 'app.py:8-9', file: 'app.py', start: 8, end: 9 },
      { raw: 'flow app/service.py:4-7', file: 'flow app/service.py', start: 4, end: 7 }])
    // Trích dẫn trong inline code và trong danh sách có ngoặc vẫn đọc được, không dính dấu `.
    expect(parseCitations('- [[service.py:4-7]]\n- `app.py:8-9`')).toEqual([
      { raw: '[[service.py:4-7]]', file: 'service.py', start: 4, end: 7 },
      { raw: 'app.py:8-9', file: 'app.py', start: 8, end: 9 }])
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

  it('AI-02: đường dẫn có dấu cách — trong ngoặc đọc trọn, không ngoặc thì engine xác định lại', async () => {
    expect(parseCitations('[[flow app/service.py:1-2]]')).toEqual([{ raw: '[[flow app/service.py:1-2]]', file: 'flow app/service.py', start: 1, end: 2 }])
    expect(parseCitations('[[ docs/my file.md : 3 – 9 ]]')).toEqual([{ raw: '[[ docs/my file.md : 3 – 9 ]]', file: 'docs/my file.md', start: 3, end: 9 }])
    // Dạng không ngoặc: parser giữ cả cụm có dấu cách, verifyCitations bỏ chữ thừa của câu khi engine xác nhận tệp.
    expect(parseCitations('Xem flow app/service.py:1-2 ngay')).toEqual([{ raw: 'Xem flow app/service.py:1-2', file: 'Xem flow app/service.py', start: 1, end: 2 }])
    const code = vi.fn(async (_p: string, file: string, start: number, end: number) => {
      if (file !== 'flow app/service.py') throw new EngineApiError(404, 'file_not_found', '')
      return { file, start, end, text: 'x', language: null, stale: false }
    })
    expect(await verifyCitations({ code } as unknown as EngineApi, 'p1', 'Xem flow app/service.py:1-2 ngay')).toEqual([
      { raw: 'Xem flow app/service.py:1-2', file: 'flow app/service.py', start: 1, end: 2, valid: true, reason: null }])
    expect(code).toHaveBeenCalledWith('p1', 'flow app/service.py', 1, 2)
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
