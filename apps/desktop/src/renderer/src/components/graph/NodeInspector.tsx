import { useEffect, useState } from 'react'
import type { DocSection, GraphNode, NodeExplain } from '@shared/graph-types'
import { vi } from '../../strings'
import { kindStyle } from './kindStyle'
import { NodeMemory } from './NodeMemory'

/** Bậc, cụm và cạnh vào/ra theo loại như `explain`: engine đã nhóm sẵn, phần quá 20 node gom theo tệp. */
function Explain({ projectId, node, onOpenNode }: { projectId: string; node: GraphNode; onOpenNode?: (n: GraphNode) => void }) {
  const [info, setInfo] = useState<NodeExplain | null | 'error'>(null)
  useEffect(() => {
    let alive = true
    setInfo(null)
    window.nexgraph.graph
      .explain(projectId, node.id)
      .then((r) => alive && setInfo(r))
      .catch(() => alive && setInfo('error'))
    return () => {
      alive = false
    }
  }, [projectId, node.id])
  return (
    <section className="explain">
      <h4>{vi.explain.title}</h4>
      {info === null && <p className="muted">{vi.explain.loading}</p>}
      {info !== null && info !== 'error' && <p className="muted small">{vi.explain.summary(info.degree, info.community?.label ?? null)}</p>}
      {(info === 'error' || info?.groups.length === 0) && <p className="muted">{vi.explain.none}</p>}
      {info !== null && info !== 'error' && info.groups.map((g) => (
        <details key={`${g.direction}:${g.type}`}>
          <summary className="mono">{g.direction === 'out' ? vi.explain.out(g.type, g.total) : vi.explain.in(g.type, g.total)}</summary>
          <ul>
            {g.nodes.map((n) => (
              <li key={n.id}>
                {onOpenNode ? <button type="button" className="link" onClick={() => onOpenNode(n)}>{n.label}</button> : n.label}
              </li>
            ))}
          </ul>
          {g.more_by_file.length > 0 && <p className="muted small">{vi.explain.more(g.more_by_file)}</p>}
        </details>
      ))}
    </section>
  )
}

function ReadSection({ projectId, node }: { projectId: string; node: GraphNode }) {
  const [section, setSection] = useState<DocSection | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setSection(null)
    setError(null)
  }, [projectId, node.id])
  const read = () => {
    setError(null)
    window.nexgraph.graph
      .section(projectId, node.id)
      .then(setSection)
      .catch((e: { message?: string }) => setError(e?.message ?? String(e)))
  }
  return (
    <section className="read-section">
      {!section && <button type="button" onClick={read}>{vi.explain.readSection}</button>}
      {error && <p role="alert" className="error">{error}</p>}
      {section && (
        <>
          {section.stale && <p className="warn small">{vi.explain.sectionStale}</p>}
          <pre className="mono">{section.text}</pre>
          {section.truncated && <p className="muted small">{vi.explain.sectionTruncated(section.file, section.start, section.end)}</p>}
        </>
      )}
    </section>
  )
}

export function NodeInspector({ node, onOpenCode, projectId, onOpenNode }: {
  node: GraphNode | null
  onOpenCode?: (file: string, line: number, lineEnd?: number) => void
  /** Khi có: hiện mục "Giải thích" (láng giềng theo loại cạnh). */
  projectId?: string
  onOpenNode?: (node: GraphNode) => void
}) {
  if (!node) return <aside className="inspector muted">{vi.graph.nothingSelected}</aside>
  const where = node.file ? (node.line_start ? `${node.file}:${node.line_start}–${node.line_end ?? node.line_start}` : node.file) : null
  return (
    <aside className="inspector">
      <h3>{node.label}</h3>
      <p><span className="kind" style={{ color: kindStyle(node.kind).color }}>{node.kind}</span></p>
      {where && <p className="mono">{where}</p>}
      {node.signature && <p className="mono">{node.signature}</p>}
      {node.is_test && <p>{vi.graph.isTest}</p>}
      {node.origin === 'llm' && <p className="ai-inferred" role="note">{vi.graph.aiInferred}</p>}
      {node.file && onOpenCode && (
        <button type="button" onClick={() => onOpenCode(node.file as string, node.line_start ?? 1, node.line_end ?? undefined)}>{vi.code.open}</button>
      )}
      {projectId && node.kind === 'document' && <ReadSection projectId={projectId} node={node} />}
      {projectId && <Explain projectId={projectId} node={node} onOpenNode={onOpenNode} />}
      {projectId && <NodeMemory projectId={projectId} nodeId={node.id} />}
    </aside>
  )
}
