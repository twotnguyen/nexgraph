import { useEffect, useState } from 'react'
import { SemanticDialog } from '../overview/SemanticDialog'
import type { GraphNode, PrDetail, PrList } from '@shared/graph-types'
import { vi } from '../../strings'
import { msg, msgText, type Message } from '../../state/messages'
import { errorMsg } from '../../state/errorText'
import { CanvasState } from '../common/CanvasState'

type Props = { projectId: string; onOpenNode: (id: string) => void }

const loc = (n: GraphNode) => (n.file ? (n.line_start ? `${n.file}:${n.line_start}` : n.file) : '')

function NodeItems({ nodes, onOpenNode }: { nodes: GraphNode[]; onOpenNode: (id: string) => void }) {
  return (
    <ul className="report-list">
      {nodes.map((n) => (
        <li key={n.id}>
          <button type="button" className="link" onClick={() => onOpenNode(n.id)}>{n.label}</button>
          <span className="mono muted small">{loc(n)}</span>
        </li>
      ))}
    </ul>
  )
}

function Review({ d, onOpenNode }: { d: PrDetail; onOpenNode: (id: string) => void }) {
  const [copied, setCopied] = useState<Message | null>(null)
  const sel = d.test_selection
  const copy = () => void navigator.clipboard.writeText(d.comment).then(() => setCopied(msg('Đã sao chép'))).catch(() => setCopied(msg('Không truy cập được clipboard')))
  return (
    <section aria-label={vi.prs.review(d.pr.number)}>
      <header className="report-head">
        <h3>{vi.prs.review(d.pr.number)}</h3>
        <button type="button" onClick={copy}>{vi.prs.copy}</button>
        {copied && <span role="status" className="muted small">{msgText(copied)}</span>}
      </header>
      <p><b>{d.pr.title}</b> <span className="muted small">{vi.prs.meta(d.pr.author, d.pr.branch, d.pr.base)}</span></p>
      <p className="muted small">{vi.prs.notPosted}</p>
      {d.truncated && <p className="warn">{vi.prs.truncatedDetail}</p>}

      <h4>{vi.prs.changedFiles(d.changed_files.length)}</h4>
      <ul className="report-list">
        {d.changed_files.map((f) => <li key={f.path} className="mono small">{`${f.status} ${f.old_path ? `${f.old_path} → ` : ''}${f.path}`}</li>)}
      </ul>

      <h4>{vi.prs.impacted(d.impacted.length)}</h4>
      {d.impacted.length === 0 && <p className="muted">{vi.prs.noImpact}</p>}
      <ul className="report-list">
        {d.impacted.slice(0, 30).map((i) => (
          <li key={i.node.id}>
            <button type="button" className="link" onClick={() => onOpenNode(i.node.id)}>{i.node.label}</button>
            <span className="mono muted small">{`${loc(i.node)} · ${i.score.toFixed(2)} · ${i.hops}`}</span>
          </li>
        ))}
      </ul>

      {d.test_gaps.length > 0 && <><h4>{vi.prs.testGaps}</h4><NodeItems nodes={d.test_gaps} onOpenNode={onOpenNode} /></>}
      {d.stale_docs.length > 0 && <>
        <h4>{vi.prs.staleDocs}</h4>
        <ul className="report-list">
          {d.stale_docs.map((s) => (
            <li key={s.node.id}>
              <button type="button" className="link" onClick={() => onOpenNode(s.node.id)}>{s.node.label}</button>
              <span className="mono muted small">{loc(s.node)}</span>
              <span className="muted small">{vi.prs.staleDoc(s.symbols.join(', '))}</span>
            </li>
          ))}
        </ul>
      </>}
      {d.unreferenced.length > 0 && <>
        <h4>{vi.prs.unreferenced}</h4>
        <p className="muted small">{vi.prs.unreferencedHint}</p>
        <NodeItems nodes={d.unreferenced.map((u) => u.node)} onOpenNode={onOpenNode} />
      </>}

      <h4>{vi.prs.tests}</h4>
      {sel.run_all && <p className="warn">{vi.prs.runAll} {sel.reasons.join('; ')}</p>}
      {sel.commands.map((c) => <pre key={c} className="mono small">{c}</pre>)}
      {!sel.run_all && sel.commands.length === 0 && <p className="muted">{vi.prs.noTests}</p>}
      {d.cross_repo != null && <><h4>{vi.prs.crossRepo}</h4><pre className="mono small">{JSON.stringify(d.cross_repo, null, 2)}</pre></>}
    </section>
  )
}

