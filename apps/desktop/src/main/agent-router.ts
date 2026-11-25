import type { AgentService } from './agent/session'

export type AgentRuntimeId = 'nex' | 'pi' | 'antigravity-cli'
type Methods = 'prompt' | 'abort' | 'setMode' | 'getMode' | 'approve' | 'close' | 'snapshot' | 'listSessions' | 'newSession' | 'forkSession' | 'switchSession' | 'renameSession' | 'deleteSession' | 'setExecution' | 'getExecution' | 'setLimits' | 'getLimits' | 'checkpoints' | 'rollback'
export type AgentRuntime = {
  [K in Methods]: (...args: Parameters<AgentService[K]>) => ReturnType<AgentService[K]> | Promise<Awaited<ReturnType<AgentService[K]>>>
} & { closeAll(): void; selectionChanged(): void }

/** The UI API is stable; credentials and native transcripts stay with their runtime. */
export class AgentRouter {
  constructor(
    private readonly pi: AgentRuntime,
    private readonly gemini: AgentRuntime,
    private readonly selected: () => AgentRuntimeId,
    /** Runtime Nex (OpenCode sidecar); vắng khi máy không có binary hoặc bản cài chưa đóng gói. */
    private readonly nex?: AgentRuntime
  ) {}
  private get active(): AgentRuntime {
    const id = this.selected()
    if (id === 'antigravity-cli') return this.gemini
    if (id === 'nex' && this.nex) return this.nex
    return this.pi
  }
  prompt(...args: Parameters<AgentService['prompt']>) { return this.active.prompt(...args) }
  abort(...args: Parameters<AgentService['abort']>) { return this.active.abort(...args) }
  setMode(...args: Parameters<AgentService['setMode']>) { return this.active.setMode(...args) }
  getMode(...args: Parameters<AgentService['getMode']>) { return this.active.getMode(...args) }
  approve(...args: Parameters<AgentService['approve']>) { return this.active.approve(...args) }
  async close(projectId: string) { await Promise.all([this.pi.close(projectId), this.gemini.close(projectId), this.nex?.close(projectId)]) }
  snapshot(...args: Parameters<AgentService['snapshot']>) { return this.active.snapshot(...args) }
  listSessions(...args: Parameters<AgentService['listSessions']>) { return this.active.listSessions(...args) }
  newSession(...args: Parameters<AgentService['newSession']>) { return this.active.newSession(...args) }
  forkSession(...args: Parameters<AgentService['forkSession']>) { return this.active.forkSession(...args) }
  switchSession(...args: Parameters<AgentService['switchSession']>) { return this.active.switchSession(...args) }
  renameSession(...args: Parameters<AgentService['renameSession']>) { return this.active.renameSession(...args) }
  deleteSession(...args: Parameters<AgentService['deleteSession']>) { return this.active.deleteSession(...args) }
  setExecution(...args: Parameters<AgentService['setExecution']>) { return this.active.setExecution(...args) }
  getExecution(...args: Parameters<AgentService['getExecution']>) { return this.active.getExecution(...args) }
  setLimits(...args: Parameters<AgentService['setLimits']>) { return this.active.setLimits(...args) }
  getLimits(...args: Parameters<AgentService['getLimits']>) { return this.active.getLimits(...args) }
  checkpoints(...args: Parameters<AgentService['checkpoints']>) { return this.active.checkpoints(...args) }
  rollback(...args: Parameters<AgentService['rollback']>) { return this.active.rollback(...args) }
  closeAll(): void { this.pi.closeAll(); this.gemini.closeAll(); this.nex?.closeAll() }
  selectionChanged(): void { this.pi.selectionChanged(); this.gemini.selectionChanged(); this.nex?.selectionChanged() }
}
