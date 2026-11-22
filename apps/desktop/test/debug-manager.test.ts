import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DebugEvent } from '../src/shared/api'
import { DapClient } from '../src/main/debug/dap-client'
import { adapterInstalled, installAdapter, type DebugKind } from '../src/main/debug/adapters'
import { DebugManager, toDapBreakpoints } from '../src/main/debug/manager'

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

it('chỉ gửi điểm dừng đang bật và các thuộc tính DAP có giá trị', () => {
  expect(toDapBreakpoints([
    { line: 4, enabled: true, condition: 'n == 2', hitCondition: '3', logMessage: 'n={n}' },
    { line: 5, enabled: false, condition: 'false' },
    { line: 8, enabled: true, condition: '' }
  ])).toEqual([{ line: 4, condition: 'n == 2', hitCondition: '3', logMessage: 'n={n}' }, { line: 8 }])
})

it('chỉ gọi modules/loadedSources khi adapter hỗ trợ và trả danh sách rỗng kèm thông báo khi lỗi', async () => {
  const request = vi.fn((command: string) => {
    if (command === 'modules') return Promise.resolve({ modules: [{ id: 3, name: 'app', path: '/p/app.js', version: '1' }] })
    if (command === 'loadedSources') return Promise.reject(new Error('không có nguồn'))
    return Promise.resolve({})
  })
  const events: DebugEvent[] = []
  const manager = new DebugManager('', (event) => events.push(event))
  const session = { control: { request }, supportsModules: true, supportsLoadedSources: true }
  Reflect.set(manager, 'session', session)
  await expect(manager.modules()).resolves.toEqual([{ id: 3, name: 'app', path: '/p/app.js', version: '1' }])
  expect(request).toHaveBeenCalledWith('modules')
  await expect(manager.loadedSources()).resolves.toEqual([])
  expect(request).toHaveBeenCalledWith('loadedSources')
  expect(events).toContainEqual({ type: 'notice', target: 'loadedSources', code: 'debug.sources_failed', detail: expect.stringContaining('không có nguồn') })
  session.supportsModules = false
  session.supportsLoadedSources = false
  request.mockClear()
  expect(await manager.modules()).toEqual([])
  expect(await manager.loadedSources()).toEqual([])
  expect(request).not.toHaveBeenCalled()
})

