import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const storageKey = 'nexgraph.theme'

export function currentTheme(): Theme {
  const classes = document.body?.classList
  if (window.nexgraph?.host) {
    return classes?.contains('vscode-dark') || classes?.contains('vscode-high-contrast') ? 'dark' : 'light'
  }
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function initializeTheme(): void {
  if (window.nexgraph?.host) return
  let saved: string | null = null
  try {
    saved = localStorage.getItem(storageKey)
  } catch {
    // App vẫn dùng được khi môi trường không cho lưu cài đặt.
  }
  document.documentElement.dataset.theme = saved === 'light' || saved === 'dark'
    ? saved : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(storageKey, theme)
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
