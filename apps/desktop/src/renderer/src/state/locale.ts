import { useSyncExternalStore } from 'react'

export type Locale = 'vi' | 'en'

const STORAGE_KEY = 'nexgraph.locale'
const LOCALE_EVENT = 'nexgraph:locale'

/** Giữ giá trị trong phiên khi localStorage không lưu được. */
let memory: Locale | null = null
let last: Locale = 'vi'

export function getLocale(): Locale {
  if (memory) return memory
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    last = saved === 'en' || saved === 'vi' ? saved : 'vi'
  } catch {
    // Dùng giá trị cuối cùng khi storage không đọc được.
  }
  return last
}

/** `lang` của tài liệu để screen reader/ngữ âm đọc đúng ngôn ngữ UI (MIN-45b). */
function applyDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

export function setLocale(locale: Locale): void {
  last = locale
  applyDocumentLang(locale)
  try {
    localStorage.setItem(STORAGE_KEY, locale)
    memory = null
  } catch {
    memory = locale
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCALE_EVENT))
}

export function subscribeLocale(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(LOCALE_EVENT, cb)
  return () => window.removeEventListener(LOCALE_EVENT, cb)
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale)
}

export function localeTag(): 'vi-VN' | 'en-US' {
  return getLocale() === 'en' ? 'en-US' : 'vi-VN'
}

const pluralRules: Partial<Record<Locale, Intl.PluralRules>> = {}

/** Dạng số nhiều theo ngôn ngữ hiện tại; tiếng Việt không biến đổi hình thái nên luôn là `other`. */
export function plural(count: number, one: string, other: string): string {
  const rules = (pluralRules[getLocale()] ??= new Intl.PluralRules(localeTag()))
  return rules.select(count) === 'one' ? one : other
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeTag(), options).format(value)
}

export function formatDate(value: number | Date | string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(localeTag(), options).format(typeof value === 'string' ? new Date(value) : value)
}

// index.html để lang="vi" tĩnh: đặt lại ngay khi nạp để lần mở sau dùng đúng ngôn ngữ đã lưu.
if (typeof document !== 'undefined') applyDocumentLang(getLocale())
