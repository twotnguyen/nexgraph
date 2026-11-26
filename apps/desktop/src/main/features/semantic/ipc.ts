import type { ProjectAiSettings, SemanticTarget } from '../../../shared/graph-types'
import { AgentError } from '../../agent/session'
import { directTransport, piComplete, selectedModelLabel } from '../../ai/semantic-models'
import { runSemanticJob } from '../../ai/semantic-runner'
import { SemanticUsageStore } from '../../ai/semantic-usage'
import type { IpcContext } from '../../platform/ipc-context'
import { aiAccounts } from '../agent/ipc'

/** Phân tích ngữ nghĩa bằng AI (W9). Mặc định tắt theo dự án; key chỉ đọc ở đây và chỉ đi xuống engine ở đường B. */
export function registerSemanticIpc(ctx: IpcContext): void {
  const { on, api, rootOf } = ctx
  const acc = () => aiAccounts(ctx)
  const semanticRuns = new Map<string, AbortController>()
  const semanticUsage = new SemanticUsageStore()
  on('semantic:get-settings', (pid: string) => api().aiSettings(pid))
  on('semantic:set-settings', async (pid: string, settings: ProjectAiSettings) => {
    await rootOf(pid)
    const transport = settings?.transport === 'direct' || settings?.transport === 'app' ? settings.transport : null
    const model = transport ? selectedModelLabel(await acc()) : null
    return api().setAiSettings(pid, { enabled: settings?.enabled === true, transport, model })
  })
  on('semantic:estimate', async (pid: string, target: SemanticTarget, noCache?: boolean) => {
    const estimate = await api().semanticEstimate(pid, target, noCache === true)
    let model: string | null = null
    try { model = selectedModelLabel(await acc()) } catch { /* chưa chọn model: hộp thoại báo */ }
    return { ...estimate, model }
  })
  on('semantic:start', async (pid: string, target: SemanticTarget, budget?: number, noCache?: boolean) => {
    const settings = await api().aiSettings(pid)
    // `dedup` gộp khái niệm trùng ngay trên máy, không gửi gì: không cần bật AI, chọn model hay đồng ý.
    const local = target === 'dedup'
    if (!settings.enabled && !local) throw new AgentError('ai_disabled', 'Chưa bật phân tích bằng AI cho dự án này.')
    const a = await acc()
    let transport: { kind: 'app'; model_label: string } | { kind: 'direct'; base_url: string; api_key: string; model: string }
    if (local) {
      transport = { kind: 'app', model_label: settings.model ?? '' }
    } else {
      // Người dùng đồng ý với một model cụ thể lúc bật AI: model đang chọn đã đổi thì phải đồng ý lại.
      const current = selectedModelLabel(a)
      if (settings.model !== current)
        throw new AgentError('ai_provider_changed', `Model AI đã đổi (${settings.model ?? 'chưa có'} → ${current}). Hãy đồng ý lại trước khi gửi.`)
      transport = settings.transport === 'direct' ? await directTransport(a) : { kind: 'app' as const, model_label: selectedModelLabel(a) }
    }
    const max = Number.isFinite(budget) && budget! > 0 ? Math.floor(budget!) : 1_000_000
    const jobId = (await api().startSemantic(pid, { targets: target, transport, max_tokens_budget: max, no_cache: noCache === true })).job_id
    if (!local && transport.kind === 'app') {
      const ac = new AbortController()
      semanticRuns.set(jobId, ac)
      const used = { input: 0, output: 0 }
      void runSemanticJob(jobId, {
        jobState: async (id) => (await api().getJob(id)).state,
        next: (id) => api().llmNext(id),
        answer: (id, chunkId, body) => api().llmAnswer(id, chunkId, body)
      }, piComplete(a), {
        signal: ac.signal, budget: max,
        onUsage: (usage) => { used.input += usage.inputTokens; used.output += usage.outputTokens }
      })
        .catch((e) => console.warn(`[semantic] ${jobId}: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => {
          semanticUsage.set(jobId, used.input, used.output)
          semanticRuns.delete(jobId)
        })
    }
    return { jobId }
  })
  // Chờ main ghi usage xong: engine có thể báo job done trước khi .finally của runSemanticJob chạy.
  on('semantic:usage', async (jobId: string) => semanticUsage.wait(jobId))
  on('semantic:cancel', async (jobId: string) => {
    semanticRuns.get(jobId)?.abort()
    await api().cancelJob(jobId)
  })
}
