// N2-A2 review #72 vòng 1: điểm đến + consent của phiên Nex theo lựa chọn trong khối tài khoản Nex,
// không theo model đang chọn của Pi (finding 1, 2).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NexConsentStore, nexAgentAccounts, nexDestination, nexReady, type NexDestinationSource } from '../src/main/agent/nex/destination'
import { consentTargetForSettings, sameConsentTarget } from '../src/shared/agent-types'

const piModel = { provider: 'pi-a', id: 'model-a', baseUrl: 'https://a.example/v1', contextWindow: 128_000, maxTokens: 8000, input: ['text'] }
const source = (over: Partial<NexDestinationSource> = {}): NexDestinationSource => ({
  nexSelectedModel: () => ({ provider: 'openai', id: 'gpt-5' }),
  nexProviderFor: () => null,
  nexProvider: () => null,
  getSelectedModel: () => ({ provider: 'pi-a', id: 'model-a' }),
  modelRuntime: { getModel: (provider: string, id: string) => provider === 'pi-a' && id === 'model-a' ? piModel : undefined } as never,
  hasConsent: async () => true,
  ...over
})

describe('điểm đến của phiên Nex', () => {
  it('tài khoản đăng nhập trong sidecar: điểm đến là tài khoản Nex, không phải model Pi', () => {
    expect(nexDestination(source())).toEqual({ runtime: 'nex', provider: 'openai', baseUrl: 'nex-account:openai', model: 'gpt-5', account: true })
  })

  it('lựa chọn Nex là nhà cung cấp của app (API key/tuỳ chỉnh): điểm đến là URL thật của nhà cung cấp đó', () => {
    const dest = nexDestination(source({
      nexSelectedModel: () => ({ provider: 'acme', id: 'm1' }),
      nexProviderFor: (sel) => sel?.provider === 'acme' ? { id: 'acme', label: 'Acme', baseUrl: 'https://acme.example/v1', apiKey: 'k', model: 'm1' } : null
    }))
    expect(dest).toEqual({ runtime: 'nex', provider: 'acme', baseUrl: 'https://acme.example/v1', model: 'm1', account: false })
  })

  it('chưa chọn gì trong khối Nex → không có điểm đến riêng (giữ đường của Pi như #66)', () => {
    expect(nexDestination(source({ nexSelectedModel: () => null }))).toBeNull()
  })

  it('Nex sẵn sàng khi đã chọn tài khoản sidecar dù không có key trong kho app', () => {
    expect(nexReady(source())).toBe(true)
    expect(nexReady(source({ nexSelectedModel: () => null }))).toBe(false)
    expect(nexReady(source({ nexSelectedModel: () => null, nexProvider: () => ({ id: 'c', label: 'C', baseUrl: 'https://c.example', apiKey: 'k', model: 'x' }) }))).toBe(true)
  })

  it('settings của renderer sinh đúng target Nex và target đó khác target Pi', () => {
    const dest = nexDestination(source())!
    const target = consentTargetForSettings({ runtime: 'nex', provider: dest.provider, baseUrl: dest.baseUrl, model: dest.model, nexDestination: true })
    expect(target).toEqual({ runtime: 'nex', provider: 'openai', baseUrl: 'nex-account:openai' })
    expect(sameConsentTarget(target, { provider: 'openai', baseUrl: 'nex-account:openai' })).toBe(false)
    expect(sameConsentTarget(target, { runtime: 'nex', provider: 'openai', baseUrl: 'nex-account:openai' })).toBe(true)
  })
})

describe('AgentAccounts của phiên Nex', () => {
  it('Pi chưa chọn model vẫn có recipient: model/consent theo lựa chọn Nex', async () => {
    const consent = new NexConsentStore(async () => tmpdir())
    const accounts = nexAgentAccounts(source({ getSelectedModel: () => null }), consent)
    expect(accounts.getSelectedModel()).toEqual({ provider: 'openai', id: 'gpt-5' })
    const model = accounts.modelRuntime.getModel('openai', 'gpt-5') as { provider: string; id: string; baseUrl: string }
    expect(model).toMatchObject({ provider: 'openai', id: 'gpt-5', baseUrl: 'nex-account:openai' })
    expect(await accounts.getConsentTarget!()).toEqual({ runtime: 'nex', provider: 'openai', baseUrl: 'nex-account:openai' })
    expect(accounts.selectedModelWindowKnown!()).toBe(false)
  })

  it('consent của model Pi (A) không được dùng cho tài khoản Nex (B): phải đồng ý riêng', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ng-nex-consent-'))
    const consent = new NexConsentStore(async () => root)
    const accounts = nexAgentAccounts(source({ hasConsent: async () => true }), consent)
    const target = (await accounts.getConsentTarget!())!
    expect(await accounts.hasConsent('pid', target)).toBe(false)
    await consent.grantConsent('pid', target)
    expect(await accounts.hasConsent('pid', target)).toBe(true)
    // Consent theo từng dự án và từng điểm đến.
    expect(await accounts.hasConsent('pid-2', target)).toBe(false)
    expect(await consent.hasConsent('pid', { runtime: 'nex', provider: 'anthropic', baseUrl: 'nex-account:anthropic' })).toBe(false)
  })

  it('target không phải Nex bị từ chối ở store Nex', async () => {
    const consent = new NexConsentStore(async () => tmpdir())
    await expect(consent.grantConsent('pid', { provider: 'pi-a', baseUrl: 'https://a.example/v1' })).rejects.toMatchObject({ code: 'ai_provider_changed' })
  })

  it('không có lựa chọn Nex → trả nguyên AccountService (hành vi #66)', () => {
    const base = source({ nexSelectedModel: () => null })
    expect(nexAgentAccounts(base, new NexConsentStore(async () => tmpdir()))).toBe(base)
  })
})
