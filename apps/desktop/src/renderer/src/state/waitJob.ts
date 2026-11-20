import type { Job } from '@shared/graph-types'
import { vi } from '../strings'

/** Đợi job tổng quát (clone, ingest…) kết thúc bằng cách hỏi `index.status`; lỗi hoặc huỷ thì ném `{ code, message }`. */
export async function waitJob(jobId: string, onProgress?: (job: Job) => void, intervalMs = 1_000): Promise<Job> {
  for (;;) {
    const job = await window.nexgraph.index.status(jobId)
    onProgress?.(job)
    if (job.state === 'done') return job
    if (job.state === 'error' || job.state === 'cancelled') {
      throw { code: job.state, message: job.message ?? (job.state === 'cancelled' ? vi.sources.jobCancelled : vi.sources.jobFailed) }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}
