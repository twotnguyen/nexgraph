import { useEffect, useState } from 'react'
import type { GraphReport } from '@shared/graph-types'
import { vi } from '../../strings'
import { kindStyle } from '../graph/kindStyle'

interface Props {
  projectId: string
  onOpenNode: (id: string) => void
  onAsk: (question: string) => void
  onExportMarkdown: () => void
}

const num = (n: number) => n.toLocaleString('vi-VN')

export function ReportView({ projectId, onOpenNode, onAsk, onExportMarkdown }: Props) {
  const [report, setReport] = useState<GraphReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setReport(null)
    setError(null)
    window.nexgraph.graph
      .report(projectId)
      .then((r) => alive && setReport(r))
      .catch((e: { message?: string }) => alive && setError(e.message ?? String(e)))
    return () => {
      alive = false
    }
  }, [projectId])

  if (error) return <div className="report-view"><p role="alert" className="error">{error}</p></div>
  if (!report) return <div className="report-view"><p className="muted">{vi.report.loading}</p></div>

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

      {report.benchmark && (
        <section>
          <h3>{vi.report.benchmark}</h3>
          <p>{vi.report.benchmarkText(num(report.benchmark.corpus_tokens), num(report.benchmark.graph_tokens), num(Math.round(report.benchmark.reduction)))}</p>
        </section>
      )}
    </div>
  )
}