// Chạy adapter thật (tải js-debug và debugpy về thư mục tạm): NEXGRAPH_DEBUG_IT=1 pnpm exec vitest run test/debug-manager.test.ts
describe.skipIf(!process.env.NEXGRAPH_DEBUG_IT)('gỡ lỗi thật với js-debug và debugpy', () => {
  const base = mkdtempSync(join(tmpdir(), 'ng-dbg-adapters-'))
  const root = mkdtempSync(join(tmpdir(), 'ng-dbg-proj-'))
  beforeAll(async () => {
    for (const kind of ['node', 'python'] as DebugKind[]) if (!adapterInstalled(base, kind)) await installAdapter(base, kind)
    writeFileSync(join(root, 'app.js'), 'const items = [1, 2, 3]\nlet total = 0\nfor (const n of items) {\n  total += n\n}\nconsole.log("total", total)\n')
    writeFileSync(join(root, 'app.py'), 'items = [1, 2, 3]\ntotal = 0\nfor n in items:\n    total += n\nprint("total", total)\n')
    writeFileSync(join(root, 'wait.js'), 'setInterval(() => {}, 1000)\n')
    writeFileSync(join(root, 'wait.py'), 'import time\nwhile True:\n    time.sleep(0.05)\n')
  }, 120_000)
  afterAll(() => { rmSync(base, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }) })

  for (const [kind, file, line] of [['node', 'app.js', 4], ['python', 'app.py', 4]] as const) {
    it(`${kind}: dừng ở điểm dừng, xem biến, bước qua rồi chạy hết`, async () => {
      const events: DebugEvent[] = []
      const manager = new DebugManager(base, (e) => events.push(e))
      await manager.start(kind, root, file, { [file]: [{ line, enabled: true }] })
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
      await manager.setBreakpoints(file, [{ line, enabled: false }])
      await manager.step('continue', stop.threadId)
      await vi.waitFor(() => expect(events.some((e) => e.type === 'state' && e.state === 'terminated')).toBe(true), { timeout: 30_000 })
      expect(events.filter((e) => e.type === 'output').map((e) => (e as { text: string }).text).join('')).toContain('total 6')
    }, 90_000)

    it(`${kind}: điều kiện, evaluate watch/repl và chạy lại`, async () => {
      const events: DebugEvent[] = []
      const manager = new DebugManager(base, (event) => events.push(event))
      try {
        await manager.start(kind, root, file, { [file]: [{ line, enabled: true, condition: 'n == 2' }] })
        await vi.waitFor(() => expect(events.some((e) => e.type === 'state' && e.state === 'stopped')).toBe(true), { timeout: 30_000 })
        const first = events.find((e) => e.type === 'state' && e.state === 'stopped') as { threadId: number }
        const [frame] = await manager.stackTrace(first.threadId)
        expect((await manager.evaluate('n', frame.id, 'watch')).result).toBe('2')
        expect((await manager.evaluate('total * 10', frame.id, 'watch')).result).toBe('10')
        expect((await manager.evaluate('items', frame.id, 'repl')).result).toContain('1')
        const before = events.length
        await manager.restart()
        await vi.waitFor(() => expect(events.slice(before).some((e) => e.type === 'state' && e.state === 'stopped')).toBe(true), { timeout: 30_000 })
        const second = events.slice(before).find((e) => e.type === 'state' && e.state === 'stopped') as { threadId: number }
        const [restarted] = await manager.stackTrace(second.threadId)
        expect((await manager.evaluate('n', restarted.id, 'watch')).result).toBe('2')
      } finally { await manager.stop() }
    }, 120_000)

    it(`${kind}: điều kiện số lần chạm dừng ở lần thứ hai`, async () => {
      const events: DebugEvent[] = []
      const manager = new DebugManager(base, (event) => events.push(event))
      try {
        await manager.start(kind, root, file, { [file]: [{ line, enabled: true, hitCondition: '2' }] })
        await vi.waitFor(() => expect(events.some((e) => e.type === 'state' && e.state === 'stopped')).toBe(true), { timeout: 30_000 })
        const stop = events.find((e) => e.type === 'state' && e.state === 'stopped') as { threadId: number }
        const [frame] = await manager.stackTrace(stop.threadId)
        expect((await manager.evaluate('n', frame.id, 'watch')).result).toBe('2')
      } finally { await manager.stop() }
    }, 90_000)

    it(`${kind}: log point ghi ra mà không dừng`, async () => {
      const events: DebugEvent[] = []
      const manager = new DebugManager(base, (event) => events.push(event))
      try {
        await manager.start(kind, root, file, { [file]: [{ line, enabled: true, logMessage: 'n={n}' }] })
        await vi.waitFor(() => expect(events.some((e) => e.type === 'state' && e.state === 'terminated')).toBe(true), { timeout: 30_000 })
        expect(events.some((e) => e.type === 'state' && e.state === 'stopped')).toBe(false)
        expect(events.filter((e) => e.type === 'output').map((e) => (e as { text: string }).text).join('')).toContain('n=2')
      } finally { await manager.stop() }
    }, 90_000)

    it(`${kind}: tạm dừng chương trình đang chạy`, async () => {
      const events: DebugEvent[] = []
      const manager = new DebugManager(base, (event) => events.push(event))
      try {
        await manager.start(kind, root, kind === 'node' ? 'wait.js' : 'wait.py', {})
        await manager.pause()
        await vi.waitFor(() => expect(events.some((e) => e.type === 'state' && e.state === 'stopped')).toBe(true), { timeout: 30_000 })
      } finally { await manager.stop() }
    }, 90_000)
  }
})
