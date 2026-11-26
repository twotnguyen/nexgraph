import { useCallback, useEffect, useRef, useState } from 'react'
import type { Changes } from '@nexgraph/contracts/graph-types'
import { tr } from '../../i18n/strings'
import { errorMsg } from '../../shared/lib/errorText'
import { msg, type Message } from '../../shared/lib/messages'

const RELOAD_MS = 300

/**
 * Báo cáo thay đổi của project. Nạp khi gắn kết (nhờ engine làm mới đồ thị trước), rồi nạp lại khi engine báo
 * một bản đồ thị được công bố hoặc cập nhật. Một loạt sự kiện chỉ gây một lần nạp.
 */
export function useChanges(projectId: string): {
  changes: Changes | null
  loading: boolean
  error: Message | null
  reload: () => void
} {
  const [changes, setChanges] = useState<Changes | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Message | null>(null)
  const latest = useRef(0)

  const load = useCallback(
    (opts?: { refresh?: boolean }) => {
      const mine = ++latest.current
      setLoading(true)
      window.nexgraph.graph
        .changes(projectId, opts)
        .then((c) => {
          if (mine !== latest.current) return // câu trả lời cũ đến muộn
          setChanges(c)
          setError(null)
        })
        .catch((e: { message?: string }) => {
          if (mine === latest.current) setError(typeof e?.message === 'string' && e.message ? errorMsg(e.message) : msg('Không đọc được thay đổi'))
        })
        .finally(() => {
          if (mine === latest.current) setLoading(false)
        })
    },
    [projectId]
  )

  useEffect(() => {
    setChanges(null)
    load()
    let timer: ReturnType<typeof setTimeout> | null = null
    const off = window.nexgraph.index.onEvent((e) => {
      if ((e.type !== 'changes_updated' && e.type !== 'graph_updated') || e.project_id !== projectId || timer) return
      timer = setTimeout(() => {
        timer = null
        load({ refresh: false })
      }, RELOAD_MS)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
      latest.current++
    }
  }, [projectId, load])

  return { changes, loading, error, reload: () => load() }
}
