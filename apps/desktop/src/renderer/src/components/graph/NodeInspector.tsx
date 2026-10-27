import type { GraphNode } from '@shared/graph-types'
import { vi } from '../../strings'
import { kindStyle } from './kindStyle'

export function NodeInspector({ node, onOpenCode }: { node: GraphNode | null; onOpenCode?: (file: string, line: number, lineEnd?: number) => void }) {
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
    </aside>
  )
}
