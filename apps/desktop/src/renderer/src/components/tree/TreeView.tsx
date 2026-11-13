import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { GraphNode, NodeKind } from '@shared/graph-types'
import { vi } from '../../strings'
import { kindStyle } from '../graph/kindStyle'

interface Props {
  projectId: string
  onOpenNode: (id: string) => void
  onOpenCode: (file: string, line?: number) => void
}

const ROOT = '.#repository'
const LIMIT = 500
const CONTAINERS: NodeKind[] = ['repository', 'package', 'directory', 'file', 'module', 'class', 'mixin', 'enum', 'extension', 'widget', 'screen']
const rank = (k: NodeKind) => (k === 'package' || k === 'directory' ? 0 : k === 'file' ? 1 : 2)

const sortKids = (kids: GraphNode[]) =>
  [...kids].sort((a, b) => rank(a.kind) - rank(b.kind) || (a.line_start ?? 0) - (b.line_start ?? 0) || a.label.localeCompare(b.label))

interface Loaded { kids: GraphNode[]; truncated: boolean }
interface Row { node: GraphNode; level: number; parent: string | null }

export function TreeView({ projectId, onOpenNode, onOpenCode }: Props) {
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT]))
  const [focused, setFocused] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refs = useRef(new Map<string, HTMLDivElement>())

  const load = (id: string) => {
    if (loaded.has(id)) return
    window.nexgraph.graph
      .neighbors(projectId, { node: id, types: ['CONTAINS', 'DEFINES'], direction: 'out', depth: 1, limit: LIMIT })
      .then((h) => {
        const kids = h.nodes.filter((n) => n.id !== id && h.edges.some((e) => e.source === id && e.target === n.id))
        setLoaded((m) => new Map(m).set(id, { kids: sortKids(kids), truncated: h.truncated }))
      })
      .catch((e: { message?: string }) => setError(e.message ?? String(e)))
  }

  useEffect(() => {
    setLoaded(new Map())
    setExpanded(new Set([ROOT]))
    load(ROOT)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const rows = useMemo(() => {
    const out: (Row | { more: string; level: number })[] = []
    const walk = (id: string, level: number) => {
      const l = loaded.get(id)
      if (!l) return
      for (const node of l.kids) {
        out.push({ node, level, parent: id === ROOT ? null : id })
        if (expanded.has(node.id)) walk(node.id, level + 1)
      }
      if (l.truncated) out.push({ more: id, level })
    }
    walk(ROOT, 1)
    return out
  }, [loaded, expanded])
  const items = rows.filter((r): r is Row => 'node' in r)

  useEffect(() => {
    if (focused) refs.current.get(focused)?.focus()
  }, [focused, rows])

  const toggle = (id: string, open?: boolean) => {
    setExpanded((s) => {
      const next = new Set(s)
      const willOpen = open ?? !s.has(id)
      if (willOpen) next.add(id)
      else next.delete(id)
      return next
    })
    if (open ?? !expanded.has(id)) load(id)
  }

  const onKey = (e: KeyboardEvent, row: Row) => {
    const i = items.findIndex((r) => r.node.id === row.node.id)
    const canOpen = CONTAINERS.includes(row.node.kind)
    const isOpen = expanded.has(row.node.id)
    let handled = true
    if (e.key === 'ArrowDown' && i < items.length - 1) setFocused(items[i + 1].node.id)
    else if (e.key === 'ArrowUp' && i > 0) setFocused(items[i - 1].node.id)
    else if (e.key === 'ArrowRight' && canOpen && !isOpen) toggle(row.node.id, true)
    else if (e.key === 'ArrowRight' && isOpen && items[i + 1]?.parent === row.node.id) setFocused(items[i + 1].node.id)
    else if (e.key === 'ArrowLeft' && isOpen) toggle(row.node.id, false)
    else if (e.key === 'ArrowLeft' && row.parent) setFocused(row.parent)
    else if (e.key === 'Enter') onOpenNode(row.node.id)
    else handled = false
    if (handled) e.preventDefault()
  }

  const tabStop = focused ?? items[0]?.node.id
  return (
    <div className="tree-view">
      {error && <p role="alert" className="error">{error}</p>}
      {!error && !loaded.has(ROOT) && <p className="muted">{vi.tree.loading}</p>}
      <div role="tree" aria-label={vi.tree.label}>
        {rows.map((r) => {
          if (!('node' in r)) return <p key={`more:${r.more}`} className="muted small tree-more" style={{ paddingLeft: r.level * 16 }}>{vi.tree.more}</p>
          const n = r.node
          const canOpen = CONTAINERS.includes(n.kind)
          const isOpen = expanded.has(n.id)
          return (
            <div
              key={n.id}
              ref={(el) => void (el ? refs.current.set(n.id, el) : refs.current.delete(n.id))}
              role="treeitem"
              aria-label={n.label}
              aria-level={r.level}
              aria-expanded={canOpen ? isOpen : undefined}
              tabIndex={n.id === tabStop ? 0 : -1}
              className="tree-row"
              style={{ paddingLeft: (r.level - 1) * 16 }}
              onFocus={() => setFocused(n.id)}
              onKeyDown={(e) => onKey(e, r)}
            >
              {canOpen ? (
                <button type="button" tabIndex={-1} className="twisty" aria-label={`${isOpen ? vi.tree.collapse : vi.tree.expand} ${n.label}`} onClick={() => toggle(n.id)}>
                  {isOpen ? '▾' : '▸'}
                </button>
              ) : <span className="twisty" />}
              <span className="tree-label" onClick={() => onOpenNode(n.id)}>{n.label}</span>
              <span className="kind" style={{ color: kindStyle(n.kind).color }}>{n.kind}</span>
              {n.file && n.kind !== 'directory' && (
                <button type="button" tabIndex={-1} className="link" aria-label={`${vi.tree.openCode} ${n.label}`}
                  onClick={() => onOpenCode(n.file as string, n.line_start ?? undefined)}>{'</>'}</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
