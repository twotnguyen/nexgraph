import type { WatchFailure } from '../../shared/api'

/** Cùng một lỗi refresh nền lặp lại trong cửa sổ này chỉ báo một lần để không spam trung tâm thông báo. */
export const WATCH_ERROR_REPEAT_MS = 60_000

/**
 * Chống spam thông báo lỗi refresh nền: gộp cùng thông điệp trong `WATCH_ERROR_REPEAT_MS` cho mỗi dự án;
 * flush thành công gọi `clear` để lần lỗi sau vẫn hiện lại.
 */
export class WatchErrorNotifier {
  private readonly last = new Map<string, { message: string; at: number }>()

  constructor(private readonly send: (failure: WatchFailure) => void, private readonly now: () => number = Date.now) {}

  /** Trả `true` khi đã gửi thông báo (không bị gộp). */
  report(projectId: string, error: unknown): boolean {
    const message = cleanMessage(error)
    const at = this.now()
    const previous = this.last.get(projectId)
    if (previous && previous.message === message && at - previous.at < WATCH_ERROR_REPEAT_MS) return false
    this.last.set(projectId, { message, at })
    this.send({ projectId, message })
    return true
  }

  clear(projectId: string): void {
    this.last.delete(projectId)
  }
}

const cleanMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.trim().slice(0, 500) || 'lỗi không rõ'
}
