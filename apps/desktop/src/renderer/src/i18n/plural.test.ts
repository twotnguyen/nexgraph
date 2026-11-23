import { afterEach, describe, expect, it } from 'vitest'
import { plural, setLocale } from '../state/locale'
import { tr, vi } from '../strings'

/** MIN-45b (2): danh từ đếm được trong bản Anh phải theo số ít/số nhiều; tiếng Việt giữ nguyên. */
describe('số nhiều tiếng Anh', () => {
  afterEach(() => setLocale('vi'))

  it('plural() chọn dạng theo Intl.PluralRules', () => {
    setLocale('en')
    expect(plural(1, 'file', 'files')).toBe('file')
    expect(plural(0, 'file', 'files')).toBe('files')
    expect(plural(2, 'file', 'files')).toBe('files')
    // Tiếng Việt không biến đổi hình thái: luôn dùng dạng "other".
    setLocale('vi')
    expect(plural(1, 'tệp', 'tệp')).toBe('tệp')
  })

  it('tr() xử lý khối {count, plural, one {…} other {…}} trong bản Anh', () => {
    setLocale('en')
    expect(tr('{count} tệp', { count: 1 })).toBe('1 file')
    expect(tr('{count} tệp', { count: 3 })).toBe('3 files')
    // Không có vars thì giữ nguyên khối, không ném lỗi.
    expect(tr('{count} tệp')).toBe('{count} {count, plural, one {file} other {files}}')
    setLocale('vi')
    expect(tr('{count} tệp', { count: 1 })).toBe('1 tệp')
  })

  it('chuỗi đếm trong i18n EN dùng số ít khi n = 1', () => {
    setLocale('en')
    expect(vi.arch.files(1)).toBe('1 file')
    expect(vi.arch.files(2)).toBe('2 files')
    expect(vi.flows.meta(2, 1)).toBe('2 steps · 1 file')
    expect(vi.flows.meta(1, 2)).toBe('1 step · 2 files')
    expect(vi.changes.hops(1)).toBe('1 step')
    expect(vi.large.files(1)).toBe('1 file')
    expect(vi.overview.stats(1, 1, 1)).toBe('1 file · 1 node · 1 edge')
    expect(vi.overview.stats(2, 3, 4)).toBe('2 files · 3 nodes · 4 edges')
    setLocale('vi')
    expect(vi.flows.meta(2, 1)).toBe('2 bước · 1 tệp')
    expect(vi.overview.stats(1, 1, 1)).toBe('1 tệp · 1 node · 1 cạnh')
  })
})
