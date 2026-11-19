import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createApprovalGate } from '../src/main/agent/approval'
import { previewWrite } from '../src/main/agent/extension'
import { CheckpointStore } from '../src/main/agent/checkpoints'
import { detectProjectCommands, TaskExecution } from '../src/main/agent/process-tools'
import type { AgentMode, ApprovalRequest } from '../src/shared/agent-types'

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'ng-task-'))
  const root = join(base, 'Đồ án', 'demo')
  mkdirSync(root, { recursive: true })
  const storage = join(base, 'profile')
  const controller = new AbortController()
  let mode: AgentMode = 'edit'
  let permission = true
  // Lệnh luôn chờ duyệt (ADR 0016): fixture duyệt thay người dùng.
  const ask = vi.fn<(request: ApprovalRequest) => void>((request) => { queueMicrotask(() => gate.resolve(request.id, true)) })
  const gate = createApprovalGate({
    root, getMode: () => mode, getPolicy: () => 'auto', canRunCommands: () => permission,
    preview: (tool, input) => previewWrite(root, tool, input), ask
  })
  const task = new TaskExecution({ root, taskId: 'task-1', storageDir: storage, policy: 'auto', allowCommands: true,
    signal: controller.signal, assertCurrent: () => {
      controller.signal.throwIfAborted()
      if (mode !== 'edit') throw new Error('read only')
    }, gate })
  return { root, storage, controller, gate, task, ask, setMode: (next: AgentMode) => { mode = next }, revoke: () => { permission = false } }
}

