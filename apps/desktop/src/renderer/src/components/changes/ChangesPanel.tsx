import type { Changes, GraphNode } from '@shared/graph-types'
import { vi } from '../../strings'
import { HIGHLIGHT_COLORS } from '../graph/kindStyle'

interface Props {
  changes: Changes | null
  loading: boolean
  error: string | null
  onReload: () => void
  onOpenNode: (nodeId: string) => void
  onOpenCode?: (file: string, line?: number) => void
}

const score = (n: number) => n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function ChangesPanel({ changes, loading, error, onReload, onOpenNode, onOpenCode }: Props) {
  const codeButton = (node: GraphNode) =>
    onOpenCode && node.file ? (
      <button type="button" className="link" onClick={() => onOpenCode(node.file as string, node.line_start ?? undefined)}>
        {vi.changes.openCode}
      </button>
    ) : null
  const nodeRow = (node: GraphNode, extra?: React.ReactNode) => (
    <li key={node.id}>
      <button type="button" className="entry" onClick={() => onOpenNode(node.id)} title={node.file ?? undefined}>{((node.kind === 'method' || node.kind === 'function') && !node.is_test && node.qualified_name) || node.label}</button>
      {extra}
      {codeButton(node)}
    </li>
  )

  const base = !changes
    ? null
    : changes.base === 'git_head' && changes.base_commit
      ? vi.changes.baseGit(changes.base_commit.slice(0, 7))
      : (changes.note ?? vi.changes.baseIndex)

  return (
    <div className="changes-panel">
      <header className="changes-head">
        <h3>{vi.changes.title}</h3>
        <button type="button" onClick={onReload}>{vi.changes.reload}</button>
      </header>
      {base && <p className="muted">{base}</p>}
      {loading && <p role="status" className="muted">{vi.changes.loading}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {changes && changes.changed_files.length === 0 && <p className="muted">{vi.changes.none}</p>}
      {changes && changes.truncated && <p className="muted">{vi.changes.truncated}</p>}
      {changes && changes.changed_files.length > 0 && (
        <>
          <section aria-label={vi.changes.changedFiles}>
            <h4>{vi.changes.changedFiles}</h4>
            <ul>
              {changes.changed_files.map((f) => (
                <li key={f.path}>
                  <span className="status">{f.status}</span> <span className="mono">{f.path}</span>
                  {onOpenCode && f.status !== 'D' && (
                    <button type="button" className="link" onClick={() => onOpenCode(f.path, undefined)}>{vi.changes.openCode}</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
          {changes.changed_nodes.length > 0 && (
            <section aria-label={vi.changes.changedNodes}>
              <h4>{vi.changes.changedNodes}</h4>
              <ul>{changes.changed_nodes.map((n) => nodeRow(n))}</ul>
            </section>
          )}
          <section aria-label={vi.changes.impacted} style={{ color: HIGHLIGHT_COLORS.impacted }}>
            <h4>{vi.changes.impacted}</h4>
            {changes.impacted.length === 0 && <p className="muted">{vi.changes.noneImpacted}</p>}
            <ul>
              {changes.impacted.map((i) =>
                nodeRow(i.node, <span className="muted"> <b>{score(i.score)}</b> · <span>{vi.changes.hops(i.hops)}</span></span>)
              )}
            </ul>
          </section>
          <section aria-label={vi.changes.tests} style={{ color: HIGHLIGHT_COLORS.test }}>
            <h4>{vi.changes.tests}</h4>
            {changes.tests.length === 0 && <p className="muted">{vi.changes.noneTests}</p>}
            <ul>{changes.tests.map((n) => nodeRow(n))}</ul>
          </section>
          <section aria-label={vi.changes.gaps} style={{ color: HIGHLIGHT_COLORS.gap }}>
            <h4>{vi.changes.gaps}</h4>
            {changes.test_gaps.length === 0 && <p className="muted">{vi.changes.noneGaps}</p>}
            <ul>{changes.test_gaps.map((n) => nodeRow(n))}</ul>
          </section>
        </>
      )}
    </div>
  )
}
