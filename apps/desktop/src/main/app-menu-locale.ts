import type { MenuLocale } from './app-menu-labels'

/**
 * Ngôn ngữ hiện tại của menu hệ thống. Tách khỏi appMenu.ts để ipc.ts đọc/ghi mà không kéo
 * `Menu`/`BrowserWindow` của Electron vào (test IPC không phải mock thêm).
 */
let locale: MenuLocale = 'vi'

export const getMenuLocale = (): MenuLocale => locale
export const setMenuLocale = (next: MenuLocale): void => { locale = next }
