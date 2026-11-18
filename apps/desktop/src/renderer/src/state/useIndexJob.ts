import { useEffect, useRef, useState } from 'react'
import type { IndexOptions, Job, JobState } from '@shared/graph-types'

const POLL_INTERVAL_MS = 1_000
const REQUEST_TIMEOUT_MS = 5_000
const START_TIMEOUT_MS = 15_000
const MAX_STATUS_FAILURES = 3

const order: Record<JobState, number> = { queued: 0, structure: 1, resolve: 2, done: 3, error: 3, cancelled: 3 }
const terminal = (job?: Job): boolean => !!job && order[job.state] === 3

function canApply(previous: Job | undefined, next: Job): boolean {
  if (!previous) return true
  if (terminal(previous)) return false
  if (next.state === previous.state) {
    return next.files_done > previous.files_done || (next.files_done === previous.files_done && next.files_total >= previous.files_total)
  }
  return order[next.state] > order[previous.state]
}

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)
}

function withTimeout<T>(request: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    request.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/** Nhận tiến độ qua SSE và kiểm tra trạng thái theo job ID khi luồng sự kiện bị gián đoạn. */
export function useIndexJob(projectId: string, subdir?: string | null, options?: IndexOptions) {
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startRequest = useRef<{ key: string; result: Promise<{ jobId: string }> } | null>(null)
  const cancelCurrent = useRef<(() => void) | null>(null)
  const opts: IndexOptions = {
    ...(subdir ? { subdir } : {}), ...(options?.exclude?.length ? { exclude: options.exclude } : {}),
    ...(options?.includeDocs !== undefined ? { includeDocs: options.includeDocs } : {}),
    ...(options?.includeMedia !== undefined ? { includeMedia: options.includeMedia } : {})
  }
  const key = JSON.stringify([projectId, opts])

  useEffect(() => {
    setJob(null)
    setError(null)
    const api = window.nexgraph.index
    const pendingEvents = new Map<string, Job>()
    let alive = true
    let jobId: string | undefined
    let current: Job | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let polling = false
    let failures = 0

    const publish = (next: Job): boolean => {
      if (!alive || !canApply(current, next)) return false
      current = next
      setJob(next)
      setError(null)
      if (terminal(next)) clearTimeout(timer)
      return true
    }

    const poll = async (): Promise<void> => {
      if (!alive || !jobId || terminal(current) || polling) return
      polling = true
      try {
        const next = await withTimeout(api.status(jobId), REQUEST_TIMEOUT_MS, 'Engine không trả trạng thái lập chỉ mục kịp thời')
        if (!alive) return
        if (next.job_id !== jobId || next.project_id !== projectId) throw new Error('Engine trả trạng thái công việc khác')
        publish(next)
        failures = 0
      } catch (err) {
        if (!alive || terminal(current)) return
        failures += 1
        if (failures >= MAX_STATUS_FAILURES || (err as { code?: string })?.code === 'unknown_job') {
          setJob(null)
          setError(`Không đọc được tiến độ lập chỉ mục. ${errorMessage(err)}. Hãy quay lại và mở dự án.`)
          return
        }
      } finally {
        polling = false
      }
      if (alive && !terminal(current)) {
        timer = setTimeout(() => {
          timer = undefined
          void poll()
        }, POLL_INTERVAL_MS)
      }
    }

    const off = api.onEvent((event) => {
      if (!alive || event.type !== 'job_progress' || event.project_id !== projectId) return
      if (!jobId) {
        if (canApply(pendingEvents.get(event.job_id), event)) pendingEvents.set(event.job_id, event)
      } else if (event.job_id === jobId && publish(event)) {
        failures = 0
        if (!timer && !polling && !terminal(current)) void poll()
      }
    })

    // StrictMode đăng ký lại effect, nhưng một yêu cầu lập chỉ mục chỉ cần gửi một lần.
    if (startRequest.current?.key !== key) {
      startRequest.current = {
        key,
        result: withTimeout(Object.keys(opts).length ? api.start(projectId, opts) : api.start(projectId),
          START_TIMEOUT_MS, 'Engine không phản hồi yêu cầu lập chỉ mục. Hãy quay lại và mở dự án.')
      }
    }
    void startRequest.current.result.then(({ jobId: id }) => {
      if (!alive) return
      jobId = id
      const pending = pendingEvents.get(id)
      pendingEvents.clear()
      if (pending) publish(pending)
      void poll()
    }).catch((err) => {
      if (alive) setError(errorMessage(err))
    })

    cancelCurrent.current = () => {
      if (!jobId || terminal(current)) return
      void withTimeout(api.cancel(jobId), REQUEST_TIMEOUT_MS, 'Engine không phản hồi yêu cầu hủy').catch((err) => {
        if (alive && !terminal(current)) setError(errorMessage(err))
      })
    }
    return () => {
      alive = false
      cancelCurrent.current = null
      clearTimeout(timer)
      off()
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return { job, error, cancel: () => cancelCurrent.current?.() }
}
