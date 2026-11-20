import { describe, expect, it } from 'vitest'
import { vi as t } from './strings'

describe('vi.path.found', () => {
  it('ghi độ tin cậy của hop yếu nhất', () => {
    expect(t.path.found(3, { level: 'INFERRED', score: 0.6, hop: 2 })).toBe('Đường đi 3 bước · tin cậy: suy luận 0,6 (bước 2)')
    expect(t.path.found(1, { level: 'EXTRACTED', score: null, hop: 1 })).toBe('Đường đi 1 bước · tin cậy: trích từ mã')
    expect(t.path.found(2, null)).toBe('Đường đi 2 bước')
  })
})
