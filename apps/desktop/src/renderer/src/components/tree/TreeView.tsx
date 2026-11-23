import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { GraphNode, NodeKind } from '@shared/graph-types'
import { tr, vi } from '../../strings'
import { errorText } from '../../state/errorText'
import { runCommand } from '../../state/commands'
import { useChanges } from '../../state/useChanges'
import { useDiagnostics } from '../../state/diagnostics'
import { kindLabel, kindStyle } from '../graph/kindStyle'
import { Icon } from '../common/icons'
import { FileTypeIcon } from '../common/FileTypeIcon'
import './tree-view.css'

interface Props {
  projectId: string
  onOpenNode: (id: string) => void
  onOpenCode: (file: string, line?: number) => void
  compact?: boolean
  activeFile?: string
  revision?: number
  projectPath?: string
  dirtyFiles?: ReadonlySet<string>
  onRename?: (from: string, to: string) => void
  onTrash?: (path: string) => void
  onPreviewFile?: (file: string, line?: number) => void
  onPinFile?: (file: string, line?: number) => void
  onCloseFile?: (file: string) => void
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
type Clipboard = { path: string; kind: 'file' | 'directory'; cut: boolean }
const clipboards = new Map<string, Clipboard>()
const parentOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'
const childPath = (directory: string, name: string) => directory === '.' ? name : `${directory}/${name}`
const insidePath = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`)
const entryPath = (node?: TreeNode | null) => node?.file && (node.kind === 'file' || node.kind === 'directory') ? node.file : null
type Editing = { kind: 'file' | 'directory' | 'rename'; parent: string; node?: TreeNode; value: string }
type TreeMenu = { node: TreeNode | null; x: number; y: number }


export function TreeView({ projectId, projectPath, onOpenNode, onOpenCode, compact = false, activeFile, revision, dirtyFiles, onRename, onTrash, onPreviewFile, onPinFile, onCloseFile }: Props) {
  const fs = window.nexgraph.fs
  const list = compact && !window.nexgraph.host ? fs.list : undefined
  const canEdit = Boolean(list && fs.createFile)
  const [loaded, setLoaded] = useState<Map<string, Loaded>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set([ROOT]))
  const [focused, setFocused] = useState<string | null>(null)
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  const [edit, setEdit] = useState<Editing | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [menu, setMenu] = useState<TreeMenu | null>(null)
  const [clipboard, setClipboard] = useState<Clipboard | undefined>(() => clipboards.get(projectId))
  const refs = useRef(new Map<string, HTMLDivElement>())
  const tree = useRef<HTMLDivElement>(null)
  const requests = useRef(new Set<string>())
  const visibleExpanded = useRef([ROOT])
  const refreshedExpanded = useRef<string[] | null>(null)
  const reload = useRef(() => {})
  const lastRevision = useRef(revision)
  const [preview, setPreview] = useState<Set<string>>(new Set())
  const [tooltip, setTooltip] = useState<{ path: string; x: number; y: number } | null>(null)
  const tooltipTimer = useRef<number | undefined>(undefined)
  const { changes } = useChanges(projectId)
  const diagnostics = useDiagnostics(projectId)
  const gitStatus = useMemo(() => new Map((changes?.changed_files ?? []).map((f) => [f.path, f.status])), [changes])
  const statusOf = (path: string | null) => {
    if (!path) return null
    const direct = gitStatus.get(path)
    if (direct) return direct
    for (const [file, status] of gitStatus) if (insidePath(file, path)) return status
    return null
  }
  const issuesOf = (path: string | null) => path
    ? Object.entries(diagnostics).reduce((n, [file, list]) => n + (insidePath(file, path) ? list.length : 0), 0)
    : 0
  const hideTooltip = () => {
    clearTimeout(tooltipTimer.current)
    tooltipTimer.current = undefined
    setTooltip(null)
  }
  const showTooltip = (path: string, x: number, y: number) => {
    hideTooltip()
    tooltipTimer.current = window.setTimeout(() => setTooltip({ path, x, y }), 1500)
  }

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
  useEffect(() => {
    if (!activeFile) return
    const parts = activeFile.split('/').slice(0, -1)
    const ids = parts.map((_, i) => `${parts.slice(0, i + 1).join('/')}#directory`)
    setExpanded((current) => new Set([...current, ...ids]))
    for (const id of ids) load(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile])
  useEffect(() => {
    if (!activeFile) return
    refs.current.get(`${activeFile}#file`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeFile, loaded])
  useEffect(() => () => clearTimeout(tooltipTimer.current), [])

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
    if (!refreshedExpanded.current) return
    visibleExpanded.current = refreshedExpanded.current
    refreshedExpanded.current = null
    reload.current()
  }, [expanded])

  useEffect(() => {
    if (!edit && focused && tree.current?.contains(document.activeElement)) refs.current.get(focused)?.focus()
  }, [focused, rows, edit])

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
  const openPreview = (node: TreeNode) => {
    const file = entryPath(node)
    if (!compact || node.kind !== 'file' || !file) { open(node); return }
    setPreview((current) => new Set(current).add(file))
    if (onPreviewFile) onPreviewFile(file, node.line_start ?? 1)
    else onOpenCode(file, node.line_start ?? 1)
  }
  const pin = (node: TreeNode) => {
    const file = entryPath(node)
    if (!compact || node.kind !== 'file' || !file) { open(node); return }
    setPreview((current) => { const next = new Set(current); next.delete(file); return next })
    if (onPinFile) onPinFile(file, node.line_start ?? 1)
    else onOpenCode(file, node.line_start ?? 1)
  }
  const close = (node: TreeNode) => {
    const file = entryPath(node)
    if (!file) return
    setPreview((current) => { const next = new Set(current); next.delete(file); return next })
    if (onCloseFile) onCloseFile(file)
    else if (file === activeFile) runCommand('tab.close')
  }

  useEffect(() => {
    setClipboard(clipboards.get(projectId))
    setEdit(null)
    setOperationError(null)
  }, [projectId])

  useEffect(() => {
    if (!menu) return
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setMenu(null) }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [menu])

  const updateClipboard = (next?: Clipboard) => {
    if (next) clipboards.set(projectId, next)
    else clipboards.delete(projectId)
    setClipboard(next)
  }
  const refreshAfter = (oldPath?: string, newPath?: string, targetDirectory?: string) => {
    let next = visibleExpanded.current
    if (oldPath) {
      next = next.flatMap((id) => {
        const hash = id.lastIndexOf('#')
        const path = id.slice(0, hash)
        if (!insidePath(path, oldPath)) return [id]
        return newPath ? [`${newPath}${path.slice(oldPath.length)}${id.slice(hash)}`] : []
      })
    }
    if (targetDirectory && targetDirectory !== '.') next = [...new Set([...next, `${targetDirectory}#directory`])]
    if (oldPath || targetDirectory && targetDirectory !== '.') {
      refreshedExpanded.current = next
      setExpanded(new Set(next))
    } else reload.current()
  }
  const hasDirty = (path: string) => [...(dirtyFiles ?? [])].some((file) => insidePath(file, path))
  const allowRename = (path: string) => {
    if (!hasDirty(path)) return true
    setOperationError(tr('Hãy lưu các tệp đang sửa trước khi đổi tên hoặc di chuyển.'))
    return false
  }
  const run = async (action: () => Promise<void>) => {
    setOperationError(null)
    setWorking(true)
    try {
      await action()
      return true
    } catch (error) {
      setOperationError(errorText(error))
      return false
    } finally {
      setWorking(false)
    }
  }
  const directoryFor = (node: TreeNode | null) => {
    const path = entryPath(node)
    return path ? node?.kind === 'directory' ? path : parentOf(path) : '.'
  }
  const beginCreate = (kind: 'file' | 'directory', node: TreeNode | null) => {
    const parent = directoryFor(node)
    if (node?.kind === 'directory' && !expanded.has(node.id)) toggle(node.id, true)
    setOperationError(null)
    setEdit({ kind, parent, value: '' })
  }
  const beginRename = (node: TreeNode) => {
    const path = entryPath(node)
    if (!path || !allowRename(path)) return
    setOperationError(null)
    setEdit({ kind: 'rename', parent: parentOf(path), node, value: node.label })
  }
  const submitEdit = async () => {
    if (!edit || working) return
    const name = edit.value.trim()
    if (!name) { setOperationError(tr('Tên tệp hoặc thư mục không được để trống.')); return }
    const target = childPath(edit.parent, name)
    const old = entryPath(edit.node)
    if (edit.kind === 'rename' && old === target) { setEdit(null); return }
    if (edit.kind === 'rename' && old && !allowRename(old)) return
    const ok = await run(async () => {
      if (edit.kind === 'rename' && old && fs.rename) {
        await fs.rename(projectId, old, target)
        onRename?.(old, target)
        refreshAfter(old, target)
      } else if (edit.kind === 'file' && fs.createFile) {
        await fs.createFile(projectId, target)
        refreshAfter()
        onOpenCode(target)
      } else if (edit.kind === 'directory' && fs.createDir) {
        await fs.createDir(projectId, target)
        refreshAfter()
      } else throw new Error(tr('Thao tác không được hỗ trợ ở chế độ này.'))
    })
    if (ok) setEdit(null)
  }
  const duplicate = (node: TreeNode) => {
    const path = entryPath(node)
    if (!path || !fs.copy) return
    void run(async () => {
      const copied = await fs.copy!(projectId, path, parentOf(path))
      refreshAfter()
      if (node.kind === 'file') onOpenCode(copied)
    })
  }
  const paste = (node: TreeNode | null) => {
    if (!clipboard) return
    let directory = directoryFor(node)
    if (directory === clipboard.path) directory = parentOf(directory)
    if (clipboard.cut) {
      if (parentOf(clipboard.path) === directory || !fs.rename || !allowRename(clipboard.path)) return
      const from = clipboard.path
      const target = childPath(directory, from.slice(from.lastIndexOf('/') + 1))
      void run(async () => {
        await fs.rename!(projectId, from, target)
        onRename?.(from, target)
        updateClipboard({ ...clipboard, path: target, cut: false })
        refreshAfter(from, target, directory)
      })
    } else if (fs.copy) {
      void run(async () => {
        const copied = await fs.copy!(projectId, clipboard.path, directory)
        refreshAfter(undefined, undefined, directory)
        if (clipboard.kind === 'file') onOpenCode(copied)
      })
    }
  }
  const trash = (node: TreeNode) => {
    const path = entryPath(node)
    if (!path || !fs.trash) return
    if (hasDirty(path)) { setOperationError(tr('Hãy lưu các tệp đang sửa trước khi chuyển vào Thùng rác.')); return }
    if (!window.confirm(tr('Chuyển “{name}” vào Thùng rác?', { name: node.label }))) return
    void run(async () => {
      await fs.trash!(projectId, path)
      onTrash?.(path)
      if (clipboard && insidePath(clipboard.path, path)) updateClipboard()
      refreshAfter(path)
    })
  }
  const reveal = (node: TreeNode | null) => {
    const path = entryPath(node) ?? '.'
    if (fs.reveal) void run(() => fs.reveal!(projectId, path))
  }
  const copyPath = (node: TreeNode | null, relative: boolean) => {
    const path = entryPath(node) ?? '.'
    const separator = projectPath?.includes('\\') ? '\\' : '/'
    const value = relative ? path : `${projectPath?.replace(/[/\\]+$/, '') ?? ''}${path === '.' ? '' : separator + path.replace(/\//g, separator)}`
    void run(async () => {
      if (!navigator.clipboard) throw new Error(tr('Không thể truy cập clipboard.'))
      await navigator.clipboard.writeText(value)
    })
  }

  const onKey = (e: KeyboardEvent, row: Row) => {
    const i = items.findIndex((r) => r.node.id === row.node.id)
    const node = row.node
    const path = entryPath(node)
    const canOpen = CONTAINERS.includes(node.kind)
    const isOpen = expanded.has(node.id)
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()
    let handled = true
    if (canEdit && path && mod && e.altKey && key === 'r') reveal(node)
    else if (canEdit && path && mod && e.altKey && key === 'c') copyPath(node, e.shiftKey)
    else if (canEdit && path && mod && key === 'd') duplicate(node)
    else if (canEdit && path && mod && (key === 'c' || key === 'x')) updateClipboard({ path, kind: node.kind as Clipboard['kind'], cut: key === 'x' })
    else if (canEdit && mod && key === 'v') paste(node)
    else if (canEdit && path && (e.key === 'F2' || e.key === 'Enter')) beginRename(node)
    else if (canEdit && path && (e.key === 'Backspace' || e.key === 'Delete')) trash(node)
    else if (canEdit && e.shiftKey && e.key === 'F10') {
      const rect = e.currentTarget.getBoundingClientRect()
      setMenu({ node: path ? node : null, x: rect.left, y: rect.bottom })
    }
    else if (e.key === 'ArrowDown' && i < items.length - 1) setFocused(items[i + 1].node.id)
    else if (e.key === 'ArrowUp' && i > 0) setFocused(items[i - 1].node.id)
    else if (e.key === 'ArrowRight' && canOpen && !isOpen) toggle(node.id, true)
    else if (e.key === 'ArrowRight' && isOpen && items[i + 1]?.parent === node.id) setFocused(items[i + 1].node.id)
    else if (e.key === 'ArrowLeft' && isOpen) toggle(node.id, false)
    else if (e.key === 'ArrowLeft' && row.parent) setFocused(row.parent)
    else if (e.key === 'Home') setFocused(items[0]?.node.id ?? null)
    else if (e.key === 'End') setFocused(items.at(-1)?.node.id ?? null)
    else if (e.key === 'Enter' || e.key === ' ') open(node)
    else handled = false
    if (handled) { e.preventDefault(); e.stopPropagation() }
  }

  const tabStop = items.some(({ node }) => node.id === focused) ? focused : items[0]?.node.id
  const renderError = (id: string) => errors.has(id) ? (
    <div role="alert" className="tree-error">{errors.get(id)} <button type="button" onClick={() => load(id, true)}>{tr('Thử lại')}</button></div>
  ) : null
  const editor = edit && <input className="tree-edit" autoFocus disabled={working}
    aria-label={edit.kind === 'rename' ? tr('Đổi tên') : edit.kind === 'file' ? tr('Tệp mới') : tr('Thư mục mới')}
    value={edit.value} onClick={(event) => event.stopPropagation()}
    onFocus={(event) => {
      if (edit.kind !== 'rename') return
      const dot = edit.node?.kind === 'file' ? edit.value.lastIndexOf('.') : -1
      event.currentTarget.setSelectionRange(0, dot > 0 ? dot : edit.value.length)
    }}
    onChange={(event) => setEdit({ ...edit, value: event.target.value })}
    onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === 'Enter') { event.preventDefault(); void submitEdit() }
      else if (event.key === 'Escape') { event.preventDefault(); setEdit(null); setOperationError(null) }
    }} />
  const menuNode = menu?.node ?? null
  const menuPath = entryPath(menuNode)
  const menuItems = [
    { label: tr('Tệp mới'), action: () => beginCreate('file', menuNode), disabled: !fs.createFile },
    { label: tr('Thư mục mới'), action: () => beginCreate('directory', menuNode), disabled: !fs.createDir },
    ...(menuPath && menuNode ? [
      { label: tr('Đổi tên'), action: () => beginRename(menuNode), disabled: !fs.rename },
      { label: tr('Nhân bản'), action: () => duplicate(menuNode), disabled: !fs.copy },
      { label: tr('Sao chép'), action: () => updateClipboard({ path: menuPath, kind: menuNode.kind as Clipboard['kind'], cut: false }) },
      { label: tr('Cắt'), action: () => updateClipboard({ path: menuPath, kind: menuNode.kind as Clipboard['kind'], cut: true }) }
    ] : []),
    { label: tr('Dán'), action: () => paste(menuNode), disabled: !clipboard },
    ...(menuPath && menuNode ? [{ label: tr('Xoá'), action: () => trash(menuNode), disabled: !fs.trash }] : []),
    { label: tr('Hiện trong Finder'), action: () => reveal(menuNode), disabled: !fs.reveal },
    { label: tr('Sao chép đường dẫn'), action: () => copyPath(menuNode, false), disabled: !projectPath },
    { label: tr('Sao chép đường dẫn tương đối'), action: () => copyPath(menuNode, true) }
  ]
  const newEditor = (parent: string, indent: number) => edit && edit.kind !== 'rename' && edit.parent === parent && (
    <div className="tree-row tree-new" style={{ paddingInlineStart: indent }}>
      <span className="twisty" /><span className="tree-icon"><Icon name={edit.kind === 'directory' ? 'folder' : 'plus'} size={15} /></span>{editor}
    </div>
  )


  return (
    <div className={`tree-view${compact ? ' tree-compact' : ''}`}
      onContextMenu={(event) => { if (canEdit) { event.preventDefault(); setMenu({ node: null, x: event.clientX, y: event.clientY }) } }}>
      {compact && (
        <div className="tree-tools">
          <span>{list ? tr('Tệp') : tr('Tệp đã lập chỉ mục')}</span>
          <button type="button" className="ws-icon-button" aria-label={tr('Tải lại cây tệp')} title={tr('Tải lại cây tệp')} onClick={() => reload.current()}>
            <Icon name="refresh" size={14} />
          </button>
          <button type="button" className="ws-icon-button" aria-label={tr('Thu gọn cây tệp')} title={tr('Thu gọn cây tệp')}
            disabled={expanded.size === 1} onClick={() => { setExpanded(new Set([ROOT])); setFocused(null) }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <rect x="3" y="7" width="14" height="14" rx="2" /><path d="M7 3h12a2 2 0 0 1 2 2v12M7 14h6" />
            </svg>
          </button>
          <button type="button" className="ws-icon-button" aria-label={tr('Mở rộng cây tệp')} title={tr('Mở rộng cây tệp')}
            disabled={loaded.size <= 1} onClick={() => setExpanded(new Set([...loaded.keys()]))}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="m5 8 5 5-5 5M13 8l5 5-5 5" />
            </svg>
          </button>
        </div>
      )}
      {renderError(ROOT)}
      {operationError && <div className="tree-error" role="alert">{operationError}</div>}
      {!errors.has(ROOT) && !loaded.has(ROOT) && <p role="status" className="muted">{list ? tr('Đang đọc thư mục…') : vi.tree.loading}</p>}
      {loaded.has(ROOT) && rows.length === 0 && !edit && <p className="muted">{list ? tr('Thư mục trống.') : tr('Chưa có tệp trong phạm vi chỉ mục.')}</p>}
      <div ref={tree} role="tree" aria-label={vi.tree.label} tabIndex={items.length ? undefined : 0}
        onKeyDown={(event) => {
          if (!canEdit || event.target !== event.currentTarget) return
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); paste(null) }
        }}>
        {newEditor('.', 0)}
        {rows.map((r) => {
          if (!('node' in r)) return <p key={`more:${r.more}`} className="muted small tree-more" style={{ paddingInlineStart: r.level * 16 }}>
            {list && (r.more === ROOT || r.more.endsWith('#directory')) ? tr('Thư mục có nhiều mục. Cây hiển thị tối đa 500 mục.') : vi.tree.more}
          </p>
          const n = r.node
          const folder = n.kind === 'directory' || n.kind === 'package'
          const file = n.kind === 'file'
          const canOpen = CONTAINERS.includes(n.kind)
          const isOpen = expanded.has(n.id)
          const indent = Math.min(r.level - 1, compact ? 8 : 24) * (compact ? 20 : 16)
          const branch = loaded.get(n.id)
          const empty = list && isOpen && !errors.has(n.id) && branch && branch.kids.length === 0 && !branch.truncated
          const path = entryPath(n)
          const status = statusOf(path)
          const issues = issuesOf(path)
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
                className={`tree-row${compact && file && path && preview.has(path) ? ' tree-preview' : ''}`}
                style={{ paddingInlineStart: indent }}
                onFocus={() => setFocused(n.id)}
                onMouseEnter={(e) => { if (path) showTooltip(path, e.clientX, e.clientY) }}
                onMouseLeave={hideTooltip}
                onClick={compact ? (e) => { e.currentTarget.focus(); hideTooltip(); if (e.detail > 1) return; openPreview(n) } : () => open(n)}
                onDoubleClick={compact ? () => { hideTooltip(); pin(n) } : undefined}
                onAuxClick={compact ? (e) => { if (e.button !== 1) return; e.preventDefault(); hideTooltip(); close(n) } : undefined}
                onKeyDown={(e) => { if (e.currentTarget === e.target) onKey(e, r) }}
                onContextMenu={canEdit && entryPath(n) ? (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setFocused(n.id)
                  setMenu({ node: n, x: event.clientX, y: event.clientY })
                } : undefined}
              >
                {compact && indent > 0 && <span aria-hidden="true" className="tree-indent" style={{ width: indent }} />}
                {canOpen ? (
                  <button type="button" tabIndex={-1} className="twisty" aria-label={`${isOpen ? vi.tree.collapse : vi.tree.expand} ${n.label}`}
                    onClick={(e) => { e.stopPropagation(); hideTooltip(); e.currentTarget.parentElement?.focus(); toggle(n.id) }}>
                    <Icon name="chevron" size={compact ? 12 : 14} />
                  </button>
                ) : <span className="twisty twisty-leaf" aria-hidden="true"><Icon name="chevron" size={compact ? 12 : 14} /></span>}
                <span className={`tree-icon tree-icon-${folder ? 'folder' : file ? 'file' : 'symbol'}`} aria-hidden="true">
                  {folder ? <Icon name="folder" size={compact ? 15 : 14} /> : file ? <FileTypeIcon name={n.label} /> : '•'}
                </span>
                {edit?.kind === 'rename' && edit.node?.id === n.id ? editor
                  : <span className="tree-label">{n.label}</span>}
                {status && <span className="tree-git" aria-label={tr('Thay đổi git: {status}', { status })}>{status}</span>}
                {issues > 0 && <span className="tree-diag" aria-label={tr('{count} vấn đề', { count: issues })}>{issues}</span>}
                <span className="kind" style={{ color: kindStyle(n.kind).color }}>{kindLabel(n.kind)}</span>
                {n.file && n.kind !== 'directory' && !(compact && (folder || file)) && (
                  <button type="button" tabIndex={-1} className="link" aria-label={`${vi.tree.openCode} ${n.label}`}
                    onClick={(e) => { e.stopPropagation(); onOpenCode(n.file as string, n.line_start ?? undefined) }}>{'</>'}</button>
                )}
              </div>
              {folder && isOpen && n.file && newEditor(n.file, indent + 20)}
              {isOpen && renderError(n.id)}
              {empty && <p className="tree-branch-empty muted" style={{ paddingInlineStart: indent + 22 }}>
                {file ? tr('Chưa có ký hiệu trong chỉ mục.') : tr('Thư mục trống.')}
              </p>}
            </Fragment>
          )
        })}
      </div>
      {tooltip && <div role="tooltip" className="tree-tooltip" style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}>{tooltip.path}</div>}
      {menu && <>
        <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null) }} />
        <div role="menu" aria-label={menuNode?.label ?? tr('Dự án')} className="context-menu tree-context"
          style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 220)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 380)) }}>
          {menuItems.map((item) => <button key={item.label} type="button" role="menuitem" disabled={working || item.disabled}
            onClick={() => { setMenu(null); item.action() }}>{item.label}</button>)}
        </div>
      </>}
    </div>
  )
}
