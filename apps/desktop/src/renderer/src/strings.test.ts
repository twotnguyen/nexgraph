import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from './state/locale'
import { tr, vi as t } from './strings'

afterEach(() => setLocale('vi'))

describe('vi.path.found', () => {
  it('ghi độ tin cậy của hop yếu nhất', () => {
    expect(t.path.found(3, { level: 'INFERRED', score: 0.6, hop: 2 })).toBe('Đường đi 3 bước · tin cậy: suy luận 0,6 (bước 2)')
    expect(t.path.found(1, { level: 'EXTRACTED', score: null, hop: 1 })).toBe('Đường đi 1 bước · tin cậy: trích từ mã')
    expect(t.path.found(2, null)).toBe('Đường đi 2 bước')
  })
})

describe('i18n', () => {
  it('đổi dictionary ngay khi đổi locale', () => {
    setLocale('vi')
    expect(t.accounts.title).toBe('Tài khoản AI')
    setLocale('en')
    expect(t.accounts.title).toBe('AI accounts')
    expect(t.indexing.titleDone('demo')).toBe('Indexed: demo')
  })

  it('enStrings có đủ các nhóm của bản tiếng Việt', () => {
    setLocale('vi')
    const groups = Object.keys(t) as (keyof typeof t)[]
    expect(groups).toHaveLength(34)
    setLocale('en')
    for (const group of groups) expect(t[group]).toBeDefined()
  })

  it('tr thay biến và giữ nguyên chuỗi khi thiếu bản dịch', () => {
    const missing = 'chưa có bản __test_missing_translation__'
    setLocale('vi')
    expect(tr('Đã gỡ {name}…', { name: 'demo' })).toBe('Đã gỡ demo…')
    setLocale('en')
    expect(tr(missing)).toBe(missing)
    expect(tr(`${missing} {name}`, { name: 'demo' })).toBe(`${missing} demo`)
    expect(tr(`${missing} n={n}`, { n: 2 })).toBe(`${missing} n=2`)
  })

  it('dịch nhãn chẩn đoán và đồng tác giả sang tiếng Anh', () => {
    setLocale('en')
    expect(tr('Bao gồm cảnh báo')).toBe('Include warnings')
    expect(tr('Làm mới chẩn đoán')).toBe('Refresh diagnostics')
    expect(tr('Đang làm mới…')).toBe('Refreshing…')
    expect(tr('Đang tải…')).toBe('Downloading…')
    expect(tr('Đồng tác giả')).toBe('Co-authors')
    expect(tr('Thêm đồng tác giả')).toBe('Add co-author')
    expect(tr('Tên và email đồng tác giả')).toBe('Co-author name and email')
    expect(tr('Tên <email>')).toBe('Name <email>')
  })
})
