import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const storageKey = 'nexgraph.theme'

/** Bảng màu từng theme nằm trong styles.css (`:root[data-theme='…']`); các theme ngoài light/dark lấy từ theme MIT của Wu. Extension thêm theme bằng `addThemes`. */
export const THEMES: { id: string; name: string; appearance: Theme }[] = [
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

const THEMES_CHANGED = 'nexgraph:themes'
/** Theme của extension: thêm vào danh sách và áp bảng màu bằng một thẻ <style> (biến màu đã kiểm ở main). Theme đã lưu là theme extension thì áp lại. */
export function addThemes(themes: readonly { id: string; name: string; appearance: Theme; colors: Record<string, string> }[]): void {
  let style = document.getElementById('nexgraph-extension-themes')
  if (!style) {
    style = document.createElement('style')
    style.id = 'nexgraph-extension-themes'
    document.head.appendChild(style)
  }
  for (let i = THEMES.length - 1; i >= 0; i--) if (THEMES[i].id.startsWith('ext-')) THEMES.splice(i, 1)
  THEMES.push(...themes.map(({ id, name, appearance }) => ({ id, name, appearance })))
  style.textContent = themes.map((t) => `:root[data-theme='${t.id}']{${Object.entries(t.colors).map(([k, v]) => `${k}:${v}`).join(';')}}`).join('\n')
  let saved: string | null = null
  try { saved = localStorage.getItem(storageKey) } catch { /* bỏ qua */ }
  if (saved?.startsWith('ext-') && themes.some((t) => t.id === saved) && currentThemeId() !== saved) previewTheme(saved)
  themesVersion++
  window.dispatchEvent(new Event(THEMES_CHANGED))
}
let themesVersion = 0
/** Số lần danh sách theme đổi: component đọc THEMES dùng để vẽ lại khi extension thêm theme. */
export const useThemesVersion = (): number => useSyncExternalStore((l) => { window.addEventListener(THEMES_CHANGED, l); return () => window.removeEventListener(THEMES_CHANGED, l) }, () => themesVersion)
