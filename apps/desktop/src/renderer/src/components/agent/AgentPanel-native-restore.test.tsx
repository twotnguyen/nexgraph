// @vitest-environment jsdom
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, GeminiConsentTarget } from '@shared/agent-types'
import type { EngineApi } from '../../../../main/engine/api'
import { GeminiAgentService } from '../../../../main/gemini/service'
import { GeminiSessions } from '../../../../main/gemini/sessions'
import { emptyGeminiStatus, installNexgraph } from '../../test-utils'
import { AgentPanel } from './AgentPanel'

const directories: string[] = []
const services: GeminiAgentService[] = []
afterEach(() => {
  cleanup()
  for (const service of services.splice(0)) service.closeAll()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('AgentPanel native history integration', () => {
  it('hiện lại hai tin nhắn cùng phiên sau khi mở lại ứng dụng và kích hoạt Google, không khởi chạy CLI trước consent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'nexgraph-native-ui-')); directories.push(directory)
    const root = join(directory, 'source'); mkdirSync(root)
    const dataDir = join(directory, 'data')
    const target: GeminiConsentTarget = { runtime: 'antigravity-cli', provider: 'google-antigravity', connectionId: 'durable-google-connection' }
    const model = 'gemini-3.8-flash'
    const store = new GeminiSessions(dataDir)
    const stored = store.open({ projectId: 'p1', root, connectionId: target.connectionId }, model)
    stored.nativeId = randomUUID()
    stored.info.title = 'Phiên trước khi đóng ứng dụng'
    stored.messages = [
      { id: randomUUID(), role: 'user', text: 'Câu hỏi đã lưu trước khi đóng ứng dụng', timestamp: 1, citations: [], tools: [] },
      { id: randomUUID(), role: 'assistant', text: 'Câu trả lời từ phiên Google đã lưu', timestamp: 2, citations: [], tools: [] }
    ]
    store.save({ projectId: 'p1', root, connectionId: target.connectionId }, stored)
    let enabled = false, sourceConsent = false
    let emitAgent: (pid: string, event: AgentEvent) => void = () => {}
    const events: AgentEvent[] = []
    const createClient = vi.fn(async () => { throw new Error('A local history snapshot must not launch the native CLI') })
    // Use the real service and disk store. A session event emitted by snapshot()
    // invalidates useAgentWorkbench's own pending read and reproduces the empty UI.
    const service = new GeminiAgentService({
      api: {} as EngineApi, dataDir, rootOf: async () => root,
      consentTarget: async () => enabled ? target : null,
      hasConsent: async () => sourceConsent,
      emit: (pid, event) => { events.push(event); emitAgent(pid, event) },
      connection: { connectionIdentity: () => target.connectionId, selectedModel: () => model, createClient, configureSession: vi.fn(async () => {}) }
    })
    services.push(service)
    const availableModel = { runtime: 'antigravity-cli' as const, provider: 'google-antigravity', id: model, label: 'Gemini 3.8 Flash' }
    const fixture = installNexgraph({
      ai: {
        getSettings: vi.fn(async () => ({ runtime: 'antigravity-cli' as const, provider: 'google-antigravity', connectionId: target.connectionId, baseUrl: '', model: enabled ? model : '', hasKey: false })),
        hasConsent: vi.fn(async () => sourceConsent),
        grantConsent: vi.fn(async () => { sourceConsent = true })
      },
      auth: { models: vi.fn(async () => [availableModel]) },
      gemini: {
        status: vi.fn(async () => emptyGeminiStatus({ state: 'connected', authenticated: true, installed: true, connectionId: target.connectionId, model })),
        models: vi.fn(async () => [availableModel]),
        activate: vi.fn(async () => { enabled = true })
      },
      agent: {
        snapshot: vi.fn((pid) => service.snapshot(pid)), listSessions: vi.fn((pid) => service.listSessions(pid)),
        getMode: vi.fn(async (pid) => service.getMode(pid))
      }
    })
    emitAgent = fixture.emitAgent
    render(<AgentPanel projectId="p1" projectName="Dự án đã lưu" onOpenCode={vi.fn()} onHighlight={vi.fn()} onOpenSettings={vi.fn()} />)
    const composer = screen.getByPlaceholderText(/Hỏi về dự án/)
    await waitFor(() => expect(fixture.api.agent.snapshot).toHaveBeenCalledOnce())
    await userEvent.type(composer, 'Câu hỏi tiếp theo chưa gửi')
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled()
    expect(createClient).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Thêm thao tác' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Kết nối AI' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Kiểm tra kết nối và công cụ' }))
    await screen.findByText('Gemini đã sẵn sàng')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Dùng tài khoản Google' }))
    expect(await screen.findByText('Câu hỏi đã lưu trước khi đóng ứng dụng')).toBeInTheDocument()
    expect(await screen.findByText('Câu trả lời từ phiên Google đã lưu')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi' })).toBeEnabled())
    expect(composer).toHaveValue('Câu hỏi tiếp theo chưa gửi')
    expect(fixture.api.ai.grantConsent).toHaveBeenCalledWith('p1', target)
    expect((await service.snapshot('p1')).session?.id).toBe(stored.info.id)
    expect(events.filter((event) => event.type === 'session')).toHaveLength(0)
    expect(createClient).not.toHaveBeenCalled()
    expect(fixture.api.agent.prompt).not.toHaveBeenCalled()
  })
})
