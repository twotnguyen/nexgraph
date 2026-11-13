import { useEffect, useRef, useState } from 'react'
import type { AskResult, GraphEdge, GraphNode, SearchHit } from '@shared/graph-types'
import { useDebounced } from '../../state/useDebounced'
import { vi } from '../../strings'
import { kindStyle } from '../graph/kindStyle'

interface Props {
  projectId: string
  onOpen: (node: GraphNode) => void
  /** Khi có: bật chế độ "Hỏi graph", bấm "Xem trên graph" vẽ vùng con trả về. */
  onShowSubgraph?: (g: { nodes: GraphNode[]; edges: GraphEdge[] }) => void
  onOpenFlow?: (flowId: number) => void
}

const DEBOUNCE_MS = 200
const LIMIT = 30

const errMessage = (err: unknown): string =>
  err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err)

function NodeButton({ node, onOpen }: { node: GraphNode; onOpen: (n: GraphNode) => void }) {
  return (
    <button type="button" onClick={() => onOpen(node)}>
      <b>{node.label}</b>
      <span className="kind" style={{ color: kindStyle(node.kind).color }}>{node.kind}</span>
      {node.file && <span className="mono muted">{node.line_start ? `${node.file}:${node.line_start}` : node.file}</span>}
    </button>
  )
}

function SymbolSearch({ projectId, onOpen }: Props) {
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
      .catch((err: unknown) => {
        if (seq !== latest.current) return
        setHits(null)
        setError(errMessage(err))
      })
  }, [projectId, query])

  return (
    <>
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
            <li key={node.id}><NodeButton node={node} onOpen={onOpen} /></li>
          ))}
        </ul>
      )}
    </>
  )
}

function AskGraph({ projectId, onOpen, onShowSubgraph, onOpenFlow }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AskResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ask = async () => {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    setError(null)
    try {
      setResult(await window.nexgraph.graph.ask(projectId, q))
    } catch (err) {
      setResult(null)
      setError(errMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <input
        type="search"
        aria-label={vi.search.askLabel}
        placeholder={vi.search.askPlaceholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void ask()}
        autoFocus
      />
      <p className="muted small">{busy ? vi.search.asking : vi.search.askHint}</p>
      {error && <p role="alert" className="error">{error}</p>}
      {result && (
        <div className="ask-result">
          <p>{vi.search.askNodes(result.nodes.length, result.edges.length)}</p>
          {result.truncated && <p className="muted small">{vi.search.askTruncated}</p>}
          {onShowSubgraph && result.nodes.length > 0 && (
            <button type="button" className="primary" onClick={() => onShowSubgraph({ nodes: result.nodes, edges: result.edges })}>
              {vi.search.showOnGraph}
            </button>
          )}
          <h4>{vi.search.seeds}</h4>
          <ul className="search-results">
            {result.seeds.map((n) => (
              <li key={n.id}><NodeButton node={n} onOpen={onOpen} /></li>
            ))}
          </ul>
          {result.flows && result.flows.length > 0 && (
            <>
              <h4>{vi.flows.related}</h4>
              <ul className="search-results">
                {result.flows.map((f) => (
                  <li key={f.id}>
                    <button type="button" onClick={() => onOpenFlow?.(f.id)}>
                      <b>{f.name}</b>
                      <small className="kind">{f.kind}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  )
}

export function SearchPanel(props: Props) {
  const [mode, setMode] = useState<'symbol' | 'ask'>('symbol')
  return (
    <div className="search-panel">
      {props.onShowSubgraph && (
        <div className="segmented" role="radiogroup" aria-label={vi.search.label}>
          {(['symbol', 'ask'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'active' : undefined} onClick={() => setMode(m)}>
              {m === 'symbol' ? vi.search.modeSymbol : vi.search.modeAsk}
            </button>
          ))}
        </div>
      )}
      {mode === 'symbol' ? <SymbolSearch {...props} /> : <AskGraph {...props} />}
    </div>
  )
}
