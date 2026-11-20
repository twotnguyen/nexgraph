import { useEffect, useState } from 'react'
import type { LessonEntry, Lessons } from '@shared/graph-types'
import { vi } from '../../strings'

/** Mục "Bài học" của tab Báo cáo: tổng hợp tất định các lần đánh giá câu trả lời. */
export function LessonsSection({ projectId, revision = 0, onOpenNode }: { projectId: string; revision?: number; onOpenNode: (id: string) => void }) {
  const [data, setData] = useState<Lessons | null>(null)
  useEffect(() => {
    let alive = true
    window.nexgraph.memory.lessons(projectId).then((r) => alive && setData(r)).catch(() => alive && setData(null))
    return () => { alive = false }
  }, [projectId, revision])
  if (!data) return null

  const nodeList = (title: string, items: LessonEntry[], extra: (e: LessonEntry) => string) => items.length > 0 && (
    <>
      <h4>{title}</h4>
      <ul className="report-list">
        {items.map((e) => (
          <li key={e.node}>
            <button type="button" className="link" onClick={() => onOpenNode(e.node)}>{data.labels[e.node] ?? e.node}</button>
            <span className="muted small">{extra(e)}</span>
          </li>
        ))}
      </ul>
    </>
  )
  return (
    <section>
      <h3>{vi.memory.lessonsTitle}</h3>
      <p className="muted small">{vi.memory.lessonsHint(data.min_corroboration)}</p>
      {data.total === 0 && <p className="muted">{vi.memory.lessonsEmpty}</p>}
      {nodeList(vi.memory.preferred, data.preferred, (e) => vi.memory.times(e.n ?? 0))}
      {nodeList(vi.memory.tentative, data.tentative, (e) => vi.memory.times(e.n ?? 0))}
      {nodeList(vi.memory.contested, data.contested, (e) => vi.memory.verdict(e.verdict ?? 'even'))}
      {data.dead_ends.length > 0 && (
        <>
          <h4>{vi.memory.deadEnds}</h4>
          <ul className="report-list">{data.dead_ends.map((d) => <li key={d.question}>{d.question}</li>)}</ul>
        </>
      )}
      {data.corrections.length > 0 && (
        <>
          <h4>{vi.memory.corrections}</h4>
          <ul className="report-list">
            {data.corrections.map((c) => <li key={c.question}>{c.question}<span className="muted small">{c.correction}</span></li>)}
          </ul>
        </>
      )}
    </section>
  )
}
