import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { GraphNode, NodeKind } from '@shared/graph-types'
import { vi } from '../../strings'
import { kindStyle } from '../graph/kindStyle'
import { Icon } from '../common/icons'
import './tree-view.css'

interface Props {
  projectId: string
  onOpenNode: (id: string) => void
  onOpenCode: (file: string, line?: number) => void
  compact?: boolean
  activeFile?: string
  revision?: number
}

const ROOT = '.#repository'
const LIMIT = 500
const CONTAINERS: NodeKind[] = ['repository', 'package', 'directory', 'file', 'module', 'class', 'mixin', 'enum', 'extension', 'widget', 'screen']
const rank = (k: NodeKind) => (k === 'package' || k === 'directory' ? 0 : k === 'file' ? 1 : 2)

type TreeNode = Pick<GraphNode, 'id' | 'kind' | 'label' | 'file' | 'line_start'>

const sortKids = (kids: TreeNode[]) =>
  [...kids].sort((a, b) => rank(a.kind) - rank(b.kind) || (a.line_start ?? 0) - (b.line_start ?? 0) || a.label.localeCompare(b.label))

interface Loaded { kids: TreeNode[]; truncated: boolean }
interface Row { node: TreeNode; level: number; parent: string | null }

function fileTone(file: string): string {
  if (/\.(tsx?|mts|cts|dart|cs)$/i.test(file)) return 'blue'
  if (/\.(jsx?|mjs|cjs|json|ya?ml|toml)$/i.test(file)) return 'amber'
  if (/\.(html?|css|scss|vue|svelte)$/i.test(file)) return 'orange'
  if (/\.(mdx?|txt|rst|py)$/i.test(file)) return 'teal'
  return 'default'
}

