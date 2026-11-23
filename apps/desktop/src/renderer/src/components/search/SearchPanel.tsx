import { useEffect, useRef, useState } from 'react'
import type { AskResult, GraphEdge, GraphNode, SearchHit } from '@shared/graph-types'
import { useDebounced } from '../../state/useDebounced'
import { vi, tr } from '../../strings'
import { kindStyle } from '../graph/kindStyle'
import { isVirtualSource } from '../graph/virtualSource'

interface Props {
  projectId: string
  revision?: number
  onOpen: (node: GraphNode) => void
  /** Khi có: bấm kết quả "Tìm symbol" mở tệp:dòng trong editor; graph vẫn mở được bằng nút phụ. */
  onOpenCode?: (file: string, line?: number, column?: number) => void
  /** Khi có: bật chế độ "Hỏi graph", bấm "Xem trên graph" vẽ vùng con trả về. */
  onShowSubgraph?: (g: { nodes: GraphNode[]; edges: GraphEdge[] }) => void
  onOpenFlow?: (flowId: number) => void
}

const DEBOUNCE_MS = 200
const LIMIT = 30

const errMessage = (err: unknown): string =>
  err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err)

function NodeButton({ node, onOpen, onOpenCode }: { node: GraphNode; onOpen: (n: GraphNode) => void; onOpenCode?: Props['onOpenCode'] }) {
  const source = node.file && (node.line_start ? `${node.file}:${node.line_start}` : node.file)
  const file = node.file
  // Cột 1 để con trỏ đặt đúng dòng của symbol, không chỉ cuộn tới đó.
  // Nguồn ảo rơi về chọn trên graph như trước (review-50 M1).
  const openCode = onOpenCode && file && !isVirtualSource(file)
    ? () => onOpenCode(file, node.line_start ?? undefined, 1) : null
  return (
    <div className="search-hit">
      <button type="button" className="entry" onClick={openCode ?? (() => onOpen(node))}>
        <b>{node.label}</b>
        <span className="kind" style={{ color: kindStyle(node.kind).color }}>{node.kind}</span>
        {source && <span className="mono muted" title={source}>{source}</span>}
      </button>
      {openCode && (
        <button type="button" className="link" onClick={() => onOpen(node)}>{vi.search.showOnGraph}</button>
      )}
    </div>
  )
}

type SymbolResponse = { projectId: string; query: string; revision: number; hits: SearchHit[] | null; error: string | null }

function SymbolSearch({ projectId, revision = 0, onOpen, onOpenCode }: Props) {
  const [text, setText] = useState('')
  const draft = text.trim()
  const query = useDebounced(draft, DEBOUNCE_MS)
  const [response, setResponse] = useState<SymbolResponse | null>(null)
  const [retry, setRetry] = useState(0)
  const shown = response?.query === draft && response.projectId === projectId && response.revision === revision ? response : null
  const hits = shown?.hits
  const error = shown?.error
  const loading = !!draft && !shown

  useEffect(() => {
    let alive = true
    setResponse(null)
    if (!query) {
      return
    }
    window.nexgraph.graph
      .search(projectId, query, { limit: LIMIT })
      .then((r) => alive && setResponse({ projectId, query, revision, hits: r, error: null }))
      .catch((err: unknown) => {
        if (alive) setResponse({ projectId, query, revision, hits: null, error: errMessage(err) })
      })
    return () => { alive = false }
  }, [projectId, query, retry, revision])

  return (
    <>
      <input
        type="search"
        aria-label={vi.search.label}
        placeholder={vi.search.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !hits || hits.length === 0) return
          const first = hits[0].node
          if (onOpenCode && first.file && !isVirtualSource(first.file)) onOpenCode(first.file, first.line_start ?? undefined, 1)
          else onOpen(first)
        }}
        autoFocus
      />
      {loading && <p role="status" className="muted small">{tr('Đang tìm ký hiệu…')}</p>}
      {error && <div className="panel-error"><p role="alert" className="error">{error}</p>
        <button type="button" onClick={() => setRetry((value) => value + 1)}>{tr('Thử lại')}</button></div>}
      {hits && hits.length === 0 && !error && <p className="muted">{vi.search.empty}</p>}
      {hits && hits.length > 0 && (
        <ul className="search-results">
          {hits.map(({ node }) => (
            <li key={node.id}><NodeButton node={node} onOpen={onOpen} onOpenCode={onOpenCode} /></li>
          ))}
        </ul>
      )}
    </>
  )
}

function AskGraph({ projectId, revision, onOpen, onShowSubgraph, onOpenFlow }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AskResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    setBusy(false)
    setResult(null)
    setError(null)
    return () => { requestId.current++ }
  }, [projectId, revision])

  const ask = async () => {
    const q = text.trim()
    if (!q || busy) return
    const next = ++requestId.current
    setBusy(true)
    setResult(null)
    setError(null)
    try {
      const answer = await window.nexgraph.graph.ask(projectId, q)
      if (next === requestId.current) setResult(answer)
    } catch (err) {
      if (next === requestId.current) setError(errMessage(err))
    } finally {
      if (next === requestId.current) setBusy(false)
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
      <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => void ask()}>{vi.search.modeAsk}</button>
      {busy && <p role="status" className="muted small">{vi.search.asking}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {result && (
        <div className="ask-result">
          {result.ambiguous && result.ambiguous.length > 0 && (
            <>
              <p>{vi.search.askAmbiguous(result.ambiguous.length)}</p>
              <ul className="search-results">
                {result.ambiguous.map((n) => (
                  <li key={n.id}><NodeButton node={n} onOpen={onOpen} /></li>
                ))}
              </ul>
            </>
          )}
          {/* Đang chờ chọn node trùng tên thì chưa có kết quả để đếm — đừng hiện "0 node, 0 cạnh" (A3 #9). */}
          {!(result.ambiguous && result.ambiguous.length > 0 && result.nodes.length === 0) && (
            <p>{vi.search.askNodes(result.nodes.length, result.edges.length)}</p>
          )}
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
