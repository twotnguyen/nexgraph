import { app, safeStorage } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Đọc tệp JSON phẳng của app; tệp chưa có hoặc hỏng thì coi như rỗng. */
export function readJson(file: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

/** Tuỳ chọn không bí mật của app (runtime AI, cổng MCP, thư mục xuất…) trong userData/prefs.json. */
export const prefsFile = (): string => join(app.getPath('userData'), 'prefs.json')

/** Box mã hoá safeStorage (Keychain/DPAPI) dùng chung cho key MCP, key AI provider và DSN nguồn bổ sung. */
export const secretBox = {
  available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend?.() !== 'basic_text'),
  encrypt: (s: string) => safeStorage.encryptString(s).toString('base64'),
  decrypt: (b64: string) => safeStorage.decryptString(Buffer.from(b64, 'base64'))
}
