import { useEffect, useState, type FormEvent } from 'react'
import type { MemoryKind, MemoryRecall } from '@shared/graph-types'
import { vi } from '../../strings'

const KINDS: MemoryKind[] = ['lesson', 'decision', 'incident', 'owner']
const message = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))

/** Mục "Ghi nhớ" của Inspector: bài học từ đánh giá, ghi nhớ neo vào nút và ô thêm ghi nhớ tay. */
export function NodeMemory({ projectId, nodeId }: { projectId: string; nodeId: string }) {
  const [data, setData] = useState<MemoryRecall | null>(null)
  const [kind, setKind] = useState<MemoryKind>('lesson')
  const [text, setText] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    window.nexgraph.memory.recall(projectId, { node: nodeId })
      .then((r) => alive && setData(r))
      .catch(() => alive && setData({ memories: [] }))
    return () => { alive = false }
  }, [projectId, nodeId, reload])
  useEffect(() => { setNote(null); setText('') }, [projectId, nodeId])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    setNote(null)
    try {
      const r = await window.nexgraph.memory.add(projectId, kind, text, [nodeId])
      if (!r.created) setNote(vi.memory.duplicate)
      setText('')
      setReload((n) => n + 1)
    } catch (err) {
      setNote(vi.memory.failed(message(err)))
    }
  }

  return (
    <section className="node-memory">
      <h4>{vi.memory.nodeTitle}</h4>
      {data?.lesson && <p className="small">{vi.memory.nodeLesson[data.lesson.status]}</p>}
      {data && data.memories.length === 0 && <p className="muted small">{vi.memory.nodeEmpty}</p>}
      {data && data.memories.length > 0 && (
        <ul>
          {data.memories.map((m) => (
            <li key={m.id}>
              <b>{vi.memory.kinds[m.kind]}</b>{m.outcome ? ` (${m.outcome === 'huu_ich' ? vi.memory.useful : m.outcome === 'ngo_cut' ? vi.memory.deadEnd : vi.memory.corrected})` : ''}: {m.text}
              {m.correction && <span className="muted"> → {m.correction}</span>}
              {m.missing_node_ids.length > 0 && <span className="muted small"> · {vi.memory.missingNodes(m.missing_node_ids.length)}</span>}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void add(e)}>
        <select aria-label={vi.memory.kindLabel} value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{vi.memory.kinds[k]}</option>)}
        </select>
        <textarea aria-label={vi.memory.textLabel} rows={2} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim()}>{vi.memory.add}</button>
      </form>
      {note && <p role="status" className="small">{note}</p>}
    </section>
  )
}
