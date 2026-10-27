import type { GraphNode } from '@shared/graph-types'
import { vi } from '../../strings'
import { kindStyle } from './kindStyle'

export function NodeInspector({ node }: { node: GraphNode | null }) {
  if (!node) return <aside className="inspector muted">{vi.graph.nothingSelected}</aside>
  const where = node.file ? (node.line_start ? `${node.file}:${node.line_start}–${node.line_end ?? node.line_start}` : node.file) : null
  return (
    <aside className="inspector">
      <h3>{node.label}</h3>
      <p><span className="kind" style={{ color: kindStyle(node.kind).color }}>{node.kind}</span></p>
      {where && <p className="mono">{where}</p>}
      {node.signature && <p className="mono">{node.signature}</p>}
      {node.is_test && <p>{vi.graph.isTest}</p>}
    </aside>
  )
}
