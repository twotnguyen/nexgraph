import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ApprovalDecision, ApprovalRequest } from '@nexgraph/contracts/agent-types'
import type { ProviderFailure } from '../src/main/features/agent/session'
import { applyUnifiedPatch, NexSession, type NexSessionClient } from '../src/main/features/agent/nex/session'

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)) }

/** Client giả phát lại chuỗi sự kiện ghi từ spike A2 (drive2.py/events2.jsonl). */
function fakeClient() {
  let listener: ((event: { type: string; data?: Record<string, unknown> }) => void) | null = null
  const calls = { prompt: [] as string[], interrupt: 0, replies: [] as { id: string; decision: string }[], created: [] as unknown[] }
  const client: NexSessionClient = {
    async createSession(input) { calls.created.push(input); return { id: 'ses_1' } },
    async prompt(_sid, text) { calls.prompt.push(text) },
    async interrupt() { calls.interrupt++ },
    async setModel() {},
    async replyPermission(_sid, id, decision) { calls.replies.push({ id, decision }) },
    subscribe(fn) { listener = fn; return () => { listener = null } }
  }
  return { client, calls, emit: (event: { type: string; data?: Record<string, unknown> }) => listener?.(event) }
}

const sessionOf = (client: NexSessionClient, extra: Partial<ConstructorParameters<typeof NexSession>[0]> = {}) =>
  new NexSession({ root: '/tmp/proj', client, model: { provider: 'custom-1', id: 'gpt-6-luna' }, isEdit: () => true, ...extra })

describe('applyUnifiedPatch', () => {
  it('dựng nội dung tệp mới từ hunk @@ -0,0 +1 @@', () => {
    const diff = 'Index: /tmp/proj/note.txt\n===\n--- /tmp/proj/note.txt\n+++ /tmp/proj/note.txt\n@@ -0,0 +1 @@\n+hello from opencode.\n'
    expect(applyUnifiedPatch('', diff)).toBe('hello from opencode.')
  })

  it('áp hunk sửa tệp có sẵn và giữ phần sau hunk', () => {
    const diff = '@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n'
    expect(applyUnifiedPatch('one\ntwo\nthree\n', diff)).toBe('one\nTWO\nthree\n')
  })

  it('trả null khi bối cảnh không khớp (không đoán bừa cho hộp duyệt)', () => {
    expect(applyUnifiedPatch('a\nb\n', '@@ -1,2 +1,2 @@\n a\n-c\n+d\n')).toBeNull()
    expect(applyUnifiedPatch('', 'not a diff')).toBeNull()
  })
})

