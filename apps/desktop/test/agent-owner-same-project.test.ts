// PR #49 vòng 3 (Minor): cùng một dự án mở ở HAI cửa sổ. Chủ phiên agent chỉ đổi sang cửa sổ gọi
// khi lượt được NHẬN; lệnh bị từ chối (ai_not_configured/agent_busy) không đổi chủ, nên reload cửa
// sổ kia không đóng phiên đang sống.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentExecutionSettings } from '../src/shared/agent-types'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  userData: '',
  root: '',
  focused: null as unknown,
  closed: [] as string[],
  agentDeps: null as { emit: (projectId: string, event: unknown) => void } | null,
  execution: new Map<string, AgentExecutionSettings>(),
  prompt: null as null | ((projectId: string, accepted: () => void) => Promise<void>)
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
    listProjects() { return ['p1', 'p2', 'p3', 'p4'].map((project_id) => ({ project_id, path: h.root })) }
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
    /** Như AgentService thật: đóng phiên xoá luôn quyền thực thi đã đặt. */
    close(projectId: string) { h.closed.push(`${this.tag}${projectId}`); h.execution.delete(projectId) }
    getExecution(projectId: string): AgentExecutionSettings {
      return h.execution.get(projectId) ?? { policy: 'review', allowCommands: false }
    }
    setExecution(projectId: string, settings: AgentExecutionSettings) { h.execution.set(projectId, { ...settings }) }
    async prompt(projectId: string, _text: string, _target: unknown, _options?: unknown, accepted?: () => void) {
      if (!h.prompt) throw new Error('thiếu h.prompt cho test')
      return h.prompt(projectId, accepted ?? (() => {}))
    }
    approve() {}
  }
  return { ...actual, AgentService: FakeAgentService }
})

vi.mock('../src/main/gemini/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/gemini/service')>()
  class FakeGeminiAgentService {
    getMode() { return 'ask' }
    close(projectId: string) { h.closed.push(`gemini:${projectId}`) }
    getExecution(): AgentExecutionSettings { return { policy: 'review', allowCommands: false } }
    async prompt() { return Promise.resolve() }
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
  h.userData = mkdtempSync(join(tmpdir(), 'ng-same-project-user-'))
  h.root = mkdtempSync(join(tmpdir(), 'ng-same-project-root-'))
  registerIpc(() => ({ baseUrl: 'http://127.0.0.1:1', token: 't' }) as never, () => h.focused as never, () => ({ command: 'engine', args: [] }), h.userData)
})

describe('cùng dự án ở hai cửa sổ', () => {
  it('(a) B prompt bị từ chối: chủ vẫn A; reload B không đóng phiên của A', async () => {
    const a = contents('A')
    const b = contents('B')
    expect(await invokeAs({ sender: a }, 'agent:set-execution', 'p1', { policy: 'review', allowCommands: true })).toMatchObject({ ok: true })

    h.prompt = async () => { throw new AgentError('ai_not_configured', 'Chưa cấu hình trợ lý AI') }
    expect(await invokeAs({ sender: b }, 'agent:prompt', 'p1', 'hỏi từ B', undefined, undefined))
      .toMatchObject({ ok: false, error: { code: 'ai_not_configured' } })

    h.closed.length = 0
    closeWindowResources(b as never) // B reload
    expect(h.closed).toEqual([])
    expect(await invokeAs({ sender: a }, 'agent:get-execution', 'p1'))
      .toEqual({ ok: true, data: { policy: 'review', allowCommands: true } })
  })

  it('(b) A đang chạy lượt, B gửi bị agent_busy: chủ vẫn A, stream vẫn về A', async () => {
    const a = contents('A')
    const b = contents('B')
    let finish!: () => void
    h.prompt = (_pid, accepted) => new Promise<void>((resolve) => { accepted(); finish = resolve })
    const running = invokeAs({ sender: a }, 'agent:prompt', 'p2', 'lượt của A', undefined, undefined)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))

    h.prompt = async () => { throw new AgentError('agent_busy', 'Trợ lý đang chạy tác vụ. Bấm Dừng trước khi đổi hội thoại hoặc quyền thực thi.') }
    expect(await invokeAs({ sender: b }, 'agent:prompt', 'p2', 'B gửi', undefined, undefined))
      .toMatchObject({ ok: false, error: { code: 'agent_busy' } })

    a.sent.length = 0
    b.sent.length = 0
    h.agentDeps!.emit('p2', { type: 'text', delta: 'stream của A' })
    expect(a.sent).toEqual([['agent:event', { projectId: 'p2', event: { type: 'text', delta: 'stream của A' } }]])
    expect(b.sent).toEqual([])
    finish()
    await running
  })

  it('(c) B prompt được nhận: chủ phiên chuyển sang B', async () => {
    const a = contents('A')
    const b = contents('B')
    expect(await invokeAs({ sender: a }, 'agent:get-mode', 'p3')).toMatchObject({ ok: true }) // A là chủ trước
    h.prompt = (_pid, accepted) => {
      accepted()
      h.agentDeps!.emit('p3', { type: 'text', delta: 'stream của B' })
      return Promise.resolve()
    }
    expect(await invokeAs({ sender: b }, 'agent:prompt', 'p3', 'hỏi từ B', undefined, undefined)).toMatchObject({ ok: true })
    expect(b.sent).toEqual([['agent:event', { projectId: 'p3', event: { type: 'text', delta: 'stream của B' } }]])
    expect(a.sent).toEqual([])
  })

  it('(d) cửa sổ không phải chủ rời màn dự án: không đóng phiên của chủ', async () => {
    const a = contents('A')
    const b = contents('B')
    await invokeAs({ sender: a }, 'agent:set-execution', 'p4', { policy: 'review', allowCommands: true })
    h.closed.length = 0
    // B rời màn (WorkspaceScreen unmount) → agent:close của B chỉ là rời màn, không giết phiên A.
    expect(await invokeAs({ sender: b }, 'agent:close', 'p4')).toMatchObject({ ok: true })
    expect(h.closed).toEqual([])
    expect(await invokeAs({ sender: a }, 'agent:get-execution', 'p4'))
      .toEqual({ ok: true, data: { policy: 'review', allowCommands: true } })
    // Chủ rời màn thì phiên đóng thật.
    expect(await invokeAs({ sender: a }, 'agent:close', 'p4')).toMatchObject({ ok: true })
    expect(h.closed).toEqual(['p4', 'gemini:p4', 'nex:p4'])
    expect(await invokeAs({ sender: a }, 'agent:get-execution', 'p4'))
      .toEqual({ ok: true, data: { policy: 'review', allowCommands: false } })
  })
})
