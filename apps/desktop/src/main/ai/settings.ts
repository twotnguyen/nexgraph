import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import type { AiSettings } from '../../shared/graph-types'

export interface SecretBox { available(): boolean; encrypt(s: string): string; decrypt(b64: string): string }

const fail = (code: string, message: string): Error => Object.assign(new Error(message), { code })

function readJson(file: string): Record<string, unknown> {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Bỏ mọi '/' cuối rồi nối '/chat/completions'. */
export const endpoint = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, '')}/chat/completions`

/** Cấu hình trợ lý AI: Base URL và model trong prefs.json, API key mã hoá bằng kho khoá của hệ điều hành trong tệp riêng. */
export class AiSettingsStore {
  constructor(private readonly prefsFile: string, private readonly keyFile: string, private readonly box: SecretBox) {}

  get(): AiSettings {
    const p = readJson(this.prefsFile)
    return { baseUrl: String(p.aiBaseUrl ?? ''), model: String(p.aiModel ?? ''), hasKey: this.key() != null }
  }

  save(s: { baseUrl: string; model: string; apiKey?: string }): AiSettings {
    if (!/^https?:\/\/[^\s/]+/i.test(s.baseUrl)) throw fail('bad_param', 'Base URL phải bắt đầu bằng http:// hoặc https://')
    if (s.apiKey && !this.box.available()) throw fail('no_keychain', 'Máy này không có kho khoá an toàn')
    writeFileSync(this.prefsFile, JSON.stringify({ ...readJson(this.prefsFile), aiBaseUrl: s.baseUrl, aiModel: s.model }))
    if (s.apiKey === '') {
      if (existsSync(this.keyFile)) unlinkSync(this.keyFile)
    } else if (s.apiKey) {
      writeFileSync(this.keyFile, JSON.stringify({ key: this.box.encrypt(s.apiKey) }), { mode: 0o600 })
    }
    return this.get()
  }

  key(): string | null {
    const enc = readJson(this.keyFile).key
    if (typeof enc !== 'string' || !this.box.available()) return null
    try {
      return this.box.decrypt(enc)
    } catch {
      return null
    }
  }

  /** hostname[:port] của Base URL; null nếu rỗng hoặc không hợp lệ. */
  host(): string | null {
    try {
      const { host } = new URL(this.get().baseUrl)
      return host || null
    } catch {
      return null
    }
  }

  hasConsent(projectId: string): boolean {
    const host = this.host()
    const list = readJson(this.prefsFile).aiConsent
    return host != null && Array.isArray(list) && list.includes(`${projectId}|${host}`)
  }

  grantConsent(projectId: string): void {
    const host = this.host()
    if (!host) return
    const p = readJson(this.prefsFile)
    const list = Array.isArray(p.aiConsent) ? (p.aiConsent as string[]) : []
    const entry = `${projectId}|${host}`
    if (!list.includes(entry)) writeFileSync(this.prefsFile, JSON.stringify({ ...p, aiConsent: [...list, entry] }))
  }
}
