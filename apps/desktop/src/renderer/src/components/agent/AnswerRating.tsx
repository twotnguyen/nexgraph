import { useState } from 'react'
import type { Citation, RatingOutcome } from '@shared/graph-types'
import { vi } from '../../strings'

/** Ba nút đánh giá dưới một câu trả lời của agent; lưu vào bộ nhớ làm việc của dự án qua engine. */
export function AnswerRating({ projectId, question, answer, citations }: {
  projectId: string
  question: string
  answer: string
  citations: Citation[]
}) {
  const [state, setState] = useState<'idle' | 'correcting' | 'saving' | 'saved'>('idle')
  const [correction, setCorrection] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = async (outcome: RatingOutcome) => {
    setState('saving')
    setError(null)
    try {
      await window.nexgraph.memory.rate(projectId, {
        question, answer, outcome, ...(outcome === 'da_sua' ? { correction: correction.trim() } : {}),
        citations: citations.filter((c) => c.valid).map((c) => ({ file: c.file, line: c.start }))
      })
      setState('saved')
    } catch (e) {
      setError(vi.memory.failed(e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)))
      setState(outcome === 'da_sua' ? 'correcting' : 'idle')
    }
  }

  if (state === 'saved') return <span className="answer-rating muted" role="status">{vi.memory.saved}</span>
  const busy = state === 'saving'
  return (
    <span className="answer-rating" role="group" aria-label={vi.memory.rateGroup}>
      <button type="button" className="link" disabled={busy} onClick={() => void save('huu_ich')}>{vi.memory.useful}</button>
      <button type="button" className="link" disabled={busy} onClick={() => void save('ngo_cut')}>{vi.memory.deadEnd}</button>
      <button type="button" className="link" disabled={busy} aria-expanded={state === 'correcting'}
        onClick={() => setState(state === 'correcting' ? 'idle' : 'correcting')}>{vi.memory.corrected}</button>
      {state === 'correcting' && (
        <span className="answer-correction">
          <textarea aria-label={vi.memory.correctionLabel} placeholder={vi.memory.correctionLabel} value={correction}
            onChange={(e) => setCorrection(e.target.value)} rows={2} />
          <button type="button" disabled={!correction.trim()} onClick={() => void save('da_sua')}>{vi.memory.save}</button>
        </span>
      )}
      {error && <span role="alert" className="error">{error}</span>}
    </span>
  )
}
