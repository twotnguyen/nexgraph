import { realpathSync } from 'node:fs'
import type { AiConsentTarget, NexConsentTarget } from '../../../../shared/agent-types'
import type { AgentAccounts } from '../session'
import type { NexProvider } from './config'

/**
 * Điểm đến của phiên Nex (review #72 vòng 1, finding 1–2).
 *
 * Khối tài khoản Nex có lựa chọn riêng (`prefs.nexSelectedModel`): tài khoản đăng nhập trong sidecar
 * (OAuth/device — token chỉ ở sidecar) hoặc nhà cung cấp của app (API key/tuỳ chỉnh, key qua env con).
 * Phiên Nex phải xin consent theo ĐÚNG điểm đến đó, không theo model đang chọn của Pi: nếu không,
 * đồng ý gửi mã cho nhà cung cấp A được dùng cho dữ liệu thực sự gửi tới tài khoản B.
 */
export type NexDestinationSource = {
  readonly modelRuntime: AgentAccounts['modelRuntime']
  nexSelectedModel(): { provider: string; id: string } | null
  nexProviderFor(selected: { provider: string; id: string } | null): NexProvider | null
  nexProvider(): NexProvider | null
} & Pick<AgentAccounts, 'getSelectedModel' | 'hasConsent'> & Partial<AgentAccounts>

export type NexDestination = NexConsentTarget & { model: string; account: boolean }

/** `baseUrl` của tài khoản sidecar: định danh ổn định (không phải URL) để so consent và phạm vi transcript. */
export const nexAccountEndpoint = (provider: string): string => `nex-account:${provider}`

export function nexDestination(a: NexDestinationSource): NexDestination | null {
  const selected = a.nexSelectedModel()
  if (!selected) return null
  const provider = a.nexProviderFor(selected)
  return provider
    ? { runtime: 'nex', provider: provider.id, baseUrl: provider.baseUrl, model: selected.id, account: false }
    : { runtime: 'nex', provider: selected.provider, baseUrl: nexAccountEndpoint(selected.provider), model: selected.id, account: true }
}

/** Nex dùng được khi đã chọn trong khối tài khoản Nex, hoặc (đường #66) Pi đang chọn nhà cung cấp tuỳ chỉnh. */
export const nexReady = (a: NexDestinationSource | null): boolean => !!a && (!!a.nexSelectedModel() || !!a.nexProvider())

const changed = (): Error => Object.assign(new Error('Tài khoản AI của Nex đã thay đổi. Hãy kiểm tra và xác nhận lại trước khi gửi mã nguồn.'), { code: 'ai_provider_changed' })

/**
 * Consent cho điểm đến Nex, theo dự án (gốc thật) + nhà cung cấp + điểm đến. Chỉ giữ trong bộ nhớ:
 * app không biết danh tính tài khoản bên trong sidecar (đăng xuất rồi đăng nhập tài khoản khác cùng nhà
 * cung cấp trông y hệt), nên mỗi lần mở app phải xác nhận lại — giống consent của Antigravity CLI.
 */
export class NexConsentStore {
  private readonly approved = new Set<string>()
  constructor(private readonly rootOf: (projectId: string) => Promise<string>) {}

  private async key(projectId: string, target: AiConsentTarget): Promise<string> {
    if (target?.runtime !== 'nex' || typeof target.provider !== 'string' || typeof target.baseUrl !== 'string') throw changed()
    const root = realpathSync.native(await this.rootOf(projectId))
    return JSON.stringify([projectId, root, target.provider, target.baseUrl, target.accountId ?? null])
  }

  async hasConsent(projectId: string, target: AiConsentTarget): Promise<boolean> {
    return this.approved.has(await this.key(projectId, target))
  }

  async grantConsent(projectId: string, target: AiConsentTarget): Promise<void> {
    this.approved.add(await this.key(projectId, target))
  }
}

const DEFAULT_WINDOW = 200_000

/**
 * `AgentAccounts` cho AgentService của Nex. Có lựa chọn Nex → model, recipient và consent theo lựa
 * chọn đó; không có → trả nguyên nguồn (hành vi #66: Nex dùng nhà cung cấp tuỳ chỉnh Pi đang chọn).
 */
export function nexAgentAccounts<T extends NexDestinationSource>(a: T, consent: NexConsentStore): T | AgentAccounts {
  if (!nexDestination(a)) return a
  // Đọc lựa chọn SỐNG ở mỗi lần gọi: recipient().isCurrent() so lại getSelectedModel/sessionIdentity để
  // selectionChanged() huỷ phiên khi người dùng đổi/đăng xuất tài khoản Nex giữa chừng (review #72 vòng 2).
  const current = (): NexDestination | null => nexDestination(a)
  const base = a.modelRuntime
  const known = (dest: NexDestination) => base.getModel(dest.provider, dest.model) as Record<string, unknown> | undefined
  const modelOf = (dest: NexDestination) => {
    const info = known(dest)
    return {
      api: 'openai-completions', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: DEFAULT_WINDOW, maxTokens: 16_384,
      ...(info ?? {}),
      id: dest.model, name: (info?.name as string | undefined) ?? dest.model, provider: dest.provider, baseUrl: dest.baseUrl
    }
  }
  const modelRuntime = new Proxy(base, {
    get(targetRuntime, key) {
      if (key === 'getModel') {
        return (provider: string, id: string) => {
          const dest = current()
          return dest && provider === dest.provider && id === dest.model ? modelOf(dest) : undefined
        }
      }
      const value = Reflect.get(targetRuntime, key, targetRuntime) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(targetRuntime) : value
    }
  })
  return {
    modelRuntime,
    getSelectedModel: () => {
      const dest = current()
      return dest ? { provider: dest.provider, id: dest.model } : null
    },
    getConsentTarget: async () => {
      const dest = current()
      if (!dest) return null
      const { runtime: _runtime, model: _model, account: _account, ...rest } = dest
      return { runtime: 'nex', ...rest } satisfies NexConsentTarget
    },
    hasConsent: (projectId, t) => consent.hasConsent(projectId, t),
    sessionIdentity: () => {
      const dest = current()
      return dest ? JSON.stringify(['nex', dest.provider, dest.baseUrl]) : ''
    },
    selectedModelPricing: () => current()?.account ? 'subscription' : 'unknown',
    selectedModelWindowKnown: () => {
      const dest = current()
      return !!dest && !!known(dest)
    },
    nexProvider: () => {
      const dest = current()
      return dest ? a.nexProviderFor({ provider: dest.provider, id: dest.model }) : null
    }
  }
}
