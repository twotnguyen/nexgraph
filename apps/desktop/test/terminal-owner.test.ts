// PR #49 vòng 2 (Important 3): dữ liệu/exit của terminal chỉ gửi về cửa sổ đã mở terminal,
// và chỉ cửa sổ đó được ghi/đổi kích thước/kill terminal (id đoán được).
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  userData: '',
  root: '',
  focused: null as unknown,
  writes: [] as number[],
  killed: [] as number[],
  sink: null as { data: (id: number, chunk: string) => void; exit: (id: number, code: number) => void } | null
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.userData, isPackaged: false },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => { h.handlers.set(channel, fn) } },
  BrowserWindow: { fromWebContents: () => ({}) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn(), trashItem: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))

vi.mock('../src/main/platform/engine/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/platform/engine/api')>()
  class FakeEngineApi {
    listProjects() { return [{ project_id: 'p1', path: h.root }] }
  }
  return { ...actual, EngineApi: FakeEngineApi }
})

vi.mock('../src/main/features/terminal/manager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/features/terminal/manager')>()
  class FakeTerminalManager {
    private readonly owners = new Map<number, unknown>()
    private next = 1
    constructor(sink: { data: (id: number, chunk: string) => void; exit: (id: number, code: number) => void }) { h.sink = sink }
    create(root: string, _cols: number, _rows: number, _task?: unknown, owner?: unknown) {
      const id = this.next++
      this.owners.set(id, owner)
      return { id, shell: 'fake-shell', cwd: root }
    }
    ownerOf(id: number) { return this.owners.get(id) }
    write(id: number) { h.writes.push(id) }
    resize() {}
    kill(id: number) { h.killed.push(id); this.owners.delete(id) }
    killOwned(owner: unknown) {
      for (const [id, held] of this.owners) if (held === owner) this.owners.delete(id)
    }
  }
  return { ...actual, TerminalManager: FakeTerminalManager }
})

import { registerIpc } from '../src/main/ipc'

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
const invokeAs = (event: unknown, channel: string, ...args: unknown[]): Promise<Result> => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`Thiếu handler ${channel}`)
  return fn(event, ...args) as Promise<Result>
}
const dataOf = <T,>(result: Result): T => (result as { ok: true; data: T }).data

type FakeContents = {
  tag: string
  sent: [string, unknown][]
  send(channel: string, payload: unknown): void
  isDestroyed(): boolean
}
const contents = (tag: string): FakeContents => ({
  tag,
  sent: [],
  send(channel: string, payload: unknown) { this.sent.push([channel, payload]) },
  isDestroyed: () => false
})

beforeAll(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'ng-term-own-user-'))
  h.root = mkdtempSync(join(tmpdir(), 'ng-term-own-root-'))
  registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => h.focused as never, () => ({ command: 'engine', args: [] }), h.userData)
})

describe('terminal thuộc cửa sổ đã mở', () => {
  it('terminal:event chỉ về cửa sổ đã mở terminal, không theo cửa sổ đang focus', async () => {
    const a = contents('A')
    const b = contents('B')
    h.focused = { webContents: b }
    const created = dataOf<{ id: number }>(await invokeAs({ sender: a }, 'terminal:create', 'p1', 80, 24))
    expect(h.sink).not.toBeNull()
    h.sink!.data(created.id, 'T1')
    h.sink!.exit(created.id, 0)
    expect(a.sent).toEqual([
      ['terminal:event', { id: created.id, type: 'data', data: 'T1' }],
      ['terminal:event', { id: created.id, type: 'exit', code: 0 }]
    ])
    expect(b.sent).toEqual([])
  })

  it('cửa sổ khác không ghi/kill được terminal của cửa sổ đã mở', async () => {
    const a = contents('A')
    const b = contents('B')
    const created = dataOf<{ id: number }>(await invokeAs({ sender: a }, 'terminal:create', 'p1', 80, 24))
    h.writes.length = 0
    h.killed.length = 0
    await invokeAs({ sender: b }, 'terminal:write', created.id, 'rm -rf /\r')
    await invokeAs({ sender: b }, 'terminal:kill', created.id)
    expect(h.writes).toEqual([])
    expect(h.killed).toEqual([])
    await invokeAs({ sender: a }, 'terminal:write', created.id, 'echo ok\r')
    await invokeAs({ sender: a }, 'terminal:kill', created.id)
    expect(h.writes).toEqual([created.id])
    expect(h.killed).toEqual([created.id])
  })
})
