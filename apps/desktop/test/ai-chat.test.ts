import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EngineApi } from '../src/main/engine/api'
import { SYSTEM_PROMPT, runChat } from '../src/main/ai/chat'
import { AiSettingsStore, type SecretBox } from '../src/main/ai/settings'

const box: SecretBox = { available: () => true, encrypt: (s) => `enc:${s}`, decrypt: (b) => b.slice(4) }
const toolTurn = (name: string, args: object) => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] })
const finalTurn = (content: string) => ({ choices: [{ message: { role: 'assistant', content } }] })
const fakeFetch = (bodies: unknown[]) => {
  let i = 0
  return vi.fn(async () => {
    const b = bodies[Math.min(i++, bodies.length - 1)] as { status?: number }
    return new Response(JSON.stringify(b), { status: b.status ?? 200 })
  })
}
const api = { flows: vi.fn(async () => ({ flows: [], total: 0, truncated: false })), search: vi.fn(async () => []),
  code: vi.fn(async (_p: string, file: string, start: number, end: number) => ({ file, start, end, text: 'x', language: null, stale: false })) } as unknown as EngineApi

let settings: AiSettingsStore
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'ng-chat-'))
  settings = new AiSettingsStore(join(dir, 'prefs.json'), join(dir, 'k.json'), box)
  settings.save({ baseUrl: 'https://api.example.com/v1/', model: 'm1', apiKey: 'sk-secret' })
  settings.grantConsent('p1')
})
const msgs = [{ role: 'user' as const, content: 'luồng đăng nhập?' }]
const run = (fetch: typeof globalThis.fetch, signal = new AbortController().signal) =>
  runChat({ settings, api, fetch }, { projectId: 'p1', messages: msgs }, () => {}, signal)

describe('runChat', () => {
  it('gọi tool rồi trả lời; trích dẫn được kiểm chứng; không lộ key trong thân', async () => {
    const fetch = fakeFetch([toolTurn('list_flows', { query: 'login' }), finalTurn('Bước 1 [[app.py:8-9]]')])
    const onTool = vi.fn()
    const a = await runChat({ settings, api, fetch }, { projectId: 'p1', messages: msgs }, onTool, new AbortController().signal)
    expect(onTool).toHaveBeenCalledWith('list_flows')
    expect(a.text).toBe('Bước 1 [[app.py:8-9]]')
    expect(a.toolCalls.map((t) => t.name)).toEqual(['list_flows'])
    expect(a.citations[0].valid).toBe(true)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-secret')
    expect(init.body).not.toContain('sk-secret')
    expect(JSON.parse(init.body).messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT })
    const second = JSON.parse((fetch.mock.calls[1] as unknown as [string, { body: string }])[1].body).messages
    expect(second.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
  })

  it('dừng ở vòng thứ 8', async () => {
    const fetch = fakeFetch(Array(9).fill(toolTurn('search', { query: 'x' })))
    await expect(run(fetch)).rejects.toMatchObject({ code: 'ai_too_many_rounds' })
    expect(fetch).toHaveBeenCalledTimes(8)
  })

  it('tool bịa tên hoặc JSON hỏng không làm sập vòng lặp', async () => {
    const fetch = fakeFetch([toolTurn('rm_rf', {}), finalTurn('xong')])
    expect((await run(fetch)).text).toBe('xong')
    const second = JSON.parse((fetch.mock.calls[1] as unknown as [string, { body: string }])[1].body).messages
    expect(second.at(-1).content).toContain('unknown_tool')
  })

  it('ánh xạ lỗi', async () => {
    await expect(run(fakeFetch([{ status: 401 }]))).rejects.toMatchObject({ code: 'ai_unauthorized' })
    await expect(run(vi.fn().mockRejectedValue(new TypeError('fetch failed')))).rejects.toMatchObject({ code: 'ai_unreachable' })
    await expect(run(fakeFetch([{ choices: [] }]))).rejects.toMatchObject({ code: 'ai_bad_response' })
  })

  it('chưa cấu hình hoặc chưa đồng ý thì không gọi mạng', async () => {
    const fetch = fakeFetch([finalTurn('x')])
    const dir = mkdtempSync(join(tmpdir(), 'ng-chat2-'))
    const empty = new AiSettingsStore(join(dir, 'p.json'), join(dir, 'k.json'), box)
    await expect(runChat({ settings: empty, api, fetch }, { projectId: 'p1', messages: msgs }, () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'ai_not_configured' })
    await expect(runChat({ settings, api, fetch }, { projectId: 'p2', messages: msgs }, () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'ai_no_consent' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('huỷ giữa chừng', async () => {
    const ac = new AbortController()
    const fetch = vi.fn(async (_u: string, init: RequestInit) => {
      ac.abort()
      throw Object.assign(new Error('aborted'), { name: 'AbortError', signal: init.signal })
    })
    await expect(run(fetch as unknown as typeof globalThis.fetch, ac.signal)).rejects.toMatchObject({ code: 'ai_cancelled' })
  })

  it('Ollama không key: không gửi header Authorization', async () => {
    settings.save({ baseUrl: 'http://localhost:11434/v1', model: 'llama', apiKey: '' })
    settings.grantConsent('p1')
    const fetch = fakeFetch([finalTurn('ok')])
    await run(fetch)
    expect((fetch.mock.calls[0] as unknown as [string, { headers: object }])[1].headers).not.toHaveProperty('Authorization')
  })
})
