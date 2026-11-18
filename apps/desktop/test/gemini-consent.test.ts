import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GeminiConsentStore } from '../src/main/gemini-consent'
import { consentTargetForSettings, sameConsentTarget, type GeminiConsentTarget } from '../src/shared/agent-types'

const fixtures: string[] = []
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'nexgraph-google-consent-')); fixtures.push(directory)
  const root = join(directory, 'source'); mkdirSync(root)
  const second = join(directory, 'second'); mkdirSync(second)
  let current: GeminiConsentTarget | null = { runtime: 'antigravity-cli', provider: 'google-antigravity', connectionId: 'google-a' }
  let projectRoot = root
  const store = new GeminiConsentStore(join(directory, 'consents.json'), async () => projectRoot, async () => current)
  return { store, target: current, restart: () => new GeminiConsentStore(join(directory, 'consents.json'), async () => projectRoot, async () => current), change: (value: GeminiConsentTarget | null) => { current = value }, move: () => { projectRoot = second } }
}
describe('Gemini runtime consent', () => {
  it('requires explicit consent per project and connection without a fake HTTP endpoint', async () => {
    const f = fixture()
    expect(await f.store.hasConsent('p1', f.target)).toBe(false)
    await f.store.grantConsent('p1', f.target)
    expect(await f.store.hasConsent('p1', f.target)).toBe(true)
    expect(await f.store.hasConsent('p2', f.target)).toBe(false)
    const next: GeminiConsentTarget = { ...f.target, connectionId: 'google-b' }
    f.change(next)
    expect(await f.store.hasConsent('p1', next)).toBe(false)
    await expect(f.store.grantConsent('p1', f.target)).rejects.toMatchObject({ code: 'ai_provider_changed' })
  })
  it('does not carry consent to a different root reusing the same project id', async () => {
    const f = fixture(); await f.store.grantConsent('p1', f.target); f.move()
    expect(await f.store.hasConsent('p1', f.target)).toBe(false)
  })
  it('requires renewed source and history consent after each app launch with shared CLI authentication', async () => {
    const f = fixture(); await f.store.grantConsent('p1', f.target)
    expect(await f.store.hasConsent('p1', f.target)).toBe(true)
    const restarted = f.restart()
    expect(await restarted.hasConsent('p1', f.target)).toBe(false)
    await restarted.grantConsent('p1', f.target)
    expect(await restarted.hasConsent('p1', f.target)).toBe(true)
  })
  it('does not share API-key consent with a Google-account connection', () => {
    const account = consentTargetForSettings({ runtime: 'antigravity-cli', provider: 'google-antigravity', baseUrl: '', model: 'auto', connectionId: 'a' })
    expect(account).toEqual({ runtime: 'antigravity-cli', provider: 'google-antigravity', connectionId: 'a' })
    expect(sameConsentTarget(account, { provider: 'google', baseUrl: 'https://generativelanguage.googleapis.com', accountId: 'a' })).toBe(false)
    expect(consentTargetForSettings({ runtime: 'antigravity-cli', model: 'auto' })).toBeNull()
    expect(consentTargetForSettings({ runtime: 'antigravity-cli', model: '', connectionId: 'a' })).toBeNull()
  })
  it('rejects a disconnected account and Pi-shaped destination', async () => {
    const f = fixture(); f.change(null)
    await expect(f.store.grantConsent('p1', f.target)).rejects.toMatchObject({ code: 'ai_provider_changed' })
    await expect(f.store.grantConsent('p1', { provider: 'google-antigravity', baseUrl: 'https://google.test' })).rejects.toMatchObject({ code: 'ai_provider_changed' })
  })
})
