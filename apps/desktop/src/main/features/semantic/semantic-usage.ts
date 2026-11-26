/**
 * Token usage đường A (main gọi model bằng tài khoản app) theo job W9. Engine chỉ cộng `usage` cho
 * đường B (engine gọi trực tiếp), nên job result của đường A luôn 0; main giữ số đã dùng ở đây để
 * hộp thoại hỏi lại sau khi job xong.
 */
export type SemanticUsage = { input_tokens: number; output_tokens: number }

const MAX_JOBS = 20

export class SemanticUsageStore {
  private readonly byJob = new Map<string, SemanticUsage>()
  private readonly waiters = new Map<string, Set<(usage: SemanticUsage | null) => void>>()

  set(jobId: string, inputTokens: number, outputTokens: number): void {
    // Xoá rồi thêm lại để job vừa chạy xuống cuối hàng (bị đẩy ra sau cùng khi quá 20 job).
    this.byJob.delete(jobId)
    const usage = { input_tokens: inputTokens, output_tokens: outputTokens }
    this.byJob.set(jobId, usage)
    for (const notify of this.waiters.get(jobId) ?? []) notify({ ...usage })
    this.waiters.delete(jobId)
    while (this.byJob.size > MAX_JOBS) {
      const oldest = this.byJob.keys().next().value
      if (oldest === undefined) break
      this.byJob.delete(oldest)
    }
  }

  get(jobId: string): SemanticUsage | null {
    const usage = this.byJob.get(jobId)
    return usage ? { ...usage } : null
  }

  /**
   * Chờ main ghi usage xong: engine có thể báo job `done` trước khi `.finally` của runSemanticJob kịp
   * gọi `set()`. Job đường B (engine tự cộng usage) không bao giờ có entry → hết hạn trả null.
   */
  wait(jobId: string, timeoutMs = 2_000): Promise<SemanticUsage | null> {
    const ready = this.byJob.get(jobId)
    if (ready) return Promise.resolve({ ...ready })
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const finish = (usage: SemanticUsage | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const waiting = this.waiters.get(jobId)
        waiting?.delete(finish)
        // Không để lại Set rỗng: map tăng theo số job hết hạn dù không còn ai chờ.
        if (waiting && waiting.size === 0) this.waiters.delete(jobId)
        resolve(usage)
      }
      timer = setTimeout(() => finish(null), timeoutMs)
      const set = this.waiters.get(jobId) ?? new Set<(usage: SemanticUsage | null) => void>()
      this.waiters.set(jobId, set)
      set.add(finish)
    })
  }
}
