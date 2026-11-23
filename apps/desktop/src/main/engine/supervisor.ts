import type { EngineStatus } from '../../shared/engine-status'
import { getHealth } from './client'
import { EngineStartError, startEngine, type EngineCommand, type EngineHandle } from './launcher'

type Start = typeof startEngine

/** Chính sách tự khởi động lại sau khi engine thoát hoặc không lên được. */
export interface RetryPolicy {
  /** Số lần tự khởi động lại liên tiếp trong một cửa sổ trước khi dừng chờ người dùng. */
  maxRestarts: number
  /** Cửa sổ đếm (ms); hết hạn thì coi như engine đã khoẻ và cho lại đủ lượt. */
  windowMs: number
  /** Chờ trước lần thử thứ n (1-based). */
  delayMs: (attempt: number) => number
}

/** 1 s, 2 s, 4 s, 8 s, 16 s… tối đa 30 s; 5 lần trong 10 phút (A1 F2). */
export const DEFAULT_RETRY: RetryPolicy = {
  maxRestarts: 5,
  windowMs: 10 * 60_000,
  delayMs: (attempt) => Math.min(1000 * 2 ** (attempt - 1), 30_000)
}

/**
 * Giữ trạng thái engine hiện tại, khởi động/khởi động lại, và báo mọi thay đổi.
 * Tách khỏi Electron để test được.
 */
export class EngineSupervisor {
  private handle: EngineHandle | null = null
  private status: EngineStatus = { state: 'starting' }
  private generation = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  /** Thời điểm các lần thất bại trong cửa sổ hiện tại; engine chết ngay sau khi sẵn sàng vẫn bị đếm. */
  private failures: number[] = []
  private readonly retry: RetryPolicy

  constructor(
    private readonly command: () => EngineCommand,
    private readonly dataDir: string,
    private readonly onChange: (s: EngineStatus) => void,
    private readonly start: Start = startEngine,
    retry: Partial<RetryPolicy> = {}
  ) {
    this.retry = { ...DEFAULT_RETRY, ...retry }
  }

  getStatus(): EngineStatus {
    return this.status
  }

  /** Engine đang chạy, hoặc null khi chưa sẵn sàng / đã lỗi. */
  getHandle(): EngineHandle | null {
    return this.status.state === 'ready' ? this.handle : null
  }

  async startEngine(): Promise<void> {
    this.cancelRetry()
    const gen = ++this.generation
    this.set({ state: 'starting' })
    // Giữ handle ngoài try để catch còn dừng được engine đã spawn (M3).
    let h: EngineHandle | null = null
    try {
      h = await this.start(this.command(), { dataDir: this.dataDir })
      if (gen !== this.generation) {
        await h.stop()
        return
      }
      this.handle = h
      h.onExit((code, signal) => {
        if (this.handle !== h) return // đã chủ động dừng hoặc khởi động lại
        this.handle = null
        const exit = code ?? signal ?? 'unknown'
        this.retryLater({ state: 'error', message: `engine thoát (exit ${exit})`,
          messageKey: 'engine thoát (exit {code})', messageVars: { code: exit } })
      })
      const health = await getHealth(h)
      if (gen === this.generation && this.handle === h) {
        this.set({ state: 'ready', engineVersion: health.engine_version, vendorCommit: health.vendor_commit })
      }
    } catch (err) {
      if (gen !== this.generation) return
      this.handle = null
      // Engine đã spawn nhưng health lỗi: dừng trước khi bỏ handle, nếu không nó thành mồ côi
      // và vòng tự thử lại spawn thêm engine nữa (review-50 M3).
      if (h) await h.stop().catch(() => {})
      const first = err instanceof EngineStartError ? err.stderrTail.trim().split('\n').pop() : undefined
      // Dòng stderr là chữ của engine (không dịch); chỉ giữ khoá khi thông báo do app tạo.
      const key = first ? undefined : err instanceof EngineStartError ? err.messageKey : undefined
      const vars = first ? undefined : err instanceof EngineStartError ? err.messageVars : undefined
      this.retryLater({ state: 'error', message: first || (err instanceof Error ? err.message : String(err)), messageKey: key, messageVars: vars })
    }
  }

  /** Người dùng bấm Khởi động lại: xoá lịch sử lỗi để có đủ lượt tự thử lại. */
  async restart(): Promise<void> {
    await this.stop()
    this.failures = []
    await this.startEngine()
  }

  async stop(): Promise<void> {
    this.generation++
    this.cancelRetry()
    const h = this.handle
    this.handle = null
    if (h) await h.stop()
  }

  /**
   * Hẹn khởi động lại với backoff. Quá số lần trong cửa sổ thì dừng hẳn và báo `restartable`
   * để thanh trạng thái hiện nút "Khởi động lại engine"; không có vòng lặp vô hạn khi engine
   * chết ngay lúc khởi động.
   */
  private retryLater(reason: Extract<EngineStatus, { state: 'error' }>): void {
    const now = Date.now()
    this.failures = this.failures.filter((at) => now - at < this.retry.windowMs)
    this.failures.push(now)
    const attempt = this.failures.length
    if (attempt > this.retry.maxRestarts) {
      this.set({ ...reason, restartable: true })
      return
    }
    // Giữ lý do chết ngắn trong trạng thái đang thử lại để thanh trạng thái nói được vì sao (M5).
    this.set({ state: 'starting', attempt,
      ...(reason.message ? { message: reason.message } : {}),
      ...(reason.messageKey ? { messageKey: reason.messageKey } : {}),
      ...(reason.messageVars ? { messageVars: reason.messageVars } : {}) })
    const timer = setTimeout(() => { this.retryTimer = null; void this.startEngine() }, this.retry.delayMs(attempt))
    ;(timer as { unref?: () => void }).unref?.()
    this.retryTimer = timer
  }

  private cancelRetry(): void {
    if (this.retryTimer === null) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private set(s: EngineStatus): void {
    this.status = s
    this.onChange(s)
  }
}
