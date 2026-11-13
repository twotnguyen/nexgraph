import { useEffect, useState } from 'react'
import type { TourStep } from '@shared/graph-types'
import { vi } from '../../strings'

interface Props {
  projectId: string
  projectName: string
  onOpenFlow: (flowId: number) => void
  onOpenNode: (nodeId: string) => void
  onOpenArch: (blockId: string) => void
}

const errMessage = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e))

export function TourPanel({ projectId, projectName, onOpenFlow, onOpenNode, onOpenArch }: Props) {
  const [steps, setSteps] = useState<TourStep[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let alive = true
    window.nexgraph.graph.tour(projectId).then((t) => {
      if (!alive) return
      setSteps(t.steps)
      if (t.steps.length) go(t.steps, 0)
    }).catch((e) => alive && setError(errMessage(e)))
    return () => { alive = false }
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // flow_id -> thẻ Luồng; block_id -> thẻ Kiến trúc; còn lại -> thẻ Graph ở nút của bước.
  function go(list: TourStep[], i: number): void {
    setIndex(i)
    const s = list[i]
    if (s.flow_id != null) onOpenFlow(s.flow_id)
    else if (s.block_id) onOpenArch(s.block_id)
    else if (s.node) onOpenNode(s.node.id)
  }

  if (error) return <p role="alert" className="error">{error}</p>
  if (!steps) return null
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
