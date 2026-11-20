import { useEffect, useState } from 'react'
import type { GraphReport } from '@shared/graph-types'
import { vi } from '../../strings'
import { kindStyle } from '../graph/kindStyle'
import { CanvasState } from '../common/CanvasState'

interface Props {
  projectId: string
  revision?: number
  onOpenNode: (id: string) => void
  onAsk: (question: string) => void
  onExportMarkdown: () => void
}

const num = (n: number) => n.toLocaleString('vi-VN')

export function ReportView({ projectId, revision = 0, onOpenNode, onAsk, onExportMarkdown }: Props) {
  const [report, setReport] = useState<GraphReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    setReport(null)
    setError(null)
    window.nexgraph.graph
      .report(projectId)
      .then((r) => alive && setReport(r))
      .catch((e: { message?: string }) => alive && setError(e?.message ?? String(e)))
    return () => {
      alive = false
    }
  }, [projectId, revision, retry])

  if (error) return <CanvasState kind="error" message={error} onRetry={() => setRetry((n) => n + 1)} />
  if (!report) return <CanvasState kind="loading" message={vi.report.loading} />

  return (
    <div className="report-view">
      <header className="report-head">
        <h2>{vi.report.title}</h2>
        <button type="button" onClick={onExportMarkdown}>{vi.report.exportMd}</button>
      </header>
      {report.truncated && <p className="warn">{vi.report.truncated}</p>}

      <section>
        <h3>{vi.report.godNodes}</h3>
        <p className="muted small">{vi.report.godNodesHint}</p>
        <table>
          <thead><tr><th>{vi.report.colName}</th><th>{vi.report.colKind}</th><th>{vi.report.colFile}</th><th>{vi.report.colDegree}</th></tr></thead>
          <tbody>
            {report.god_nodes.length === 0 && <tr><td colSpan={4} className="muted">Chưa có nút phù hợp.</td></tr>}
            {report.god_nodes.map(({ node, degree }) => (
              <tr key={node.id}>
                <td><button type="button" className="link" onClick={() => onOpenNode(node.id)}>{node.label}</button></td>
                <td><span className="kind" style={{ color: kindStyle(node.kind).color }}>{node.kind}</span></td>
                <td className="mono muted">{node.file ? `${node.file}${node.line_start ? `:${node.line_start}` : ''}` : ''}</td>
                <td>{num(degree)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>{vi.report.communities(report.communities.length)}</h3>
        <table>
          <thead><tr><th>{vi.report.colName}</th><th>{vi.report.colSize}</th><th>{vi.report.colCohesion}</th></tr></thead>
          <tbody>
            {report.communities.length === 0 && <tr><td colSpan={3} className="muted">Chưa có dữ liệu nhóm.</td></tr>}
            {report.communities.map((c) => (
              <tr key={c.id}><td>{c.label}</td><td>{num(c.size)}</td><td>{c.cohesion.toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      {report.surprising.length > 0 && (
        <section>
          <h3>{vi.report.surprising}</h3>
          <ul className="report-list">
            {report.surprising.map((s, i) => (
              <li key={i}>
                <b className="mono">{`${s.source} → ${s.target}`}</b>
                {s.relation && <span className="kind">{s.relation}</span>}
                {s.why && <span className="muted">{s.why}</span>}
                {s.source_files.length > 0 && <span className="mono muted small">{s.source_files.join(' · ')}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.questions.length > 0 && (
        <section>
          <h3>{vi.report.questions}</h3>
          <p className="muted small">{vi.report.questionsHint}</p>
          <ul className="report-list">
            {report.questions.map((q, i) => (
              <li key={`${i}:${q.question}`}>
                <button type="button" className="link" onClick={() => onAsk(q.question)}>{q.question}</button>
                {q.why && <span className="muted small">{q.why}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>{vi.report.cycles(report.cycles.total)}</h3>
        {report.cycles.total === 0 && <p className="muted">{vi.report.noCycles}</p>}
        <ul className="report-list">
          {report.cycles.cycles.map((c) => (
            <li key={c.files.join('|')}>
              <span className="mono">{c.files.join(' → ')}</span>
              {c.size > c.files.length && <span className="muted small">{vi.report.cycleMore(c.size - c.files.length)}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>{vi.report.freshness}</h3>
        {report.freshness.stale
          ? <p className="warn">{vi.report.stale(report.freshness.changed_files)}</p>
          : <p className="muted">{vi.report.freshOk}</p>}
        {report.freshness.index_commit && report.freshness.head_commit && (
          <p className="mono muted small">{vi.report.commits(report.freshness.index_commit.slice(0, 7), report.freshness.head_commit.slice(0, 7))}</p>
        )}
      </section>

      <section>
        <h3>{vi.report.gaps}</h3>
        {report.gaps.isolated.total === 0 && report.gaps.ambiguous_edges.total === 0 && <p className="muted">{vi.report.noGaps}</p>}
        {report.gaps.isolated.total > 0 && (
          <>
            <p>{vi.report.isolated(report.gaps.isolated.total)}</p>
            <ul className="report-list">
              {report.gaps.isolated.nodes.map((n) => (
                <li key={n.id}>
                  <button type="button" className="link" onClick={() => onOpenNode(n.id)}>{n.label}</button>
                  {n.file && <span className="mono muted small">{n.line_start ? `${n.file}:${n.line_start}` : n.file}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
        {report.gaps.ambiguous_edges.total > 0 && <p>{vi.report.ambiguousEdges(report.gaps.ambiguous_edges.total)}</p>}
      </section>

      {report.benchmark && (
        <section>
          <h3>{vi.report.benchmark}</h3>
          <p>{vi.report.benchmarkText(num(report.benchmark.corpus_tokens), num(report.benchmark.graph_tokens), num(Math.round(report.benchmark.reduction)))}</p>
        </section>
      )}
    </div>
  )
}