export function TreeView({ projectId, onOpenNode, onOpenCode, compact = false, activeFile, revision }: Props) {
  const list = compact && !window.nexgraph.host ? window.nexgraph.fs.list : undefined
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT]))
  const [focused, setFocused] = useState<string | null>(null)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const refs = useRef(new Map<string, HTMLDivElement>())
  const tree = useRef<HTMLDivElement>(null)
  const requests = useRef(new Set<string>())
  const visibleExpanded = useRef([ROOT])
  const reload = useRef(() => {})
  const lastRevision = useRef(revision)

  const load = (id: string, refresh = false) => {
    const pending = requests.current
    if ((!refresh && loaded.has(id)) || pending.has(id)) return
    pending.add(id)
    setErrors((current) => {
      if (!current.has(id)) return current
      const next = new Map(current)
      next.delete(id)
      return next
    })
    const directory = id === ROOT ? '.' : id.endsWith('#directory') ? id.slice(0, -'#directory'.length) : undefined
    const data = list && directory !== undefined
      ? list(projectId, directory).then(({ entries, truncated }) => ({
        kids: entries.map(({ path, name, kind }) => ({ id: `${path}#${kind}`, label: name, kind, file: path, line_start: null })),
        truncated
      }))
      : window.nexgraph.graph.neighbors(projectId, { node: id, types: ['CONTAINS', 'DEFINES'], direction: 'out', depth: 1, limit: LIMIT }).then((h) => {
        const members = new Set(h.edges.filter((e) => e.source === id).map((e) => e.target))
        const kids = h.nodes.filter((n) => n.id !== id && members.has(n.id))
        return { kids: sortKids(kids), truncated: h.truncated }
      })

    void data.then((branch) => {
      if (pending === requests.current) setLoaded((m) => new Map(m).set(id, branch))
    })
      .catch((e: { code?: string; message?: string }) => {
        if (pending !== requests.current) return
        if (list && id.endsWith('#file') && (e?.code === 'unknown_node' || e?.code === 'not_indexed')) {
          setLoaded((m) => new Map(m).set(id, { kids: [], truncated: false }))
        } else setErrors((current) => new Map(current).set(id, e?.message ?? String(e)))
      })
      .finally(() => pending.delete(id))
  }

  useEffect(() => {
    reload.current = () => {
      requests.current = new Set()
      const branches = new Set(visibleExpanded.current)
      // Giữ nhánh mở. Nhánh đang ẩn được đọc lại khi người dùng mở chúng.
      setLoaded((current) => new Map([...current].filter(([id]) => branches.has(id))))
      setErrors(new Map())
      for (const id of branches) load(id, true)
    }
    requests.current = new Set()
    visibleExpanded.current = [ROOT]
    setLoaded(new Map())
    setErrors(new Map())
    setExpanded(new Set([ROOT]))
    setFocused(null)
    load(ROOT, true)
    const off = window.nexgraph.index.onEvent((e) => {
      if (lastRevision.current === undefined && e.type === 'graph_updated' && e.project_id === projectId) reload.current()
    })
    return () => {
      off()
      requests.current = new Set()
      reload.current = () => {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, list])

  useEffect(() => {
    if (lastRevision.current === revision) return
    lastRevision.current = revision
    reload.current()
  }, [revision])

  const rows = useMemo(() => {
    const out: (Row | { more: string; level: number })[] = []
    const visited = new Set([ROOT])
    const walk = (id: string, level: number) => {
      const l = loaded.get(id)
      if (!l) return
      for (const node of l.kids) {
        if (visited.has(node.id)) continue
        visited.add(node.id)
        out.push({ node, level, parent: id === ROOT ? null : id })
        if (expanded.has(node.id)) walk(node.id, level + 1)
      }
      if (l.truncated) out.push({ more: id, level })
    }
    walk(ROOT, 1)
    return out
  }, [loaded, expanded])
  const items = rows.filter((r): r is Row => 'node' in r)
  visibleExpanded.current = [ROOT, ...items.filter(({ node }) => expanded.has(node.id)).map(({ node }) => node.id)]

  useEffect(() => {
    if (focused && tree.current?.contains(document.activeElement)) refs.current.get(focused)?.focus()
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

  const open = (node: TreeNode) => {
    if (compact && node.kind === 'file' && node.file) onOpenCode(node.file, node.line_start ?? 1)
    else if (compact && (node.kind === 'directory' || node.kind === 'package')) toggle(node.id)
    else onOpenNode(node.id)
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
    else if (e.key === 'Home') setFocused(items[0]?.node.id ?? null)
    else if (e.key === 'End') setFocused(items.at(-1)?.node.id ?? null)
    else if (e.key === 'Enter') open(row.node)
    else handled = false
    if (handled) e.preventDefault()
  }

  const tabStop = items.some(({ node }) => node.id === focused) ? focused : items[0]?.node.id
  const renderError = (id: string) => errors.has(id) ? (
    <div role="alert" className="tree-error">{errors.get(id)} <button type="button" onClick={() => load(id, true)}>Thử lại</button></div>
  ) : null

  return (
    <div className={`tree-view${compact ? ' tree-compact' : ''}`}>
      {compact && (
        <div className="tree-tools">
          <span>{list ? 'Tệp' : 'Tệp đã lập chỉ mục'}</span>
          <button type="button" className="ws-icon-button" aria-label="Tải lại cây tệp" title="Tải lại cây tệp" onClick={() => reload.current()}>
            <Icon name="refresh" size={14} />
          </button>
          <button type="button" className="ws-icon-button" aria-label="Thu gọn cây tệp" title="Thu gọn cây tệp"
            disabled={expanded.size === 1} onClick={() => { setExpanded(new Set([ROOT])); setFocused(null) }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <rect x="3" y="7" width="14" height="14" rx="2" /><path d="M7 3h12a2 2 0 0 1 2 2v12M7 14h6" />
            </svg>
          </button>
        </div>
      )}
      {renderError(ROOT)}
      {!errors.has(ROOT) && !loaded.has(ROOT) && <p role="status" className="muted">{list ? 'Đang đọc thư mục…' : vi.tree.loading}</p>}
      {loaded.has(ROOT) && rows.length === 0 && <p className="muted">{list ? 'Thư mục trống.' : 'Chưa có tệp trong phạm vi chỉ mục.'}</p>}
      <div ref={tree} role="tree" aria-label={vi.tree.label}>
        {rows.map((r) => {
          if (!('node' in r)) return <p key={`more:${r.more}`} className="muted small tree-more" style={{ paddingInlineStart: r.level * 16 }}>
            {list && (r.more === ROOT || r.more.endsWith('#directory')) ? 'Thư mục có nhiều mục. Cây hiển thị tối đa 500 mục.' : vi.tree.more}
          </p>
          const n = r.node
          const folder = n.kind === 'directory' || n.kind === 'package'
          const file = n.kind === 'file'
          const canOpen = CONTAINERS.includes(n.kind)
          const isOpen = expanded.has(n.id)
          const indent = Math.min(r.level - 1, compact ? 8 : 24) * (compact ? 12 : 16)
          const branch = loaded.get(n.id)
          const empty = list && isOpen && !errors.has(n.id) && branch && branch.kids.length === 0 && !branch.truncated
          return (
            <Fragment key={n.id}>
              <div
                ref={(el) => void (el ? refs.current.set(n.id, el) : refs.current.delete(n.id))}
                role="treeitem"
                aria-label={n.label}
                aria-level={r.level}
                aria-expanded={canOpen ? isOpen : undefined}
                aria-selected={compact && file ? Boolean(activeFile && n.file === activeFile) : undefined}
                tabIndex={n.id === tabStop ? 0 : -1}
                className="tree-row"
                style={{ paddingInlineStart: indent }}
                onFocus={() => setFocused(n.id)}
                onClick={compact ? (e) => { e.currentTarget.focus(); open(n) } : undefined}
                onKeyDown={(e) => { if (e.currentTarget === e.target) onKey(e, r) }}
              >
                {compact && indent > 0 && <span aria-hidden="true" className="tree-indent" style={{ width: indent }} />}
                {canOpen ? (
                  <button type="button" tabIndex={-1} className="twisty" aria-label={`${isOpen ? vi.tree.collapse : vi.tree.expand} ${n.label}`}
                    onClick={(e) => { e.stopPropagation(); e.currentTarget.parentElement?.focus(); toggle(n.id) }}>
                    {compact ? <Icon name="chevron" size={12} /> : isOpen ? '▾' : '▸'}
                  </button>
                ) : <span className="twisty" />}
                {compact && (
                  <span className={`tree-icon tree-icon-${folder ? 'folder' : file ? 'file' : 'symbol'}`} data-tone={file ? fileTone(n.label) : undefined} aria-hidden="true">
                    {folder ? <Icon name="folder" size={15} /> : file ? (
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
                        <path d="M6 3h8l4 4v14H6zM13 3v5h5M9 13h6m-6 4h6" />
                      </svg>
                    ) : '•'}
                  </span>
                )}
                <span className="tree-label" title={n.file ?? n.label} onClick={compact ? undefined : () => open(n)}>{n.label}</span>
                <span className="kind" style={{ color: kindStyle(n.kind).color }}>{n.kind}</span>
                {n.file && n.kind !== 'directory' && !(compact && (folder || file)) && (
                  <button type="button" tabIndex={-1} className="link" aria-label={`${vi.tree.openCode} ${n.label}`}
                    onClick={(e) => { e.stopPropagation(); onOpenCode(n.file as string, n.line_start ?? undefined) }}>{'</>'}</button>
                )}
              </div>
              {isOpen && renderError(n.id)}
              {empty && <p className="tree-branch-empty muted" style={{ paddingInlineStart: indent + 22 }}>
                {file ? 'Chưa có ký hiệu trong chỉ mục.' : 'Thư mục trống.'}
              </p>}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
