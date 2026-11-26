import { describe, expect, it, vi } from 'vitest'
import { runSemanticJob, type LlmChunk, type SemanticEngine } from '../src/main/features/semantic/semantic-runner'

const chunk = (id: string): LlmChunk => ({ chunk_id: id, system: 's', user: `u-${id}`, max_output_tokens: 100 })

function fakeEngine(chunks: LlmChunk[], states: string[] = ['queued', 'waiting_llm']) {
  const queue = [...chunks]
  const answers: [string, { text?: string; error?: string }][] = []
  const engine: SemanticEngine = {
    jobState: vi.fn(async () => (states.length > 1 ? states.shift()! : states[0])),
    next: vi.fn(async () => queue.shift() ?? null),
    answer: vi.fn(async (_job, id, body) => { answers.push([id, body]) })
  }
  return { engine, answers }
}

describe('runSemanticJob', () => {
  it('kéo khối đến khi hết (204) và gửi text hoặc error', async () => {
    const { engine, answers } = fakeEngine([chunk('c1'), chunk('c2')])
    const complete = vi.fn(async (c: LlmChunk) => {
      if (c.chunk_id === 'c2') throw new Error('model lỗi')
      return { text: '{"nodes":[],"edges":[]}', inputTokens: 10, outputTokens: 5 }
    })
    const r = await runSemanticJob('j1', engine, complete, { signal: new AbortController().signal, budget: 1000, pollMs: 1 })
    expect(answers).toEqual([['c1', { text: '{"nodes":[],"edges":[]}' }], ['c2', { error: 'model lỗi' }]])
    expect(r).toEqual({ sent: 2, failed: 1, tokens: 15 })
  })

  it('không kéo khối khi job đã kết thúc (mọi khối trúng cache)', async () => {
    const { engine } = fakeEngine([chunk('c1')], ['done'])
    const complete = vi.fn()
    await runSemanticJob('j1', engine, complete, { signal: new AbortController().signal, budget: 1000, pollMs: 1 })
    expect(engine.next).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('vượt max_tokens_budget thì không gọi model nữa', async () => {
    const { engine, answers } = fakeEngine([chunk('c1'), chunk('c2')])
    const complete = vi.fn(async () => ({ text: '{}', inputTokens: 80, outputTokens: 30 }))
    await runSemanticJob('j1', engine, complete, { signal: new AbortController().signal, budget: 100, pollMs: 1 })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(answers[1][0]).toBe('c2')
    expect(answers[1][1].error).toMatch(/ngân sách/)
  })

  it('dừng khi bị huỷ', async () => {
    const { engine, answers } = fakeEngine([chunk('c1'), chunk('c2')])
    const ac = new AbortController()
    const complete = vi.fn(async () => { ac.abort(); throw new Error('aborted') })
    await runSemanticJob('j1', engine, complete, { signal: ac.signal, budget: 1000, pollMs: 1 })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(answers).toEqual([])
  })

  it('báo usage từng khối qua onUsage để hộp thoại hiện token đường A', async () => {
    const { engine } = fakeEngine([chunk('c1'), chunk('c2')])
    const seen: { inputTokens: number; outputTokens: number }[] = []
    const complete = vi.fn(async (c: LlmChunk) => c.chunk_id === 'c1'
      ? { text: '{}', inputTokens: 10, outputTokens: 5 }
      : { text: '{}', inputTokens: 3, outputTokens: 2 })
    const r = await runSemanticJob('j1', engine, complete,
      { signal: new AbortController().signal, budget: 1000, pollMs: 1, onUsage: (u) => seen.push(u) })
    expect(seen).toEqual([{ inputTokens: 10, outputTokens: 5 }, { inputTokens: 3, outputTokens: 2 }])
    expect(r).toEqual({ sent: 2, failed: 0, tokens: 20 })
  })

  it('khối lỗi không báo usage', async () => {
    const { engine } = fakeEngine([chunk('c1')])
    const seen: { inputTokens: number; outputTokens: number }[] = []
    const complete = vi.fn(async () => { throw new Error('model lỗi') })
    await runSemanticJob('j1', engine, complete,
      { signal: new AbortController().signal, budget: 1000, pollMs: 1, onUsage: (u) => seen.push(u) })
    expect(seen).toEqual([])
  })
})
