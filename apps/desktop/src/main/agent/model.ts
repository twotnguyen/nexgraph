import { join } from 'node:path'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { AiSettingsStore } from '../ai/settings'
import { loadPi, type ModelChoice } from './session'

export const CUSTOM_PROVIDER = 'nexgraph-custom'

/**
 * Nguồn mô hình tạm trước Task 6: một nhà cung cấp tương thích OpenAI lấy từ Base URL/model trong Cài đặt.
 * Khoá chỉ đưa vào pi lúc chạy (setRuntimeApiKey, trong bộ nhớ), không ghi vào auth.json/models.json.
 * shortcut: Task 6 thay bằng AccountService (nhiều nhà cung cấp, OAuth).
 */
export function settingsModels(dataDir: string, settings: AiSettingsStore): () => Promise<ModelChoice> {
  let runtime: Promise<ModelRuntime> | undefined
  return async () => {
    runtime ??= loadPi().then(({ ModelRuntime }) =>
      ModelRuntime.create({ authPath: join(dataDir, 'agent', 'auth.json'), modelsPath: join(dataDir, 'agent', 'models.json') }))
    const modelRuntime = await runtime
    const { baseUrl, model } = settings.get()
    if (!baseUrl || !model) return { modelRuntime, selected: null }
    modelRuntime.registerProvider(CUSTOM_PROVIDER, {
      name: 'Nhà cung cấp tuỳ chỉnh', baseUrl, api: 'openai-completions',
      models: [{ id: model, name: model, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8192 }]
    })
    // shortcut: endpoint không cần khoá (Ollama) vẫn nhận "Bearer none"; Task 6 thay cách xác thực.
    await modelRuntime.setRuntimeApiKey(CUSTOM_PROVIDER, settings.key() ?? 'none')
    return { modelRuntime, selected: { provider: CUSTOM_PROVIDER, id: model } }
  }
}
