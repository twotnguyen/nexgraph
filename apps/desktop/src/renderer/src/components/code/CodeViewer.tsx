import { useCallback, useEffect, useRef, useState } from 'react'
import type { CodeSlice } from '@shared/graph-types'
import { vi } from '../../strings'

const CONTEXT = 200
const ENGINE_MAX_LINES = 2000

interface Props {
  projectId: string
  file: string
  line: number
  lineEnd?: number
  onClose: () => void
}

function explain(e: { code?: string; message?: string }): string {
  if (e?.code === 'file_not_found') return vi.code.missing
  if (e?.code === 'outside_project') return vi.code.outside
  return e?.message ?? vi.code.failed
}

/** Trình xem mã chỉ đọc: số dòng, tô khoảng dòng, cuộn tới dòng đích. Chưa tô cú pháp (kế hoạch con 6). */
export function CodeViewer({ projectId, file, line, lineEnd, onClose }: Props) {
  const [slice, setSlice] = useState<CodeSlice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const target = useRef<HTMLDivElement | null>(null)
  const seq = useRef(0)

  const load = useCallback(() => {
    const mine = ++seq.current
    setError(null)
    window.nexgraph.graph
      .code(projectId, file, Math.max(1, line - CONTEXT))
      .then((s) => mine === seq.current && setSlice(s))
      .catch((e) => {
        if (mine !== seq.current) return
        setSlice(null)
        setError(explain(e))
      })
  }, [projectId, file, line])

  useEffect(() => {
    load()
    return () => void seq.current++
  }, [load])

  useEffect(() => {
    target.current?.scrollIntoView?.({ block: 'center' })
  }, [slice, line])

  const refresh = async (): Promise<void> => {
    try {
      await window.nexgraph.index.refresh(projectId)
    } catch {
      /* vẫn nạp lại: có thể refresh bị bỏ qua vì đang lập chỉ mục */
    }
    load()
  }

  const last = lineEnd ?? line
  const lines = slice ? slice.text.split('\n') : []
  return (
    <div className="code-viewer">
      <header className="code-head">
        <span className="mono">{file}</span>
        <button type="button" onClick={onClose}>{vi.code.close}</button>
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {slice?.stale && (
        <p className="stale-banner">
          {vi.code.stale} <button type="button" onClick={() => void refresh()}>{vi.changes.reload}</button>
        </p>
      )}
      {slice && slice.end - slice.start + 1 >= ENGINE_MAX_LINES && <p className="muted">{vi.code.capped}</p>}
      {slice && (
        <div className="code-body">
          {lines.map((text, i) => {
            const n = slice.start + i
            const hit = n >= line && n <= last
            return (
              <div key={n} data-line={n} data-highlight={hit ? 'true' : undefined} className={`code-line${hit ? ' hit' : ''}`}
                   ref={n === line ? target : undefined}>
                <span className="ln">{n}</span>
                <span className="src">{text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
