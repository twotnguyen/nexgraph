import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SecretBox { available(): boolean; encrypt(s: string): string; decrypt(b64: string): string }

export const fail = (code: string, message: string): Error => Object.assign(new Error(message), { code })

export function readJson(file: string): Record<string, unknown> {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function writeJson(file: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 })
}

/**
 * Kho bí mật nhiều khoá: `{ [providerId]: bản mã hoá safeStorage }` trong một tệp 0600.
 * Key không bao giờ ở dạng rõ trên đĩa và không bao giờ về renderer.
 */
export class SecretStore {
  constructor(private readonly file: string, private readonly box: SecretBox) {}

  get(id: string): string | null {
    const enc = readJson(this.file)[id]
    if (typeof enc !== 'string' || !this.box.available()) return null
    try {
      return this.box.decrypt(enc)
    } catch {
      return null
    }
  }

  set(id: string, key: string): void {
    if (!this.box.available()) throw fail('no_keychain', 'Máy này không có kho khoá an toàn')
    writeJson(this.file, { ...readJson(this.file), [id]: this.box.encrypt(key) })
  }

  /** Di trú một lần: khoá đơn của AiSettingsStore cũ (`key`) đổi tên thành khoá của một provider. */
  migrateLegacyKey(id: string): boolean {
    const all = readJson(this.file)
    const enc = all.key
    if (typeof enc !== 'string' || all[id] !== undefined) return false
    const { key: _old, ...rest } = all
    writeJson(this.file, { ...rest, [id]: enc })
    return true
  }

  remove(id: string): void {
    const all = readJson(this.file)
    if (!(id in all)) return
    delete all[id]
    writeJson(this.file, all)
  }

  ids(): string[] {
    return Object.keys(readJson(this.file)).filter((id) => id !== 'key')
  }
}
