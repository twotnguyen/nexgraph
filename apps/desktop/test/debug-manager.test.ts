import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DebugEvent } from '../src/shared/api'
import { DapClient } from '../src/main/debug/dap-client'
import { adapterInstalled, installAdapter, type DebugKind } from '../src/main/debug/adapters'
import { DebugManager } from '../src/main/debug/manager'

const frame = (message: object) => { const body = JSON.stringify(message); return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}` }

it('DapClient: ghép phản hồi theo request_seq, chuyển sự kiện và trả lời yêu cầu ngược', async () => {
  const fromAdapter = new PassThrough()
  const toAdapter = new PassThrough()
  const client = new DapClient(fromAdapter, toAdapter)
  const events: string[] = []
  client.onEvent = (e) => { events.push(e.event) }
  client.onRequest = async (command) => (command === 'startDebugging' ? { ok: 1 } : Promise.reject(new Error('không')))
  const sent: string[] = []
  toAdapter.on('data', (chunk: Buffer) => sent.push(chunk.toString()))
  const pending = client.request<{ threads: unknown[] }>('threads')
  // Hai thông điệp trong một chunk, chunk sau cắt giữa thân.
  const reply = frame({ type: 'response', request_seq: 1, success: true, command: 'threads', body: { threads: [1] } })
  fromAdapter.write(frame({ type: 'event', event: 'stopped', body: {} }) + reply.slice(0, 20))
  fromAdapter.write(reply.slice(20))
  await expect(pending).resolves.toEqual({ threads: [1] })
  expect(events).toEqual(['stopped'])
  fromAdapter.write(frame({ type: 'request', seq: 9, command: 'startDebugging', arguments: {} }))
  await vi.waitFor(() => expect(sent.join('')).toContain('"request_seq":9'))
  expect(sent.join('')).toMatch(/"request_seq":9,"command":"startDebugging","success":true,"body":\{"ok":1\}/)
  const failed = client.request('next')
  fromAdapter.write(frame({ type: 'response', request_seq: 3, success: false, command: 'next', message: 'không có luồng' }))
  await expect(failed).rejects.toThrow('không có luồng')
})

// Chạy adapter thật (tải js-debug và debugpy về thư mục tạm): NEXGRAPH_DEBUG_IT=1 pnpm exec vitest run test/debug-manager.test.ts
describe.skipIf(!process.env.NEXGRAPH_DEBUG_IT)('gỡ lỗi thật với js-debug và debugpy', () => {
  const base = mkdtempSync(join(tmpdir(), 'ng-dbg-adapters-'))
  const root = mkdtempSync(join(tmpdir(), 'ng-dbg-proj-'))
  beforeAll(async () => {
    for (const kind of ['node', 'python'] as DebugKind[]) if (!adapterInstalled(base, kind)) await installAdapter(base, kind)
    writeFileSync(join(root, 'app.js'), 'const items = [1, 2, 3]\nlet total = 0\nfor (const n of items) {\n  total += n\n}\nconsole.log("total", total)\n')
    writeFileSync(join(root, 'app.py'), 'items = [1, 2, 3]\ntotal = 0\nfor n in items:\n    total += n\nprint("total", total)\n')
  }, 120_000)
  afterAll(() => { rmSync(base, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }) })

  for (const [kind, file, line] of [['node', 'app.js', 4], ['python', 'app.py', 4]] as const) {
    it(`${kind}: dừng ở điểm dừng, xem biến, bước qua rồi chạy hết`, async () => {
      const events: DebugEvent[] = []
      const manager = new DebugManager(base, (e) => events.push(e))
      await manager.start(kind, root, file, { [file]: [line] })
      await vi.waitFor(() => expect(events.some((e) => e.type === 'state' && e.state === 'stopped')).toBe(true), { timeout: 30_000 })
      const stop = events.find((e) => e.type === 'state' && e.state === 'stopped') as { threadId: number }
      const frames = await manager.stackTrace(stop.threadId)
      expect(frames[0]).toMatchObject({ file, line })
      const scopes = await manager.scopes(frames[0].id)
      const vars = (await Promise.all(scopes.filter((s) => !s.expensive).map((s) => manager.variables(s.variablesReference)))).flat()
      expect(vars.find((v) => v.name === 'total')?.value).toBe('0')
      const stops = events.length
      await manager.step('next', stop.threadId)
      await vi.waitFor(() => expect(events.slice(stops).some((e) => e.type === 'state' && e.state === 'stopped')).toBe(true), { timeout: 15_000 })
      await manager.setBreakpoints(file, [])
      await manager.step('continue', stop.threadId)
      await vi.waitFor(() => expect(events.some((e) => e.type === 'state' && e.state === 'terminated')).toBe(true), { timeout: 30_000 })
      expect(events.filter((e) => e.type === 'output').map((e) => (e as { text: string }).text).join('')).toContain('total 6')
    }, 90_000)
  }
})
