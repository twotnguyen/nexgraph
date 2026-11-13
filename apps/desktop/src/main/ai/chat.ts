import type { AiToolCall, ChatAnswer, ChatMessage } from '../../shared/graph-types'
import type { EngineApi } from '../engine/api'
import { verifyCitations } from './citations'
import { AiSettingsStore, endpoint } from './settings'
import { TOOL_DEFS, runTool } from './tools'

export const MAX_ROUNDS = 8
export const TIMEOUT_MS = 60_000

export const SYSTEM_PROMPT =
  'Bạn là trợ lý chỉ đọc của NexGraph, trả lời câu hỏi về dự án mã nguồn đang mở. Luôn dùng công cụ để tra đồ thị và đọc mã trước khi trả lời; không đoán. ' +
  'Với câu hỏi về luồng xử lý của một tính năng, gọi list_flows rồi trace_flow. Với câu hỏi chung, gọi get_context trước. ' +
  'Mỗi nhận định về mã phải kèm trích dẫn dạng [[đường/dẫn/tệp:dòng_đầu-dòng_cuối]] lấy từ kết quả công cụ. ' +
  'Không có bằng chứng thì nói rõ là không tìm thấy. Trả lời bằng tiếng Việt, ngắn gọn; khi mô tả luồng thì đánh số từng bước. Bạn không thể sửa tệp hay chạy lệnh.'

const fail = (code: string, message: string): Error => Object.assign(new Error(message), { code })

interface Deps { settings: AiSettingsStore; api: EngineApi; fetch: typeof fetch }
interface ToolCall { id: string; function: { name: string; arguments: string } }
interface ModelMessage { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }

export async function runChat(
  deps: Deps,
  req: { projectId: string; messages: ChatMessage[] },
  onTool: (name: string) => void,
  signal: AbortSignal
): Promise<ChatAnswer> {
  const { settings, api } = deps
  const cfg = settings.get()
  if (!cfg.baseUrl || !cfg.model) throw fail('ai_not_configured', 'Chưa cấu hình trợ lý AI')
  if (!settings.hasConsent(req.projectId)) throw fail('ai_no_consent', 'Chưa đồng ý gửi dữ liệu')
  const key = settings.key()
  const messages: ModelMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...req.messages]
  const toolCalls: AiToolCall[] = []

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal.aborted) throw fail('ai_cancelled', 'Đã dừng')
    let res: Response
    try {
      // shortcut: không streaming, người dùng chỉ thấy tên tool đang gọi; chuyển sang SSE khi câu trả lời dài gây chờ > 20 s
      res = await deps.fetch(endpoint(cfg.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: cfg.model, messages, tools: TOOL_DEFS, tool_choice: 'auto' }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
      })
    } catch {
      throw signal.aborted ? fail('ai_cancelled', 'Đã dừng') : fail('ai_unreachable', 'Không kết nối được tới nhà cung cấp AI')
    }
    if (res.status === 401 || res.status === 403) throw fail('ai_unauthorized', 'API key bị từ chối')
    if (!res.ok) throw fail('ai_unreachable', `Nhà cung cấp AI trả về ${res.status}`)
    let msg: ModelMessage | undefined
    try {
      msg = ((await res.json()) as { choices?: { message?: ModelMessage }[] }).choices?.[0]?.message
    } catch {
      msg = undefined
    }
    if (!msg) throw fail('ai_bad_response', 'Thân phản hồi không đúng dạng')

    if (!msg.tool_calls?.length) {
      const text = msg.content ?? ''
      return { text, citations: await verifyCitations(api, req.projectId, text), toolCalls }
    }
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls })
    for (const call of msg.tool_calls) {
      onTool(call.function.name)
      const t0 = Date.now()
      const out = await runTool(api, req.projectId, call.function.name, call.function.arguments)
      toolCalls.push({ name: call.function.name, args: call.function.arguments, ms: Date.now() - t0 })
      messages.push({ role: 'tool', tool_call_id: call.id, content: out })
    }
  }
  throw fail('ai_too_many_rounds', 'Trợ lý gọi công cụ quá nhiều lần')
}