describe('NexSession (adapter sự kiện OpenCode → Pi)', () => {
  it('ánh xạ text, tool call/result, usage và kết thúc lượt', async () => {
    const { client, calls, emit } = fakeClient()
    const session = sessionOf(client)
    const events: Record<string, unknown>[] = []
    session.subscribe((event) => events.push(event))
    const running = session.prompt('dùng tool graph_stats cho biết số tệp')
    await flush()
    emit({ type: 'session.step.started', data: { sessionID: 'ses_1' } })
    emit({ type: 'session.text.delta', data: { sessionID: 'ses_1', delta: 'Đang' } })
    emit({ type: 'session.tool.input.started', data: { sessionID: 'ses_1', id: 'call_1', name: 'nexgraph_graph_stats' } })
    emit({ type: 'session.tool.called', data: { sessionID: 'ses_1', id: 'call_1', input: {} } })
    emit({ type: 'session.tool.success', data: { sessionID: 'ses_1', id: 'call_1', content: [{ type: 'text', text: '{"files":11}' }] } })
    emit({ type: 'session.step.ended', data: { sessionID: 'ses_1', tokens: { input: 238, output: 17, cache: { read: 24064, write: 0 } }, cost: 0 } })
    emit({ type: 'session.text.delta', data: { sessionID: 'ses_1', delta: ' xong' } })
    emit({ type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })
    await running
    expect(calls.created[0]).toMatchObject({ model: { providerID: 'nexgraph', id: 'gpt-6-luna' } })
    expect(calls.prompt).toEqual(['dùng tool graph_stats cho biết số tệp'])
    const text = events.filter((event) => event.type === 'message_update').map((event) => (event.assistantMessageEvent as { delta: string }).delta)
    expect(text).toEqual(['Đang', ' xong'])
    expect(events.find((event) => event.type === 'tool_execution_start')).toMatchObject({ toolCallId: 'call_1', toolName: 'nexgraph_graph_stats' })
    const end = events.find((event) => event.type === 'tool_execution_end') as { isError: boolean; result: { content: unknown[] } }
    expect(end.isError).toBe(false)
    expect(end.result.content).toEqual([{ type: 'text', text: '{"files":11}' }])
    const usage = (events.find((event) => event.type === 'message_end') as { message: { usage: Record<string, unknown> } }).message.usage
    expect(usage).toMatchObject({ input: 238, output: 17, cacheRead: 24064, cacheWrite: 0 })
    expect(session.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'stop' })
  })

  it('lỗi provider kết thúc lượt bằng lỗi và ghi stopReason=error', async () => {
    const { client, emit } = fakeClient()
    const session = sessionOf(client)
    session.subscribe(() => {})
    const running = session.prompt('hỏi')
    await flush()
    emit({ type: 'session.execution.failed', data: { sessionID: 'ses_1', error: { message: 'Provider trả 401' } } })
    await expect(running).rejects.toThrow('Provider trả 401')
    expect(session.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'error', errorMessage: 'Provider trả 401' })
  })

  it('abort gọi interrupt và kết thúc lượt là aborted', async () => {
    const { client, calls } = fakeClient()
    const session = sessionOf(client)
    session.subscribe(() => {})
    const running = session.prompt('hỏi')
    await flush()
    await session.abort()
    await running
    expect(calls.interrupt).toBe(1)
    expect(session.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'aborted' })
  })

  it('permission.asked edit đi qua hộp duyệt: diff, allow → once; từ chối → reject', async () => {
    const { client, calls, emit } = fakeClient()
    const decisions: ApprovalDecision[] = [{ allow: true }, { allow: false, reason: 'x' }]
    const request = vi.fn(async (_req: ApprovalRequest): Promise<ApprovalDecision> => decisions.shift() ?? { allow: false, reason: 'x' })
    const root = mkdtempSync(join(tmpdir(), 'n1a1-session-'))
    writeFileSync(join(root, 'note.txt'), 'old\n')
    const session = sessionOf(client, { root, gate: { request } })
    session.subscribe(() => {})
    const running = session.prompt('tạo tệp')
    await flush()
    const diff = 'Index: /tmp/proj/note.txt\n--- /tmp/proj/note.txt\n+++ /tmp/proj/note.txt\n@@ -1,1 +1,2 @@\n old\n+new\n'
    emit({ type: 'permission.asked', data: { sessionID: 'ses_1', id: 'per_1', action: 'edit', resources: ['note.txt'], metadata: { filepath: 'note.txt', diff } } })
    await flush()
    expect(request).toHaveBeenCalledWith({ id: 'per_1', tool: 'write', path: 'note.txt', before: 'old\n', after: 'old\nnew\n' })
    expect(calls.replies.at(-1)).toEqual({ id: 'per_1', decision: 'once' })
    emit({ type: 'permission.asked', data: { sessionID: 'ses_1', id: 'per_2', action: 'edit', resources: ['note.txt'], metadata: { filepath: 'note.txt', diff } } })
    await flush()
    expect(calls.replies.at(-1)).toEqual({ id: 'per_2', decision: 'reject' })
    emit({ type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })
    await running
  })

  it('chế độ Hỏi không hỏi duyệt ghi/lệnh, trả reject ngay', async () => {
    const { client, calls, emit } = fakeClient()
    const request = vi.fn(async (): Promise<ApprovalDecision> => ({ allow: true }))
    const session = sessionOf(client, { gate: { request }, isEdit: () => false })
    session.subscribe(() => {})
    const running = session.prompt('sửa')
    await flush()
    emit({ type: 'permission.asked', data: { sessionID: 'ses_1', id: 'per_3', action: 'shell', resources: ['rm -rf .'] } })
    await flush()
    expect(request).not.toHaveBeenCalled()
    expect(calls.replies.at(-1)).toEqual({ id: 'per_3', decision: 'reject' })
    emit({ type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })
    await running
  })

  it('symlink ra ngoài dự án: không đọc ngoài, không hỏi duyệt, trả reject', async () => {
    const root = mkdtempSync(join(tmpdir(), 'n1a1-session-'))
    const outside = mkdtempSync(join(tmpdir(), 'n1a1-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'secret\n')
    symlinkSync(outside, join(root, 'link'), 'dir')
    const { client, calls, emit } = fakeClient()
    const request = vi.fn(async (): Promise<ApprovalDecision> => ({ allow: true }))
    const session = sessionOf(client, { root, gate: { request } })
    session.subscribe(() => {})
    const running = session.prompt('sửa')
    await flush()
    const diff = '--- a/secret.txt\n+++ b/secret.txt\n@@ -1,1 +1,1 @@\n-secret\n+leaked\n'
    emit({ type: 'permission.asked', data: { sessionID: 'ses_1', id: 'per_link', action: 'edit', resources: ['link/secret.txt'], metadata: { filepath: 'link/secret.txt', diff } } })
    await flush()
    expect(request).not.toHaveBeenCalled()
    expect(calls.replies.at(-1)).toEqual({ id: 'per_link', decision: 'reject' })
    emit({ type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })
    await running
  })

  it('đường dẫn .. hoặc không đọc được an toàn bị từ chối, không coi là tệp rỗng', async () => {
    const root = mkdtempSync(join(tmpdir(), 'n1a1-session-'))
    mkdirSync(join(root, 'dir'))
    const { client, calls, emit } = fakeClient()
    const request = vi.fn(async (): Promise<ApprovalDecision> => ({ allow: true }))
    const session = sessionOf(client, { root, gate: { request } })
    session.subscribe(() => {})
    const running = session.prompt('sửa')
    await flush()
    const diff = '--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-a\n+b\n'
    emit({ type: 'permission.asked', data: { sessionID: 'ses_1', id: 'per_dotdot', action: 'edit', resources: ['../outside.txt'], metadata: { filepath: '../outside.txt', diff } } })
    await flush()
    expect(request).not.toHaveBeenCalled()
    expect(calls.replies.at(-1)).toEqual({ id: 'per_dotdot', decision: 'reject' })
    emit({ type: 'permission.asked', data: { sessionID: 'ses_1', id: 'per_dir', action: 'edit', resources: ['dir'], metadata: { filepath: 'dir', diff } } })
    await flush()
    expect(request).not.toHaveBeenCalled()
    expect(calls.replies.at(-1)).toEqual({ id: 'per_dir', decision: 'reject' })
    emit({ type: 'session.execution.succeeded', data: { sessionID: 'ses_1' } })
    await running
  })

  it('người dùng Từ chối thao tác: lượt kết thúc bằng mã ai_tool_rejected, không phải "Đã dừng"', async () => {
    const root = mkdtempSync(join(tmpdir(), 'n1a1-session-'))
    writeFileSync(join(root, 'note.txt'), 'old\n')
    const { client, calls, emit } = fakeClient()
    const failures: ProviderFailure[] = []
    const gate = { request: vi.fn(async (): Promise<ApprovalDecision> => ({ allow: false, reason: 'Người dùng từ chối thao tác này' })) }
    const session = sessionOf(client, { root, gate, onProviderFailure: (failure) => failures.push(failure) })
    session.subscribe(() => {})
    const running = session.prompt('sửa tệp')
    await flush()
    const diff = '--- a/note.txt\n+++ b/note.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n'
    emit({ type: 'permission.asked', data: { sessionID: 'ses_1', id: 'per_reject', action: 'edit', resources: ['note.txt'], metadata: { filepath: 'note.txt', diff } } })
    await flush()
    expect(calls.replies.at(-1)).toEqual({ id: 'per_reject', decision: 'reject' })
    emit({ type: 'session.execution.interrupted', data: { sessionID: 'ses_1' } })
    await expect(running).rejects.toThrow('Đã từ chối thao tác.')
    expect(failures.at(-1)).toMatchObject({ code: 'ai_tool_rejected', message: 'Đã từ chối thao tác.' })
    expect(session.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'error', errorMessage: 'Đã từ chối thao tác.' })
  })
})
