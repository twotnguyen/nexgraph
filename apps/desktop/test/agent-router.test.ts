import { describe, expect, it, vi } from 'vitest'
import { AgentRouter, type AgentRuntime, type AgentRuntimeId } from '../src/main/agent-router'

const runtime = (name: string) => ({
  pending: vi.fn(() => 0),
  prompt: vi.fn(async () => {}), abort: vi.fn(async () => {}), setMode: vi.fn(), getMode: vi.fn(() => 'ask' as const), approve: vi.fn(), close: vi.fn(async () => {}), closeAll: vi.fn(), selectionChanged: vi.fn(),
  snapshot: vi.fn(async () => ({ marker: name })), listSessions: vi.fn(async () => []), newSession: vi.fn(), switchSession: vi.fn(), renameSession: vi.fn(), deleteSession: vi.fn(),
  setExecution: vi.fn(), getExecution: vi.fn(), setLimits: vi.fn(), getLimits: vi.fn(), checkpoints: vi.fn(), rollback: vi.fn(), hasActiveTurn: vi.fn(() => false)
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
  it('routes to Nex when selected and falls back to Pi when Nex is absent', async () => {
    const pi = runtime('pi'), google = runtime('google'), nex = runtime('nex')
    let selected: AgentRuntimeId = 'nex'
    const router = new AgentRouter(pi as unknown as AgentRuntime, google as unknown as AgentRuntime, () => selected, nex as unknown as AgentRuntime)
    await router.prompt('p', 'hello', { provider: 'custom-1', baseUrl: 'https://ai.test/v1' })
    expect(nex.prompt).toHaveBeenCalledOnce()
    expect(pi.prompt).not.toHaveBeenCalled()
    router.selectionChanged(); await router.close('p'); router.closeAll()
    expect(nex.selectionChanged).toHaveBeenCalledOnce(); expect(nex.closeAll).toHaveBeenCalledOnce()
    const fallbackPi = runtime('pi'), fallbackGoogle = runtime('google')
    const fallback = new AgentRouter(fallbackPi as unknown as AgentRuntime, fallbackGoogle as unknown as AgentRuntime, () => selected)
    await fallback.prompt('p', 'hello', { provider: 'custom-1', baseUrl: 'https://ai.test/v1' })
    expect(fallbackPi.prompt).toHaveBeenCalledOnce()
    selected = 'pi'
  })
  it('phiếu duyệt đi tới runtime sở hữu lượt dù đang chọn runtime khác', () => {
    const pi = runtime('pi'), google = runtime('google'), nex = runtime('nex')
    const router = new AgentRouter(pi as unknown as AgentRuntime, google as unknown as AgentRuntime, () => 'pi', nex as unknown as AgentRuntime)
    ;(nex.pending as ReturnType<typeof vi.fn>).mockReturnValue(1)
    router.approve('p', 'approval-1', false)
    expect(nex.approve).toHaveBeenCalledWith('p', 'approval-1', false)
    expect(pi.approve).not.toHaveBeenCalled()
    ;(nex as unknown as { hasActiveTurn: ReturnType<typeof vi.fn> }).hasActiveTurn.mockReturnValue(true)
    expect(router.hasActiveTurn()).toBe(true)
  })
})
