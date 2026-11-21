// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDate, formatNumber, getLocale, localeTag, setLocale, subscribeLocale } from './locale'

const KEY = 'nexgraph.locale'

beforeEach(() => {
  localStorage.clear()
  setLocale('vi')
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  setLocale('vi')
})

describe('locale', () => {
  it('mặc định tiếng Việt và đọc giá trị hợp lệ từ localStorage', () => {
    localStorage.removeItem(KEY)
    expect(getLocale()).toBe('vi')
    expect(localeTag()).toBe('vi-VN')

    localStorage.setItem(KEY, 'en')
    expect(getLocale()).toBe('en')
    expect(localeTag()).toBe('en-US')

    localStorage.setItem(KEY, 'fr')
    expect(getLocale()).toBe('vi')
  })

  it('setLocale lưu vào localStorage và báo cho người đăng ký', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeLocale(listener)

    setLocale('en')
    expect(localStorage.getItem(KEY)).toBe('en')
    expect(getLocale()).toBe('en')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    setLocale('vi')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('giữ ngôn ngữ trong phiên khi localStorage lỗi', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    setLocale('en')
    expect(getLocale()).toBe('en')
    vi.restoreAllMocks()

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    setLocale('vi')
    expect(getLocale()).toBe('vi')
  })

  it('định dạng số và ngày theo ngôn ngữ hiện tại', () => {
    const date = '2024-01-02T12:00:00Z'
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }

    expect(formatNumber(1234.5)).toBe('1.234,5')
    expect(formatDate(date, options)).toBe('02/01/2024')

    setLocale('en')
    expect(formatNumber(1234.5)).toBe('1,234.5')
    expect(formatDate(date, options)).toBe('01/02/2024')
  })
})