describe('TaskExecution', () => {
  it('runs argv literally in Unicode project directory with filtered environment and bounded output', async () => {
    const f = fixture()
    const previous = process.env.NEXGRAPH_EXECUTION_FAKE_SECRET
    process.env.NEXGRAPH_EXECUTION_FAKE_SECRET = 'fake-not-for-child'
    try {
      const result = await f.task.run({ executable: 'node', args: ['-e',
        'console.log(JSON.stringify({arg:process.argv[1],cwd:process.cwd(),secret:process.env.NEXGRAPH_EXECUTION_FAKE_SECRET}));console.log("x".repeat(90000))',
        'literal & touch should-not-exist.txt'], timeoutMs: 10000 })
      expect(result.exitCode).toBe(0)
      expect(result.truncated).toBe(true)
      expect(result.output).toContain('literal & touch should-not-exist.txt')
      expect(result.output).toContain('demo')
      expect(result.output).not.toContain('fake-not-for-child')
      expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(65536)
      expect(existsSync(join(f.root, 'should-not-exist.txt'))).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.NEXGRAPH_EXECUTION_FAKE_SECRET
      else process.env.NEXGRAPH_EXECUTION_FAKE_SECRET = previous
    }
  })

  it('checks permission and read-only mode inside backend and rejects cwd escapes and direct network actions', async () => {
    const f = fixture()
    await expect(f.task.run({ executable: 'node', args: [], cwd: '..' })).rejects.toThrow('ngoài')
    await expect(f.task.run({ executable: 'git', args: ['push'] })).rejects.toThrow('Git')
    await expect(f.task.run({ executable: 'curl', args: ['https://example.invalid'] })).rejects.toThrow('cấp quyền')
    await expect(f.task.run({ executable: 'pnpm', args: ['install'] })).rejects.toThrow('script')
    await expect(f.task.run({ executable: 'uv', args: ['run', 'pytest'] })).rejects.toThrow('offline')
    f.revoke()
    await expect(f.task.run({ executable: 'node', args: ['-e', 'process.exit(0)'] })).rejects.toThrow('Chưa cho phép')
    f.setMode('plan')
    await expect(f.task.run({ executable: 'node', args: [] })).rejects.toThrow('read only')
  })

  it('preserves UTF-8 output characters split across process chunks', async () => {
    const f = fixture()
    const result = await f.task.run({ executable: 'node', args: ['-e',
      'process.stdout.write(Buffer.from([0xe1]));setTimeout(()=>process.stdout.end(Buffer.from([0xbb,0x87])),30)'] })
    expect(result.output).toBe('ệ')
  })

  it('review waits for a command decision and revoked approval never starts a process', async () => {
    const f = fixture()
    let requested!: ApprovalRequest
    const gate = createApprovalGate({ root: f.root, getMode: () => 'edit', getPolicy: () => 'review',
      canRunCommands: () => true, preview: async () => { throw new Error('unused') },
      ask: (request) => { requested = request } })
    const task = new TaskExecution({ root: f.root, taskId: 'review', storageDir: f.storage, policy: 'review', allowCommands: true,
      signal: f.controller.signal, assertCurrent: () => f.controller.signal.throwIfAborted(), gate })
    const result = task.run({ executable: 'node', args: ['-e', 'require("fs").writeFileSync("unexpected","x")'] })
    await vi.waitFor(() => expect(requested?.tool).toBe('command'))
    expect(requested).toMatchObject({ executable: 'node', cwd: '.', args: expect.any(Array) })
    gate.resolve(requested.id, true)
    gate.denyAll('stopped')
    await expect(result).rejects.toThrow('stopped')
    expect(existsSync(join(f.root, 'unexpected'))).toBe(false)
  })

  it('auto policy still waits for a command decision and a denial runs nothing', async () => {
    const f = fixture()
    let requested!: ApprovalRequest
    const gate = createApprovalGate({ root: f.root, getMode: () => 'edit', getPolicy: () => 'auto',
      canRunCommands: () => true, preview: async () => { throw new Error('unused') },
      ask: (request) => { requested = request } })
    const task = new TaskExecution({ root: f.root, taskId: 'auto', storageDir: f.storage, policy: 'auto', allowCommands: true,
      signal: f.controller.signal, assertCurrent: () => f.controller.signal.throwIfAborted(), gate })
    const result = task.run({ executable: 'node', args: ['-e', 'require("fs").writeFileSync("unexpected","x")'] })
    await vi.waitFor(() => expect(requested?.tool).toBe('command'))
    gate.resolve(requested.id, false)
    await expect(result).rejects.toThrow()
    expect(existsSync(join(f.root, 'unexpected'))).toBe(false)
  })

  it('kills timed-out and cancelled processes and streams stdout and stderr', async () => {
    const f = fixture()
    const output = vi.fn()
    const task = new TaskExecution({ root: f.root, taskId: 'stream', storageDir: f.storage, policy: 'auto', allowCommands: true,
      signal: f.controller.signal, assertCurrent: () => f.controller.signal.throwIfAborted(), gate: f.gate, onOutput: output })
    const timed = await task.run({ executable: 'node', args: ['-e', 'console.log("started");console.error("errorstream");setInterval(()=>{},100)'], timeoutMs: 400 })
    expect(timed.timedOut).toBe(true)
    expect(output.mock.calls.some(([event]) => event.stream === 'stdout')).toBe(true)
    expect(output.mock.calls.some(([event]) => event.stream === 'stderr')).toBe(true)
    const running = task.run({ executable: 'node', args: ['-e', 'setInterval(()=>{},100)'], timeoutMs: 10000 })
    setTimeout(() => f.controller.abort(), 200)
    expect((await running).cancelled).toBe(true)
  }, 15000)

  it('timeout kills a child process created by the command', async () => {
    const f = fixture()
    const result = await f.task.run({ executable: 'node', args: ['-e',
      'require("child_process").spawn(process.execPath,["-e",\'setTimeout(()=>require("fs").writeFileSync("child-survived","x"),1000)\'],{stdio:"ignore"});setInterval(()=>{},100)'],
      timeoutMs: 350 })
    expect(result.timedOut).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(existsSync(join(f.root, 'child-survived'))).toBe(false)
  }, 15000)

  it('refuses to run code when the source checkpoint budget is exceeded', async () => {
    const f = fixture()
    const text = 'a'.repeat(5 * 1024 * 1024)
    for (let n = 0; n < 7; n++) writeFileSync(join(f.root, `source-${n}.txt`), text)
    await expect(f.task.run({ executable: 'node', args: ['-e', 'require("fs").writeFileSync("must-not-run","x")'] }))
      .rejects.toThrow('32 MiB')
    expect(existsSync(join(f.root, 'must-not-run'))).toBe(false)
  })
})

describe('project command discovery', () => {
  it('uses declared project scripts and lockfile without executing package hooks', () => {
    const f = fixture()
    writeFileSync(join(f.root, 'package.json'), JSON.stringify({ scripts: {
      test: 'vitest run', typecheck: 'tsc --noEmit', postinstall: 'touch unexpected', 'test:unit': 'vitest unit'
    } }))
    writeFileSync(join(f.root, 'pnpm-lock.yaml'), '')
    const result = detectProjectCommands(f.root)
    expect(result.packageManager).toBe('pnpm')
    expect(result.commands.map((command) => command.id)).toEqual(['script:test', 'script:typecheck', 'script:test:unit'])
    expect(result.commands[0]).toMatchObject({ executable: 'pnpm', args: ['run', 'test'], cwd: '.' })
    expect(existsSync(join(f.root, 'unexpected'))).toBe(false)
  })
})

