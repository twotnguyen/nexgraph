/**
 * Token usage đường A (main gọi model bằng tài khoản app) theo job W9. Engine chỉ cộng `usage` cho
 * đường B (engine gọi trực tiếp), nên job result của đường A luôn 0; main giữ số đã dùng ở đây để
 * hộp thoại hỏi lại sau khi job xong.
 */
export type SemanticUsage = { input_tokens: number; output_tokens: number }

const MAX_JOBS = 20

export class SemanticUsageStore {
  private readonly byJob = new Map<string, SemanticUsage>()

  set(jobId: string, inputTokens: number, outputTokens: number): void {
    // Xoá rồi thêm lại để job vừa chạy xuống cuối hàng (bị đẩy ra sau cùng khi quá 20 job).
    this.byJob.delete(jobId)
    this.byJob.set(jobId, { input_tokens: inputTokens, output_tokens: outputTokens })
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
}
