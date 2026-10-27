import { useEffect, useRef, useState } from 'react'
import type { Job } from '@shared/graph-types'

/** Khởi động lập chỉ mục cho project rồi theo dõi sự kiện của riêng project đó. */
export function useIndexJob(projectId: string, subdir?: string | null) {
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)
  const jobId = useRef<string | null>(null)

  useEffect(() => {
    setJob(null)
    setError(null)
    const off = window.nexgraph.index.onEvent((e) => {
      if (e.type === 'job_progress' && e.project_id === projectId) setJob(e)
    })
    const started = subdir ? window.nexgraph.index.start(projectId, { subdir }) : window.nexgraph.index.start(projectId)
    started
      .then((r) => (jobId.current = r.jobId))
      .catch((err: Error & { code?: string }) => {
        if (err.code !== 'index_running') setError(err.message) // đã có job chạy (ví dụ mở lại màn hình) thì chỉ theo dõi
      })
    return off
  }, [projectId, subdir])

  const cancel = () => {
    const id = job?.job_id ?? jobId.current
    if (id) void window.nexgraph.index.cancel(id)
  }
  return { job, error, cancel }
}