describe('AI checkpoints', () => {
  it('captures script edits, creations and deletions and combines them with direct writes', async () => {
    const f = fixture()
    writeFileSync(join(f.root, 'direct.ts'), 'original')
    writeFileSync(join(f.root, 'removed.ts'), 'keep original')
    writeFileSync(join(f.root, '.env'), 'protected original')
    writeFileSync(join(f.root, 'before.bin'), Buffer.from([0, 1, 2]))
    await f.task.checkpoints.write(await previewWrite(f.root, 'write', { path: 'direct.ts', content: 'AI first' }), () => {})
    const result = await f.task.run({ executable: 'node', args: ['-e',
      'const fs=require("fs");fs.writeFileSync("direct.ts","script after");fs.writeFileSync("new.ts","new");fs.unlinkSync("removed.ts");fs.writeFileSync("before.bin","became text");fs.writeFileSync(".env","protected changed")'
    ] })
    expect(result.checkpointPaths?.sort()).toEqual(['direct.ts', 'new.ts', 'removed.ts'])
    expect(result.checkpointWarnings?.join(' ')).toContain('phạm vi AI')
    expect(f.task.checkpoints.list().find((file) => file.path === 'direct.ts')?.before).toBe('original')
    expect((await f.task.checkpoints.rollback()).conflicts).toEqual([])
    expect(readFileSync(join(f.root, 'direct.ts'), 'utf8')).toBe('original')
    expect(readFileSync(join(f.root, 'removed.ts'), 'utf8')).toBe('keep original')
    expect(existsSync(join(f.root, 'new.ts'))).toBe(false)
    expect(readFileSync(join(f.root, '.env'), 'utf8')).toBe('protected changed')
    expect(readFileSync(join(f.root, 'before.bin'), 'utf8')).toBe('became text')
  })

  it('persists initial content across repeated edits and restores modified or newly created files without Git', async () => {
    const f = fixture()
    writeFileSync(join(f.root, 'a.ts'), '\uFEFFfirst\r\n')
    const store = f.task.checkpoints
    await store.write(await previewWrite(f.root, 'write', { path: 'a.ts', content: 'second\n' }), () => {})
    await store.write(await previewWrite(f.root, 'write', { path: 'a.ts', content: 'third\n' }), () => {})
    await store.write(await previewWrite(f.root, 'write', { path: 'new.ts', content: 'new\n' }), () => {})
    expect(store.list()).toHaveLength(2)
    expect(store.list().find((file) => file.path === 'a.ts')).toMatchObject({ before: 'first\n', after: 'third\n', createdAt: expect.any(Number) })
    const reopened = new CheckpointStore(f.root, f.storage, 'task-1')
    expect(await reopened.rollback()).toEqual({ restored: ['new.ts', 'a.ts'], conflicts: [] })
    expect(existsSync(join(f.root, 'new.ts'))).toBe(false)
    expect(readFileSync(join(f.root, 'a.ts'), 'utf8')).toBe('\uFEFFfirst\r\n')
    expect(await reopened.rollback()).toEqual({ restored: [], conflicts: [] })
  })

  it('partial rollback preserves user edits and keeps an independent file restorable', async () => {
    const f = fixture()
    writeFileSync(join(f.root, 'a.ts'), 'before')
    writeFileSync(join(f.root, 'b.ts'), 'before')
    for (const path of ['a.ts', 'b.ts']) await f.task.checkpoints.write(await previewWrite(f.root, 'write', { path, content: 'AI' }), () => {})
    writeFileSync(join(f.root, 'b.ts'), 'user edit')
    const result = await f.task.checkpoints.rollback()
    expect(result.restored).toEqual(['a.ts'])
    expect(result.conflicts).toEqual([{ path: 'b.ts', reason: expect.stringContaining('sửa sau') }])
    expect(readFileSync(join(f.root, 'b.ts'), 'utf8')).toBe('user edit')
    expect(readFileSync(join(f.root, 'a.ts'), 'utf8')).toBe('before')
  })

  it('unsaved editor buffers block previews, writes and rollback', async () => {
    const f = fixture()
    writeFileSync(join(f.root, 'a.ts'), 'before')
    let dirty = false
    const guard = () => { if (dirty) throw new Error('Save editor first') }
    const store = new CheckpointStore(f.root, f.storage, 'dirty', guard)
    const preview = await previewWrite(f.root, 'write', { path: 'a.ts', content: 'after' }, guard)
    dirty = true
    await expect(previewWrite(f.root, 'write', { path: 'a.ts', content: 'after' }, guard)).rejects.toThrow('Save editor')
    await expect(store.write(preview, guard)).rejects.toThrow('Save editor')
    dirty = false
    await store.write(preview, guard)
    dirty = true
    expect((await store.rollback()).conflicts[0].reason).toBe('Save editor first')
    expect(readFileSync(join(f.root, 'a.ts'), 'utf8')).toBe('after')
  })
})
