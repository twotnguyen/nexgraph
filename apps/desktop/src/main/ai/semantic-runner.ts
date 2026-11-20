/**
 * Đường A của phân tích ngữ nghĩa (W9): main kéo từng khối từ engine, gọi model bằng tài khoản app (không bật tool)
 * rồi gửi kết quả về. Engine giữ chia khối, prompt, kiểm và ghi; key không bao giờ xuống engine ở đường này.
 */

/** Khối do `GET /v1/jobs/{id}/llm/next` trả về. */
export interface LlmChunk {
  chunk_id: string
  system: string
  user: string
  images?: string[]
  image_types?: string[]
  max_output_tokens: number
}

export interface SemanticEngine {
  jobState(jobId: string): Promise<string>
  /** `null` khi engine trả 204 (hết khối). */
  next(jobId: string): Promise<LlmChunk | null>
  answer(jobId: string, chunkId: string, body: { text: string } | { error: string }): Promise<void>
}

export type CompleteFn = (chunk: LlmChunk, signal: AbortSignal) => Promise<{ text: string; inputTokens: number; outputTokens: number }>

const TERMINAL = new Set(['done', 'error', 'cancelled'])

export async function runSemanticJob(jobId: string, engine: SemanticEngine, complete: CompleteFn,
  o: { signal: AbortSignal; budget: number; pollMs?: number }): Promise<{ sent: number; failed: number; tokens: number }> {
  const out = { sent: 0, failed: 0, tokens: 0 }
  // Engine xếp hết khối vào hàng rồi mới chuyển sang waiting_llm: hỏi `next` sớm hơn sẽ nhận 204 nhầm.
  for (;;) {
    if (o.signal.aborted) return out
    const state = await engine.jobState(jobId)
    if (TERMINAL.has(state)) return out
    if (state === 'waiting_llm') break
    await new Promise((resolve) => setTimeout(resolve, o.pollMs ?? 250))
  }
  for (let chunk = await engine.next(jobId); chunk && !o.signal.aborted; chunk = await engine.next(jobId)) {
    if (out.tokens >= o.budget) {
      out.failed++
      await engine.answer(jobId, chunk.chunk_id, { error: 'Vượt ngân sách token của lần chạy' })
      continue
    }
    let body: { text: string } | { error: string }
    try {
      const r = await complete(chunk, o.signal)
      out.tokens += r.inputTokens + r.outputTokens
      body = { text: r.text }
    } catch (e) {
      if (o.signal.aborted) return out
      out.failed++
      body = { error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }
    }
    out.sent++
    await engine.answer(jobId, chunk.chunk_id, body)
  }
  return out
}
