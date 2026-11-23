import type { EngineStatus } from '../../shared/engine-status'
import { getHealth } from './client'
import { EngineStartError, startEngine, type EngineCommand, type EngineHandle } from './launcher'

type Start = typeof startEngine

/**
 * Giữ trạng thái engine hiện tại, khởi động/khởi động lại, và báo mọi thay đổi.
 * Tách khỏi Electron để test được.
 */
export class EngineSupervisor {
  private handle: EngineHandle | null = null
  private status: EngineStatus = { state: 'starting' }
  private generation = 0

  constructor(
    private readonly command: () => EngineCommand,
    private readonly dataDir: string,
    private readonly onChange: (s: EngineStatus) => void,
    private readonly start: Start = startEngine
  ) {}

  getStatus(): EngineStatus {
    return this.status
  }

  /** Engine đang chạy, hoặc null khi chưa sẵn sàng / đã lỗi. */
  getHandle(): EngineHandle | null {
    return this.status.state === 'ready' ? this.handle : null
  }

  async startEngine(): Promise<void> {
    const gen = ++this.generation
    this.set({ state: 'starting' })
    try {
      const h = await this.start(this.command(), { dataDir: this.dataDir })
      if (gen !== this.generation) {
        await h.stop()
        return
      }
      this.handle = h
      h.onExit((code, signal) => {
        if (this.handle !== h) return // đã chủ động dừng hoặc khởi động lại
        this.handle = null
        const exit = code ?? signal ?? 'unknown'
        this.set({ state: 'error', message: `engine thoát (exit ${exit})`,
          messageKey: 'engine thoát (exit {code})', messageVars: { code: exit } })
      })
      const health = await getHealth(h)
      if (gen === this.generation && this.handle === h) {
        this.set({ state: 'ready', engineVersion: health.engine_version, vendorCommit: health.vendor_commit })
      }
    } catch (err) {
      if (gen !== this.generation) return
      const first = err instanceof EngineStartError ? err.stderrTail.trim().split('\n').pop() : undefined
      // Dòng stderr là chữ của engine (không dịch); chỉ giữ khoá khi thông báo do app tạo.
      const key = first ? undefined : err instanceof EngineStartError ? err.messageKey : undefined
      const vars = first ? undefined : err instanceof EngineStartError ? err.messageVars : undefined
      this.set({ state: 'error', message: first || (err instanceof Error ? err.message : String(err)), messageKey: key, messageVars: vars })
    }
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.startEngine()
  }

  async stop(): Promise<void> {
    this.generation++
    const h = this.handle
    this.handle = null
    if (h) await h.stop()
  }

  private set(s: EngineStatus): void {
    this.status = s
    this.onChange(s)
  }
}
