import type { AccountService } from '../agent/accounts'
import { AgentError } from '../agent/session'
import type { CompleteFn } from './semantic-runner'

function selected(a: AccountService) {
  const sel = a.getSelectedModel()
  const model = sel && a.modelRuntime.getModel(sel.provider, sel.id)
  if (!model) throw new AgentError('ai_not_configured', 'Chưa chọn model AI. Hãy chọn trong Cài đặt.')
  return model
}

/** Tên hiển thị của model đang chọn (cho hộp thoại đồng ý và `model_label`). */
export function selectedModelLabel(a: AccountService): string {
  const m = selected(a)
  return `${m.provider} / ${m.id}`
}

/** Đường A: gọi model đang chọn qua pi, không bật tool. */
export const piComplete = (a: AccountService): CompleteFn => async (chunk, signal) => {
  const model = selected(a)
  const content = chunk.images?.length
    ? [{ type: 'text' as const, text: chunk.user },
      ...chunk.images.map((data, i) => ({ type: 'image' as const, data, mimeType: chunk.image_types?.[i] ?? 'image/png' }))]
    : chunk.user
  const stream = a.modelRuntime.streamSimple(model, {
    systemPrompt: chunk.system,
    messages: [{ role: 'user', content, timestamp: Date.now() }]
  }, { signal, maxTokens: chunk.max_output_tokens })
  for await (const _event of stream) { /* chỉ cần kết quả cuối */ }
  const r = await stream.result()
  if (r.stopReason === 'error' || r.stopReason === 'aborted') throw new Error(r.errorMessage ?? 'Model không trả lời')
  const text = r.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
  return { text, inputTokens: r.usage?.input ?? 0, outputTokens: r.usage?.output ?? 0 }
}

/** Đường B: base_url/key/model của model đang chọn. Chỉ provider tương thích OpenAI dùng API key (không OAuth). */
export async function directTransport(a: AccountService): Promise<{ kind: 'direct'; base_url: string; api_key: string; model: string }> {
  const model = selected(a)
  if (model.api !== 'openai-completions' || a.modelRuntime.isUsingOAuth(model.provider))
    throw new AgentError('ai_not_configured', 'Đường "engine gọi trực tiếp" cần model tương thích OpenAI dùng API key (ví dụ Ollama hoặc nhà cung cấp tuỳ chỉnh).')
  const auth = await a.modelRuntime.getAuth(model, { signal: AbortSignal.timeout(10_000) })
  return { kind: 'direct', base_url: auth?.auth.baseUrl ?? model.baseUrl, api_key: auth?.auth.apiKey ?? '', model: model.id }
}
