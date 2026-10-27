import { useEffect, useRef, useState } from 'react'
import type { GraphNode, SearchHit } from '@shared/graph-types'
import { useDebounced } from '../../state/useDebounced'
import { vi } from '../../strings'
import { kindStyle } from '../graph/kindStyle'

interface Props {
  projectId: string
  onOpen: (node: GraphNode) => void
}

const DEBOUNCE_MS = 200
const LIMIT = 30

export function SearchPanel({ projectId, onOpen }: Props) {
  const [text, setText] = useState('')
  const query = useDebounced(text.trim(), DEBOUNCE_MS)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    const seq = ++latest.current // mỗi lần gõ có một số thứ tự; trả lời của lần cũ đến muộn bị bỏ
    setError(null)
    if (!query) {
      setHits(null)
      return
    }
    window.nexgraph.graph
      .search(projectId, query, { limit: LIMIT })
      .then((r) => seq === latest.current && setHits(r))
      .catch((err: { message?: string }) => {
        if (seq !== latest.current) return
        setHits(null)
        setError(err.message ?? String(err))
      })
  }, [projectId, query])

  return (
    <div className="search-panel">
      <input
        type="search"
        aria-label={vi.search.label}
        placeholder={vi.search.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits && hits.length > 0) onOpen(hits[0].node)
        }}
        autoFocus
      />
      {error && <p role="alert" className="error">{error}</p>}
      {hits && hits.length === 0 && !error && <p className="muted">{vi.search.empty}</p>}
      {hits && hits.length > 0 && (
        <ul className="search-results">
          {hits.map(({ node }) => (
            <li key={node.id}>
              <button type="button" onClick={() => onOpen(node)}>
                <b>{node.label}</b>
                <span className="kind" style={{ color: kindStyle(node.kind).color }}>{node.kind}</span>
                {node.file && <span className="mono muted">{node.line_start ? `${node.file}:${node.line_start}` : node.file}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
