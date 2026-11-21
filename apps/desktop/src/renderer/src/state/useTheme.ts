import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const storageKey = 'nexgraph.theme'

/** Bảng màu từng theme nằm trong styles.css (`:root[data-theme='…']`); các theme ngoài light/dark lấy từ theme MIT của Wu. */
export const THEMES: ReadonlyArray<{ id: string; name: string; appearance: Theme }> = [
  { id: 'light', name: 'NexGraph Sáng', appearance: 'light' },
  { id: 'wu-light', name: 'Wu Light', appearance: 'light' },
  { id: 'one-light', name: 'One Light', appearance: 'light' },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', appearance: 'light' },
  { id: 'dark', name: 'NexGraph Tối', appearance: 'dark' },
  { id: 'wu-dark', name: 'Wu Dark', appearance: 'dark' },
  { id: 'one-dark', name: 'One Dark', appearance: 'dark' },
  { id: 'catppuccin-frappe', name: 'Catppuccin Frappé', appearance: 'dark' },
  { id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato', appearance: 'dark' },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', appearance: 'dark' }
]

export function currentTheme(): Theme {
  const classes = document.body?.classList
  if (window.nexgraph?.host) {
    return classes?.contains('vscode-dark') || classes?.contains('vscode-high-contrast') ? 'dark' : 'light'
  }
  return document.documentElement.dataset.appearance === 'dark' ? 'dark' : 'light'
}

export function currentThemeId(): string {
  return document.documentElement.dataset.theme ?? currentTheme()
}

/** Đổi theme trong phiên mà không lưu: dùng để xem trước khi rê qua danh sách. */
export function previewTheme(id: string): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]
  document.documentElement.dataset.appearance = theme.appearance
  document.documentElement.dataset.theme = theme.id
}

export function initializeTheme(): void {
  if (window.nexgraph?.host) return
  let saved: string | null = null
  try {
    saved = localStorage.getItem(storageKey)
  } catch {
    // App vẫn dùng được khi môi trường không cho lưu cài đặt.
  }
  previewTheme(THEMES.some((t) => t.id === saved) ? saved!
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

export function setTheme(id: string): void {
  previewTheme(id)
  try {
    localStorage.setItem(storageKey, id)
  } catch {
    // Áp dụng được trong phiên hiện tại ngay cả khi không lưu được.
  }
}

export function observeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  if (window.nexgraph?.host) observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  else observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

export function useTheme(): Theme {
  return useSyncExternalStore(observeTheme, currentTheme)
}

export function useThemeId(): string {
  return useSyncExternalStore(observeTheme, currentThemeId)
}
