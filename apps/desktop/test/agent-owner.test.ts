// PR #49 vòng 2 (Important 2): sự kiện agent đi về cửa sổ đã mở phiên, và reload/đóng một cửa sổ
// chỉ dọn phiên agent của chính cửa sổ đó.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  userData: '',
  root: '',
  focused: null as unknown,
  closed: [] as string[],
  approvals: [] as string[],
  agentDeps: null as { emit: (projectId: string, event: unknown) => void } | null,
  prompt: null as null | (() => Promise<void>)
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.userData, isPackaged: false },
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => { h.handlers.set(channel, fn) } },
  BrowserWindow: { fromWebContents: () => ({}) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn(), trashItem: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() }
}))

vi.mock('../src/main/engine/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/engine/api')>()
  class FakeEngineApi {
    listProjects() { return [{ project_id: 'p1', path: h.root }] }
  }
  return { ...actual, EngineApi: FakeEngineApi }
})

vi.mock('../src/main/agent/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/agent/session')>()
  class FakeAgentService {
    private readonly tag: string
    constructor(deps: { emit: (projectId: string, event: unknown) => void; createSession?: unknown }) {
      h.agentDeps = deps
      this.tag = deps.createSession ? 'nex:' : ''
    }
    getMode() { return 'ask' }
    close(projectId: string) { h.closed.push(`${this.tag}${projectId}`) }
    prompt() { return h.prompt ? h.prompt() : Promise.resolve() }
    approve(projectId: string, id: string) { h.approvals.push(`${projectId}:${id}`) }
  }
  return { ...actual, AgentService: FakeAgentService }
})

vi.mock('../src/main/gemini/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/gemini/service')>()
  class FakeGeminiAgentService {
    getMode() { return 'ask' }
    close(projectId: string) { h.closed.push(`gemini:${projectId}`) }
  }
  return { ...actual, GeminiAgentService: FakeGeminiAgentService }
})

import { AgentError } from '../src/main/agent/session'
import { closeWindowResources, registerIpc } from '../src/main/ipc'

type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
const invokeAs = (event: unknown, channel: string, ...args: unknown[]): Promise<Result> => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`Thiếu handler ${channel}`)
  return fn(event, ...args) as Promise<Result>
}

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
  h.userData = mkdtempSync(join(tmpdir(), 'ng-agent-own-user-'))
  h.root = mkdtempSync(join(tmpdir(), 'ng-agent-own-root-'))
  registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => h.focused as never, () => ({ command: 'engine', args: [] }), h.userData)
})

describe('phiên agent thuộc cửa sổ đã mở', () => {
  it('agent:event đi về cửa sổ đã mở phiên, không theo cửa sổ đang focus', async () => {
    const a = contents('A')
    const b = contents('B')
    h.focused = { webContents: b }
    expect(await invokeAs({ sender: a }, 'agent:get-mode', 'p1')).toMatchObject({ ok: true })
    h.agentDeps!.emit('p1', { type: 'text', delta: 'XA' })
    expect(a.sent).toEqual([['agent:event', { projectId: 'p1', event: { type: 'text', delta: 'XA' } }]])
    expect(b.sent).toEqual([])
  })

  it('closeWindowResources chỉ dọn phiên agent của đúng cửa sổ; cửa sổ khác giữ phiên', async () => {
    const a = contents('A')
    const b = contents('B')
    await invokeAs({ sender: a }, 'agent:get-mode', 'p2')
    h.closed.length = 0
    closeWindowResources(b as never)
    expect(h.closed).toEqual([])
    // Cửa sổ B vẫn nhận phiên của mình (chưa từng mở phiên nào) — sự kiện của A không đổi chủ.
    const c = contents('C')
    h.focused = { webContents: c }
    h.agentDeps!.emit('p2', { type: 'text', delta: 'còn sống' })
    expect(a.sent.at(-1)).toEqual(['agent:event', { projectId: 'p2', event: { type: 'text', delta: 'còn sống' } }])
    expect(c.sent).toEqual([])
    closeWindowResources(a as never)
    expect(h.closed).toEqual(['p2', 'gemini:p2', 'nex:p2'])
    // Cửa sổ đã dọn thì không còn chủ: sự kiện không bị gửi sang cửa sổ đang focus.
    h.agentDeps!.emit('p2', { type: 'text', delta: 'muộn' })
    expect(c.sent).toEqual([])
  })

  it('prompt bị từ chối (chưa cấu hình AI) không chuyển chủ phiên', async () => {
    const a = contents('A')
    const b = contents('B')
    expect(await invokeAs({ sender: a }, 'agent:get-mode', 'p3')).toMatchObject({ ok: true })

    h.prompt = async () => { throw new AgentError('ai_not_configured', 'Chưa cấu hình trợ lý AI') }
    const rejected = await invokeAs({ sender: b }, 'agent:prompt', 'p3', 'hỏi', undefined, undefined)
    h.prompt = null
    expect(rejected).toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })

    a.sent.length = 0
    b.sent.length = 0
    h.agentDeps!.emit('p3', { type: 'text', delta: 'vẫn của A' })
    expect(a.sent).toEqual([['agent:event', { projectId: 'p3', event: { type: 'text', delta: 'vẫn của A' } }]])
    expect(b.sent).toEqual([])
  })

  it('chỉ chủ phiên hiện tại được trả lời yêu cầu duyệt', async () => {
    const a = contents('A')
    const b = contents('B')
    h.approvals.length = 0
    expect(await invokeAs({ sender: a }, 'agent:get-mode', 'p4')).toMatchObject({ ok: true })

    expect(await invokeAs({ sender: b }, 'agent:approve', 'p4', 'r1', true))
      .toMatchObject({ ok: false, error: { code: 'forbidden_owner' } })
    expect(h.approvals).toEqual([])

    expect(await invokeAs({ sender: a }, 'agent:approve', 'p4', 'r1', true)).toMatchObject({ ok: true })
    expect(h.approvals).toEqual(['p4:r1'])
  })
})
