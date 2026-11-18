import { useEffect, useRef, useState } from 'react'
import type { TourStep } from '@shared/graph-types'
import { vi } from '../../strings'

interface Props {
  projectId: string
  revision?: number
  projectName: string
  onOpenFlow: (flowId: number) => void
  onOpenNode: (nodeId: string) => void
  onOpenArch: (blockId: string) => void
}

const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

export function TourPanel({ projectId, revision = 0, projectName, onOpenFlow, onOpenNode, onOpenArch }: Props) {
  const [steps, setSteps] = useState<TourStep[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [retry, setRetry] = useState(0)
  const started = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    setSteps(null)
    setError(null)
    window.nexgraph.graph.tour(projectId).then((t) => {
      if (!alive) return
      setSteps(t.steps)
      if (t.steps.length && started.current !== projectId) {
        started.current = projectId
        go(t.steps, 0)
      } else setIndex((current) => Math.min(current, Math.max(0, t.steps.length - 1)))
    }).catch((e) => alive && setError(errMessage(e)))
    return () => { alive = false }
  }, [projectId, revision, retry]) // eslint-disable-line react-hooks/exhaustive-deps

  // flow_id -> thẻ Luồng; block_id -> thẻ Kiến trúc; còn lại -> thẻ Graph ở nút của bước.
  function go(list: TourStep[], i: number): void {
    const s = list[i]
    if (!s) return
    setIndex(i)
    if (s.flow_id != null) onOpenFlow(s.flow_id)
    else if (s.block_id) onOpenArch(s.block_id)
    else if (s.node) onOpenNode(s.node.id)
  }

  if (error) return <div className="panel-error"><p role="alert" className="error">{error}</p>
    <button type="button" onClick={() => setRetry((n) => n + 1)}>Thử lại</button></div>
  if (!steps) return <p role="status" className="muted">Đang chuẩn bị chuyến tham quan…</p>
  if (steps.length === 0) return <p className="muted">{vi.tour.empty}</p>
  const last = index === steps.length - 1
  return (
    <div className="tour-panel">
      <h3>{vi.tour.title(projectName, steps.length)}</h3>
      <ol className="tour">
        {steps.map((s, i) => (
          <li key={s.order} className={`st${i === index ? ' cur' : ''}`} aria-current={i === index ? 'step' : undefined}>
            <button type="button" className="tour-step" onClick={() => go(steps, i)}>
              <span className="n">{s.order}</span>
              <span>
                <b>{s.title}</b>
                <p>{s.body}</p>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" disabled={index === 0} onClick={() => go(steps, index - 1)}>{vi.tour.prev}</button>
        <button type="button" className="primary" onClick={() => go(steps, last ? 0 : index + 1)}>{last ? vi.tour.restart : vi.tour.next}</button>
      </div>
    </div>
  )
}
