import { useEffect, useState } from 'react'
import type { GraphNode, Neighborhood } from '@shared/graph-types'
import { vi } from '../../strings'
import { kindStyle } from './kindStyle'

interface Group { key: string; title: string; nodes: GraphNode[] }

/** Láng giềng một bước, nhóm theo loại cạnh và hướng ("CALLS →", "← IMPORTS"). */
function groupNeighbors(id: string, hood: Neighborhood): Group[] {
  const byId = new Map(hood.nodes.map((n) => [n.id, n]))
  const groups = new Map<string, { out: boolean; type: string; nodes: GraphNode[] }>()
  for (const e of hood.edges) {
    const out = e.source === id
    if (!out && e.target !== id) continue
    const other = byId.get(out ? e.target : e.source)
    if (!other) continue
    const key = `${out ? 'out' : 'in'}:${e.type}`
    const g = groups.get(key) ?? { out, type: e.type, nodes: [] }
    if (!g.nodes.some((n) => n.id === other.id)) g.nodes.push(other)
    groups.set(key, g)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, g]) => ({ key, title: g.out ? vi.explain.out(g.type, g.nodes.length) : vi.explain.in(g.type, g.nodes.length), nodes: g.nodes }))
}

function Explain({ projectId, node, onOpenNode }: { projectId: string; node: GraphNode; onOpenNode?: (n: GraphNode) => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null)
  useEffect(() => {
    let alive = true
    setGroups(null)
    window.nexgraph.graph
      .neighbors(projectId, { node: node.id, depth: 1, limit: 200 })
      .then((h) => alive && setGroups(groupNeighbors(node.id, h)))
      .catch(() => alive && setGroups([]))
    return () => {
      alive = false
    }
  }, [projectId, node.id])
  return (
    <section className="explain">
      <h4>{vi.explain.title}</h4>
      {groups === null && <p className="muted">{vi.explain.loading}</p>}
      {groups?.length === 0 && <p className="muted">{vi.explain.none}</p>}
      {groups?.map((g) => (
        <details key={g.key}>
          <summary className="mono">{g.title}</summary>
          <ul>
            {g.nodes.slice(0, 50).map((n) => (
              <li key={n.id}>
                {onOpenNode ? <button type="button" className="link" onClick={() => onOpenNode(n)}>{n.label}</button> : n.label}
              </li>
            ))}
          </ul>
        </details>
      ))}
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
      {node.file && onOpenCode && (
        <button type="button" onClick={() => onOpenCode(node.file as string, node.line_start ?? 1, node.line_end ?? undefined)}>{vi.code.open}</button>
      )}
      {projectId && <Explain projectId={projectId} node={node} onOpenNode={onOpenNode} />}
    </aside>
  )
}