export function PrsView({ projectId, onOpenNode }: Props) {
  const [list, setList] = useState<PrList | null>(null)
  const [error, setError] = useState<Message | null>(null)
  const [retry, setRetry] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [detail, setDetail] = useState<PrDetail | null>(null)
  const [detailError, setDetailError] = useState<Message | null>(null)
  const [triage, setTriage] = useState(false)

  useEffect(() => {
    let alive = true
    setList(null)
    setError(null)
    window.nexgraph.prs.list(projectId).then((r) => alive && setList(r)).catch((e) => alive && setError(errorMsg(e)))
    return () => { alive = false }
  }, [projectId, retry])

  useEffect(() => {
    if (picked == null) return
    let alive = true
    setDetail(null)
    setDetailError(null)
    window.nexgraph.prs.detail(projectId, picked).then((r) => alive && setDetail(r)).catch((e) => alive && setDetailError(errorMsg(e)))
    return () => { alive = false }
  }, [projectId, picked])

  if (error) return <CanvasState kind="error" message={msgText(error)} onRetry={() => setRetry((n) => n + 1)} />
  if (!list) return <CanvasState kind="loading" message={vi.prs.loading} />

  return (
    <div className="report-view">
      <header className="report-head">
        <h2>{vi.prs.title}</h2>
        <span className="muted small">{vi.prs.base(list.repo ?? '', list.base)}</span>
        {list.prs.length > 0 && <button type="button" onClick={() => setTriage(true)}>{vi.prs.triageAi}</button>}
      </header>
      {triage && <SemanticDialog projectId={projectId} target="pr_triage" onClose={() => setTriage(false)} />}
      {list.truncated && <p className="warn">{vi.prs.truncated}</p>}
      <section>
        {list.prs.length === 0 ? <p className="muted">{vi.prs.empty}</p> : (
          <table>
            <thead><tr><th>{vi.prs.colNumber}</th><th>{vi.prs.colTitle}</th><th>{vi.prs.colStatus}</th><th>{vi.prs.colCi}</th><th>{vi.prs.colAge}</th><th>{vi.prs.colImpact}</th></tr></thead>
            <tbody>
              {list.prs.map((p) => (
                <tr key={p.number} aria-selected={picked === p.number}>
                  <td className="mono">#{p.number}</td>
                  <td><button type="button" className="link" aria-label={vi.prs.select(p.number)} onClick={() => setPicked(p.number)}>{p.title}</button>
                    <span className="muted small"> {p.author}</span></td>
                  <td><span className="kind" title={p.status}>{vi.prs.status[p.status] ?? p.status}</span></td>
                  <td className="mono small">{p.ci}</td>
                  <td className="muted small">{vi.prs.days(p.days_old)}</td>
                  <td className="mono">{p.nodes_affected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {list.conflicts.length > 0 && (
        <section>
          <h3>{vi.prs.conflictsTitle}</h3>
          <p className="muted small">{vi.prs.conflictsHint}</p>
          {list.conflicts_truncated && <p className="warn">{vi.prs.conflictsTruncated}</p>}
          <ul className="report-list">
            {list.conflicts.map((c) => (
              <li key={`${c.a}-${c.b}`}>
                <b className="mono">{vi.prs.conflict(c.a, c.b)}</b>
                {c.files.length > 0 && <span className="mono muted small">{vi.prs.conflictFiles(c.files.join(', '))}</span>}
                {c.nodes > 0 && <span className="muted small">{vi.prs.conflictNodes(c.nodes)}</span>}
                {c.related > 0 && <span className="muted small">{vi.prs.conflictRelated(c.related)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {picked != null && detailError && <CanvasState kind="error" message={msgText(detailError)} />}
      {picked != null && !detail && !detailError && <CanvasState kind="loading" message={vi.prs.detailLoading(picked)} />}
      {detail && <Review d={detail} onOpenNode={onOpenNode} />}
    </div>
  )
}
