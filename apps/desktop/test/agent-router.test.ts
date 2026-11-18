import { describe, expect, it, vi } from 'vitest'
import { AgentRouter, type AgentRuntime, type AgentRuntimeId } from '../src/main/agent-router'

const runtime = (name: string) => ({
  prompt: vi.fn(async () => {}), abort: vi.fn(async () => {}), setMode: vi.fn(), getMode: vi.fn(() => 'ask' as const), approve: vi.fn(), close: vi.fn(async () => {}), closeAll: vi.fn(), selectionChanged: vi.fn(),
  snapshot: vi.fn(async () => ({ marker: name })), listSessions: vi.fn(async () => []), newSession: vi.fn(), switchSession: vi.fn(), renameSession: vi.fn(), deleteSession: vi.fn(),
  setExecution: vi.fn(), getExecution: vi.fn(), setLimits: vi.fn(), getLimits: vi.fn(), checkpoints: vi.fn(), rollback: vi.fn()
})
describe('Agent runtime router', () => {
  it('keeps the selected runtime for errors rather than falling back to an API provider', async () => {
    const pi = runtime('pi'), google = runtime('google')
    let selected: AgentRuntimeId = 'antigravity-cli'
    const router = new AgentRouter(pi as unknown as AgentRuntime, google as unknown as AgentRuntime, () => selected)
    google.prompt.mockRejectedValueOnce(new Error('quota'))
    const target = { runtime: 'antigravity-cli' as const, provider: 'google-antigravity' as const, connectionId: 'a' }
    await expect(router.prompt('p', 'hello', target)).rejects.toThrow('quota')
    expect(pi.prompt).not.toHaveBeenCalled()
    selected = 'pi'
    await router.prompt('p', 'explicit API selection', { provider: 'google', baseUrl: 'https://google.test' })
    expect(pi.prompt).toHaveBeenCalledOnce()
  })
  it('invalidates and closes both runtimes when a project or connection closes', async () => {
    const pi = runtime('pi'), google = runtime('google')
    const router = new AgentRouter(pi as unknown as AgentRuntime, google as unknown as AgentRuntime, () => 'pi')
    router.selectionChanged(); await router.close('p'); router.closeAll()
    expect(pi.selectionChanged).toHaveBeenCalledOnce(); expect(google.selectionChanged).toHaveBeenCalledOnce()
    expect(pi.close).toHaveBeenCalledWith('p'); expect(google.close).toHaveBeenCalledWith('p')
    expect(pi.closeAll).toHaveBeenCalledOnce(); expect(google.closeAll).toHaveBeenCalledOnce()
  })
})
