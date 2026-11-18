import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import type { AiConsentTarget, GeminiConsentTarget } from '../shared/agent-types'
import { sameConsentTarget } from '../shared/agent-types'
import { readJson, writeJson } from './ai/settings'

const changed = () => Object.assign(new Error('Kết nối Google đã thay đổi. Hãy kiểm tra và xác nhận lại trước khi gửi mã nguồn.'), { code: 'ai_provider_changed' })

export class GeminiConsentStore {
  // The official CLI can use a shared OS account. Re-confirm source and history
  // sharing on each app launch instead of treating a local connection ID as OAuth identity.
  private readonly approved = new Set<string>()
  constructor(private readonly file: string, private readonly rootOf: (id: string) => Promise<string>, private readonly current: () => Promise<GeminiConsentTarget | null>) {}
  private async key(projectId: string, target: AiConsentTarget): Promise<string> {
    const before = await this.current()
    if (target?.runtime !== 'antigravity-cli' || !sameConsentTarget(target, before)) throw changed()
    const root = realpathSync.native(await this.rootOf(projectId))
    if (!sameConsentTarget(before, await this.current())) throw changed()
    return createHash('sha256').update(JSON.stringify([projectId, root, target.runtime, target.provider, target.connectionId, target.accountId ?? null])).digest('hex')
  }
  async hasConsent(projectId: string, target: AiConsentTarget): Promise<boolean> {
    const key = await this.key(projectId, target)
    return this.approved.has(key)
  }
  async grantConsent(projectId: string, target: AiConsentTarget): Promise<void> {
    const key = await this.key(projectId, target)
    const data = readJson(this.file)
    const entries = Array.isArray(data.entries) ? data.entries.filter((entry): entry is string => typeof entry === 'string') : []
    if (!entries.includes(key)) writeJson(this.file, { entries: [...entries, key] })
    this.approved.add(key)
  }
}
