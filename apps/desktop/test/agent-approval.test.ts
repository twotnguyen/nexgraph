import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPROVAL_TIMEOUT_MS, createApprovalGate, type ApprovalGate } from '../src/main/agent/approval'
import type { AgentMode, ApprovalRequest } from '../src/shared/agent-types'

const input: Record<string, unknown> = {
  edit: { path: 'a.ts', edits: [] },
  write: { path: 'a.ts', content: '' },
  bash: { command: 'ls' }
}
const flush = () => vi.advanceTimersByTimeAsync(0)

let root: string
let mode: AgentMode
let gate: ApprovalGate
let ask: ReturnType<typeof vi.fn>
let preview: ReturnType<typeof vi.fn>
const asked = (n = 0) => ask.mock.calls[n][0] as ApprovalRequest

beforeEach(() => {
  vi.useFakeTimers()
  root = join(mkdtempSync(join(tmpdir(), 'ng-appr-')), 'proj')
  mkdirSync(root)
  mode = 'edit'
  ask = vi.fn()
  preview = vi.fn(async (_t: string, i: { path: string }) => ({ path: i.path, before: 'B', after: 'A' }))
  gate = createApprovalGate({ root, getMode: () => mode, ask, preview } as never)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('approval gate', () => {
  it('tool đọc đi qua không hỏi', async () => {
    expect(await gate.check('read', {})).toEqual({ allow: true })
    expect(ask).not.toHaveBeenCalled()
  })
  it('chế độ Hỏi chặn edit/write/bash không hỏi', async () => {
    mode = 'ask'
    for (const t of ['edit', 'write', 'bash'])
      expect(await gate.check(t, input[t])).toEqual({ allow: false, reason: 'Chế độ Hỏi không cho phép sửa tệp hoặc chạy lệnh' })
    expect(ask).not.toHaveBeenCalled()
  })
  it('đường dẫn ngoài dự án bị chặn không hỏi', async () => {
    for (const p of ['../x', '/etc/hosts', join(root, '..', 'x')])
      for (const t of ['edit', 'write'])
        expect(await gate.check(t, { path: p })).toEqual({ allow: false, reason: 'Đường dẫn nằm ngoài dự án' })
    const outside = join(root, '..', 'out')
    mkdirSync(outside)
    symlinkSync(outside, join(root, 'link'))
    expect(await gate.check('write', { path: 'link/a.txt' })).toMatchObject({ allow: false })
    expect(ask).not.toHaveBeenCalled()
  })
  it('đường dẫn tuyệt đối nằm trong dự án được hỏi', async () => {
    for (const abs of [join(root, 'a.ts'), join(realpathSync(root), 'a.ts')]) {
      ask.mockClear()
      const p = gate.check('write', { path: abs })
      await flush()
      expect(ask).toHaveBeenCalledTimes(1)
      gate.resolve(asked().id, true)
      expect(await p).toEqual({ allow: true })
    }
  })
  it('thiếu path/command → từ chối, không hỏi', async () => {
    for (const [t, i] of [['edit', {}], ['write', { path: 1 }], ['bash', {}], ['bash', { command: 1 }], ['write', null]] as const)
      expect(await gate.check(t, i)).toMatchObject({ allow: false })
    expect(ask).not.toHaveBeenCalled()
  })
  it('duyệt → cho qua; từ chối → chặn', async () => {
    const a = gate.check('edit', { path: 'a.ts' })
    await flush()
    expect(asked()).toMatchObject({ tool: 'edit', path: 'a.ts', before: 'B', after: 'A' })
    expect(typeof asked().id).toBe('string')
    gate.resolve(asked().id, true)
    expect(await a).toEqual({ allow: true })

    const b = gate.check('bash', { command: 'rm x' })
    await flush()
    expect(asked(1)).toMatchObject({ tool: 'bash', command: 'rm x' })
    expect(preview).toHaveBeenCalledTimes(1)
    gate.resolve(asked(1).id, false)
    expect(await b).toEqual({ allow: false, reason: 'Người dùng từ chối thao tác này' })
    expect(gate.pending()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('hết 5 phút → từ chối và dọn sạch', async () => {
    const p = gate.check('bash', { command: 'ls' })
    await flush()
    await vi.advanceTimersByTimeAsync(APPROVAL_TIMEOUT_MS)
    expect(await p).toEqual({ allow: false, reason: 'Hết thời gian chờ duyệt' })
    expect(gate.pending()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    gate.resolve(asked().id, true) // no-op
  })
  it('denyAll từ chối mọi yêu cầu đang treo', async () => {
    const a = gate.check('bash', { command: 'a' })
    const b = gate.check('bash', { command: 'b' })
    await flush()
    expect(gate.pending()).toBe(2)
    gate.denyAll('Đã dừng')
    expect(await a).toEqual({ allow: false, reason: 'Đã dừng' })
    expect(await b).toEqual({ allow: false, reason: 'Đã dừng' })
    expect(gate.pending()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('hai yêu cầu đồng thời được giải quyết độc lập theo id', async () => {
    const a = gate.check('bash', { command: 'a' })
    const b = gate.check('bash', { command: 'b' })
    await flush()
    expect(asked(0).id).not.toBe(asked(1).id)
    gate.resolve(asked(1).id, true)
    gate.resolve(asked(0).id, false)
    expect(await a).toMatchObject({ allow: false })
    expect(await b).toEqual({ allow: true })
  })
  it('resolve id lạ hoặc resolve hai lần không ném', async () => {
    gate.resolve('x', true)
    const p = gate.check('bash', { command: 'a' })
    await flush()
    const id = asked().id
    gate.resolve(id, true)
    gate.resolve(id, false)
    expect(await p).toEqual({ allow: true })
  })
  it('preview ném lỗi → từ chối, không hỏi', async () => {
    preview.mockRejectedValueOnce(new Error('boom'))
    expect(await gate.check('edit', { path: 'a.ts' })).toMatchObject({ allow: false })
    expect(ask).not.toHaveBeenCalled()
    expect(gate.pending()).toBe(0)
  })
  it('ask ném lỗi → từ chối và dọn sạch', async () => {
    ask.mockImplementationOnce(() => { throw new Error('boom') })
    expect(await gate.check('bash', { command: 'a' })).toMatchObject({ allow: false })
    expect(gate.pending()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('denyAll khi preview đang chạy → không hỏi sau đó', async () => {
    let release!: () => void
    preview.mockImplementationOnce(() => new Promise((r) => { release = () => r({ path: 'a.ts', before: '', after: '' }) }))
    const p = gate.check('edit', { path: 'a.ts' })
    await flush()
    gate.denyAll('Đã dừng')
    release()
    expect(await p).toMatchObject({ allow: false })
    expect(ask).not.toHaveBeenCalled()
  })
})
