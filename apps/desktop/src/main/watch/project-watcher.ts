import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { shouldIgnore } from './ignore'

export interface WatcherOptions {
  root: string
  /** Gọi sau khi các sự kiện đã được gộp; thường là `EngineApi.refresh`. */
  onFlush: () => Promise<void | 'retry'>
  onError?: (e: Error) => void
  debounceMs?: number
  maxWaitMs?: number
  watch?: typeof fsWatch
}

/**
 * Chỉ báo hiệu "có gì đó đổi": không mang theo danh sách tệp, vì engine tự đối chiếu cả cây bằng stat.
 * Gộp sự kiện (debounce có giới hạn chờ tối đa) và không bao giờ chạy hai lần flush chồng nhau.
 */
export class ProjectWatcher {
  private fsw: FSWatcher | null = null
  private debounce: NodeJS.Timeout | null = null
  private maxWait: NodeJS.Timeout | null = null
  private running = false
  private again = false
  private stopped = false
  private readonly debounceMs: number
  private readonly maxWaitMs: number

  constructor(private readonly o: WatcherOptions) {
    this.debounceMs = o.debounceMs ?? 500
    this.maxWaitMs = o.maxWaitMs ?? 3000
  }

  start(): void {
    this.stopped = false
    this.fsw = (this.o.watch ?? fsWatch)(this.o.root, { recursive: true }, (_event, name) => {
      if (name !== null && name !== undefined && shouldIgnore(String(name))) return
      this.schedule()
    })
    this.fsw.on('error', (e) => this.o.onError?.(e instanceof Error ? e : new Error(String(e))))
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.fsw?.close()
    this.fsw = null
  }

  private clearTimers(): void {
    if (this.debounce) clearTimeout(this.debounce)
    if (this.maxWait) clearTimeout(this.maxWait)
    this.debounce = this.maxWait = null
  }

  private schedule(): void {
    if (this.stopped) return
    if (this.running) {
      this.again = true
      return
    }
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.flush(), this.debounceMs)
    this.maxWait ??= setTimeout(() => void this.flush(), this.maxWaitMs)
  }

  private async flush(): Promise<void> {
    this.clearTimers()
    if (this.stopped || this.running) return
    this.running = true
    try {
      if (await this.o.onFlush() === 'retry') this.again = true
    } catch (e) {
      this.o.onError?.(e instanceof Error ? e : new Error(String(e)))
    } finally {
      this.running = false
      if (this.again) {
        this.again = false
        this.schedule()
      }
    }
  }
}
