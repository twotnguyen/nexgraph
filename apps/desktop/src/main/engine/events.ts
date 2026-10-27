import type { EngineEvent } from '../../shared/graph-types'
import type { EngineHandle } from './launcher'

/** Tách các sự kiện SSE hoàn chỉnh khỏi bộ đệm; phần chưa đủ (`rest`) giữ lại cho gói tiếp theo. */
export function parseSse(buffer: string): { events: unknown[]; rest: string } {
  const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const events: unknown[] = []
  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n')
    if (!data) continue // dòng ": ping" là chú thích
    try {
      events.push(JSON.parse(data))
    } catch {
      /* bỏ sự kiện hỏng, không dừng luồng */
    }
  }
  return { events, rest }
}

/** Mở luồng `/v1/events`. Trả hàm huỷ; `onClose` chỉ được gọi khi luồng đứt không do mình huỷ. */
export function subscribeEvents(
  h: Pick<EngineHandle, 'baseUrl' | 'token'>,
  onEvent: (e: EngineEvent) => void,
  onClose: () => void
): () => void {
  const abort = new AbortController()
  void (async () => {
    try {
      const res = await fetch(`${h.baseUrl}/v1/events`, { headers: { Authorization: `Bearer ${h.token}` }, signal: abort.signal })
      if (!res.ok || !res.body) throw new Error(`events ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parsed = parseSse(buffer)
        buffer = parsed.rest
        for (const e of parsed.events) onEvent(e as EngineEvent)
      }
      if (!abort.signal.aborted) onClose()
    } catch {
      if (!abort.signal.aborted) onClose()
    }
  })()
  return () => abort.abort()
}
