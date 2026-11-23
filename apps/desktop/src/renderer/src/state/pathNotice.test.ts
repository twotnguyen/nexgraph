import { afterEach, describe, expect, it } from 'vitest'
import type { PathConfidence } from '@shared/graph-types'
import { setLocale } from './locale'
import { msgText } from './messages'
import { askNotice, pathFound, pathNoLink } from './pathNotice'

/**
 * M4 (review #57): câu "đường đi / không có liên kết" từng lấy `vi.path.found()`/`vi.path.noLink`
 * rồi chốt vào state — đổi ngôn ngữ tại chỗ không đổi câu. Phải dựng bằng khoá `Msg`.
 */
const confidence = (level: PathConfidence['level'], score: number | null, hop: number): PathConfidence => ({ level, score, hop })

describe('câu thông báo đường đi dịch lúc render', () => {
  afterEach(() => setLocale('vi'))

  it('đổi VI ⇄ EN tại chỗ, kể cả số bước và độ tin cậy', () => {
    setLocale('vi')
    expect(msgText(pathNoLink())).toBe('Không tìm thấy liên kết trực tiếp trong graph')
    expect(msgText(pathFound(2))).toBe('Đường đi 2 bước')
    expect(msgText(pathFound(1, confidence('EXTRACTED', null, 1)))).toBe('Đường đi 1 bước · tin cậy: trích từ mã')
    expect(msgText(pathFound(3, confidence('INFERRED', 0.82, 2)))).toBe('Đường đi 3 bước · tin cậy: suy luận 0,82 (bước 2)')

    setLocale('en')
    expect(msgText(pathNoLink())).toBe('No direct link found in the graph')
    expect(msgText(pathFound(2))).toBe('Path of 2 steps')
    expect(msgText(pathFound(1))).toBe('Path of 1 step')
    expect(msgText(pathFound(1, confidence('EXTRACTED', null, 1)))).toBe('Path of 1 step · confidence: from code')
    expect(msgText(pathFound(3, confidence('INFERRED', 0.82, 2)))).toBe('Path of 3 steps · confidence: inferred 0.82 (hop 2)')
  })

  it('câu trả lời trên graph: không khớp / cắt ngân sách / im lặng', () => {
    setLocale('vi')
    expect(msgText(askNotice(0, false))).toBe('Không tìm thấy node nào khớp câu hỏi')
    expect(msgText(askNotice(2, true))).toBe('Đã cắt theo ngân sách 2.000 token')
    expect(askNotice(2, false)).toBeNull()
    setLocale('en')
    expect(msgText(askNotice(0, false))).toBe('No nodes matching the question were found')
    expect(msgText(askNotice(2, true))).toBe('Truncated to a 2,000-token budget')
  })
})
