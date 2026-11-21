import { tr } from '../../strings'
import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react'
import { Terminal, type ILink } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { TaskDefinition, TerminalEvent } from '@shared/api'
import '@xterm/xterm/css/xterm.css'
import { Icon } from '../common/icons'
import { getEditorPrefs, observeEditorPrefs } from '../../state/editorPrefs'
import { setTerminalHeight, useTerminalHeight } from '../../state/layoutPrefs'
import { observeTheme } from '../../state/useTheme'
import { errorText } from '../../state/errorText'
import './terminal.css'

type Tab = {
  key: number
  shell: string
  customTitle?: string
  cwd: string
  task?: TaskDefinition
  taskState?: { type: 'running' } | { type: 'exited'; code: number } | { type: 'error' }
}
export type TerminalSplitDirection = 'right' | 'left' | 'up' | 'down'
type PanelState = { tabs: Tab[]; visible: number[]; active: number | null; axis: 'horizontal' | 'vertical' }
type Action =
  | { type: 'add'; tab: Tab; split: boolean; direction?: TerminalSplitDirection }
  | { type: 'select'; key: number }
  | { type: 'close'; key: number }
  | { type: 'ready'; key: number; shell: string }
  | { type: 'exit'; key: number; code: number }
  | { type: 'error'; key: number }
  | { type: 'rename'; key: number; title: string }

// shortcut: API terminal hiện tại không lưu cwd/tiêu đề; giữ trong module, mất khi reload ứng dụng.
const savedTabs = new Map<string, { cwd: string; customTitle?: string }[]>()

function TaskIcon({ state }: { state?: Tab['taskState'] }) {
  const kind = !state ? 'idle' : state.type === 'exited' ? (state.code === 0 ? 'success' : 'failed') : state.type
  if (kind === 'idle') return <Icon name="terminal" size={13} />
  return <svg className="terminal-task-icon" data-status={kind} viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'running' ? <path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none" />
      : kind === 'success' ? <path d="m5 12 4 4L19 6" />
        : kind === 'error' ? <><path d="M12 3 2 20h20z" /><path d="M12 9v5M12 17h.01" /></>
          : <path d="m6 6 12 12M18 6 6 18" />}
  </svg>
}

function reducer(state: PanelState, action: Action): PanelState {
  switch (action.type) {
    case 'add': {
      const split = action.split && state.visible.length < 2
      const before = action.direction === 'left' || action.direction === 'up'
      const visible = split
        ? before ? [action.tab.key, ...state.visible] : [...state.visible, action.tab.key]
        : state.visible.map((key) => key === state.active ? action.tab.key : key)
      const axis = split ? (action.direction === 'up' || action.direction === 'down' ? 'vertical' : 'horizontal') : state.axis
      return { tabs: [...state.tabs, action.tab], visible: visible.length ? visible : [action.tab.key], active: action.tab.key, axis }
    }
    case 'select': {
      if (!state.tabs.some((tab) => tab.key === action.key)) return state
      const visible = state.visible.includes(action.key)
        ? state.visible
        : state.visible.map((key) => key === state.active ? action.key : key)
      return { ...state, visible, active: action.key }
    }
    case 'close': {
      const tabs = state.tabs.filter((tab) => tab.key !== action.key)
      if (tabs.length === state.tabs.length) return state
      let visible = state.visible.filter((key) => key !== action.key)
      if (!visible.length && tabs.length) visible = [tabs[tabs.length - 1].key]
      const active = state.active === action.key ? visible[visible.length - 1] ?? null : state.active
      return { ...state, tabs, visible, active, axis: visible.length < 2 ? 'horizontal' : state.axis }
    }
    case 'ready':
      return { ...state, tabs: state.tabs.map((tab) => tab.key === action.key ? { ...tab, shell: action.shell } : tab) }
    case 'exit': {
      const tab = state.tabs.find((item) => item.key === action.key)
      if (!tab) return state
      if (!tab.task) return reducer(state, { type: 'close', key: action.key })
      return { ...state, tabs: state.tabs.map((item) => item.key === action.key ? { ...item, taskState: { type: 'exited', code: action.code } } : item) }
    }
    case 'error':
      return { ...state, tabs: state.tabs.map((tab) => tab.key === action.key && tab.task ? { ...tab, taskState: { type: 'error' } } : tab) }
    case 'rename':
      return { ...state, tabs: state.tabs.map((tab) => tab.key === action.key ? { ...tab, customTitle: action.title || undefined } : tab) }
  }
}

type Controls = {
  focus: () => void
  clear: () => void
  selection: () => string
  search: (query: string, previous?: boolean, incremental?: boolean) => void
  clearSearch: () => void
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const xtermTheme = () => ({ background: css('--color-surface') || '#1e1e1e', foreground: css('--color-text') || '#d4d4d4', cursor: css('--color-text') || '#d4d4d4', selectionBackground: css('--accent-soft') || '#264f78' })
const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const modified = (event: MouseEvent | KeyboardEvent) => mac ? event.metaKey : event.ctrlKey
const knownSessions = new Set<number>()

function TerminalView({ projectId, tab, title, visible, focused, hidden, pane, split, controls, onSelect, onClose, onReady, onExit, onError, onOpenFile }: {
  projectId: string
  tab: Tab
  title: string
  visible: boolean
  focused: boolean
  hidden: boolean
  pane: number
  split: boolean
  controls: Map<number, Controls>
  onSelect: () => void
  onClose: () => void
  onReady: (shell: string) => void
  onExit: (code: number) => void
  onError: () => void
  onOpenFile: (file: string, line: number, column: number) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const fit = useRef<FitAddon | null>(null)
  const term = useRef<Terminal | null>(null)
  const callbacks = useRef({ onReady, onExit, onError, onOpenFile })
  callbacks.current = { onReady, onExit, onError, onOpenFile }

  useEffect(() => {
    const api = window.nexgraph.terminal
    if (!api || !host.current) return
    const openUrl = (event: MouseEvent, url: string) => {
      if (modified(event)) window.open(url, '_blank', 'noopener,noreferrer')
    }
    const xterm = new Terminal({
      fontSize: getEditorPrefs().terminalFontSize, fontFamily: css('--font-mono') || 'monospace',
      cursorBlink: true, allowProposedApi: true, theme: xtermTheme(), scrollback: 5000,
      linkHandler: { activate: openUrl }
    })
    const fitter = new FitAddon()
    const search = new SearchAddon()
    xterm.loadAddon(fitter)
    xterm.loadAddon(search)
    xterm.loadAddon(new WebLinksAddon(openUrl))
    xterm.open(host.current)
    term.current = xterm
    fit.current = fitter
    const fitVisible = () => { if (host.current?.offsetParent) fitter.fit() }
    fitVisible()

    let id: number | null = null
    let alive = true
    let bufferedChars = 0
    const pending = new Map<number, { data: string; code?: number; overflow: boolean }>()
    const deliver = (event: TerminalEvent) => {
      if (event.type === 'data') xterm.write(event.data)
      else callbacks.current.onExit(event.code)
    }
    const off = api.onEvent((event) => {
      if (id !== null) {
        if (event.id === id) deliver(event)
        return
      }
      if (knownSessions.has(event.id)) return
      let buffer = pending.get(event.id)
      if (!buffer) {
        if (pending.size >= 128) return
        buffer = { data: '', overflow: false }
        pending.set(event.id, buffer)
      }
      if (event.type === 'exit') buffer.code = event.code
      else {
        const remaining = Math.max(0, 8 * 1024 * 1024 - bufferedChars)
        buffer.data += event.data.slice(0, remaining)
        bufferedChars += Math.min(event.data.length, remaining)
        if (event.data.length > remaining) buffer.overflow = true
      }
    })
    const stopTheme = observeTheme(() => { xterm.options.theme = xtermTheme() })
    const stopPrefs = observeEditorPrefs(() => {
      const size = getEditorPrefs().terminalFontSize
      if (xterm.options.fontSize !== size) {
        xterm.options.fontSize = size
        fitVisible()
      }
    })
    const input = xterm.onData((data) => { if (id !== null) void api.write(id, data) })
    const resized = xterm.onResize(({ cols, rows }) => { if (id !== null) void api.resize(id, cols, rows) })
    const links = xterm.registerLinkProvider({
      provideLinks(y, callback) {
        const buffer = xterm.buffer.active
        let first = y
        while (first > 1 && buffer.getLine(first - 1)?.isWrapped) first--
        let last = y
        while (buffer.getLine(last)?.isWrapped) last++
        let text = ''
        const positions: { start: { x: number; y: number }; end: { x: number; y: number } }[] = []
        const cell = buffer.getNullCell()
        for (let row = first; row <= last; row++) {
          const line = buffer.getLine(row - 1)
          if (!line) continue
          for (let column = 0; column < Math.min(line.length, xterm.cols); column++) {
            const value = line.getCell(column, cell)
            if (!value || value.getWidth() === 0) continue
            const chars = value.getChars() || ' '
            text += chars
            for (let i = 0; i < chars.length; i++) positions.push({
              start: { x: column + 1, y: row }, end: { x: column + value.getWidth(), y: row }
            })
          }
        }
        const matches: ILink[] = []
        const pattern = /(?:[A-Za-z]:[\\/])?[^\s"'`<>|()[\]{}:,=]+:(\d+)(?::(\d+))?/g
        for (const match of text.matchAll(pattern)) {
          const start = positions[match.index]
          const end = positions[match.index + match[0].length - 1]
          if (!start || !end || start.start.y > y || end.end.y < y) continue
          const path = match[0].slice(0, match[0].length - match[1].length - (match[2]?.length ?? 0) - (match[2] ? 2 : 1))
          const line = Number(match[1])
          const column = Number(match[2] ?? 1)
          if (/^(?:[A-Za-z]:|[\\/])/.test(path) || line < 1 || column < 1 || !Number.isSafeInteger(line) || !Number.isSafeInteger(column)) continue
          matches.push({
            text: match[0], range: { start: start.start, end: end.end },
            activate(event) {
              if (!modified(event)) return
              void api.resolvePath(projectId, path).then((file) => {
                if (alive && file) callbacks.current.onOpenFile(file, line, column)
              }).catch((error: unknown) => {
                if (alive) xterm.write(`\r\n${tr('Không mở được tệp: {error}', { error: errorText(error) })}\r\n`)
              })
            }
          })
        }
        callback(matches)
      }
    })
    const actions: Controls = {
      focus: () => xterm.focus(),
      clear: () => xterm.clear(),
      selection: () => xterm.getSelection(),
      search: (query, previous, incremental) => {
        if (!query) return search.clearDecorations()
        const hex = (name: string, fallback: string) => {
          const value = css(name)
          return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback
        }
        const blue = hex('--blue', '#5f9bdb')
        const border = hex('--color-border', '#596d80')
        const surface = hex('--color-surface', '#1e1e1e')
        const options = { incremental, decorations: {
          matchBackground: border, matchBorder: border, matchOverviewRuler: border,
          activeMatchBackground: surface, activeMatchBorder: blue, activeMatchColorOverviewRuler: blue
        } }
        if (previous) search.findPrevious(query, options)
        else search.findNext(query, options)
      },
      clearSearch: () => search.clearDecorations()
    }
    controls.set(tab.key, actions)

    // Trì hoãn spawn một lượt để StrictMode dọn effect thử mà không chạy task hai lần.
    const timer = window.setTimeout(() => {
      void api.create(projectId, xterm.cols, xterm.rows, tab.task).then((session) => {
        if (!alive) return void api.kill(session.id)
        id = session.id
        knownSessions.add(id)
        callbacks.current.onReady(session.shell)
        const early = pending.get(id)
        pending.clear()
        if (early?.data) xterm.write(early.data)
        if (early?.overflow) xterm.write(`\r\n[${tr('Đầu ra quá lớn trước khi terminal sẵn sàng; một phần đã bị bỏ qua.')}]\r\n`)
        if (early?.code !== undefined) callbacks.current.onExit(early.code)
        fitVisible()
      }).catch((error: unknown) => {
        pending.clear()
        if (!alive) return
        xterm.write(`\r\n${tr('Không mở được terminal: {error}', { error: errorText(error) })}\r\n`)
        callbacks.current.onError()
      })
    }, 0)
    const observer = new ResizeObserver(fitVisible)
    observer.observe(host.current)
    return () => {
      alive = false
      window.clearTimeout(timer)
      observer.disconnect()
      off(); stopTheme(); stopPrefs(); input.dispose(); resized.dispose(); links.dispose()
      if (controls.get(tab.key) === actions) controls.delete(tab.key)
      if (id !== null) {
        knownSessions.delete(id)
        void api.kill(id)
      }
      fit.current = null
      term.current = null
      xterm.dispose()
    }
  }, [projectId, tab.key, tab.task, controls])

  useEffect(() => {
    if (!visible || hidden) return
    const frame = requestAnimationFrame(() => {
      if (host.current?.offsetParent) fit.current?.fit()
      if (focused && !document.activeElement?.closest('.terminal-search')) term.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [visible, focused, hidden])

  return (
    <div className="terminal-view" data-visible={visible || undefined} data-pane={pane} data-focused={focused || undefined}
      style={{ order: pane }} onFocus={onSelect} onPointerDown={onSelect}>
      {split && visible && <div className="terminal-pane-head">
        <span title={title}>{title}</span>
        <button type="button" className="terminal-icon" aria-label={tr('Đóng khung {title}', { title })} title={tr('Đóng khung')} onClick={onClose}><Icon name="close" size={12} /></button>
      </div>}
      <div ref={host} className="terminal-surface" />
    </div>
  )
}

export function TerminalPanel({ projectId, projectPath, newRequest, taskRequest, hidden, onHide, onCloseAll, onOpenFile,
  onNewTerminal, onSplitTerminal, onZoomChange, onRenameTerminal, onRerunTask, onCloseTerminal, onTabCountChange }: {
  projectId: string
  projectPath: string
  newRequest: number
  taskRequest: { seq: number; task: TaskDefinition } | null
  hidden: boolean
  onHide: () => void
  onCloseAll: () => void
  onOpenFile: (file: string, line: number, column: number) => void
  onNewTerminal?: () => void
  onSplitTerminal?: (direction: TerminalSplitDirection) => void
  onZoomChange?: (maximized: boolean) => void
  onRenameTerminal?: (title: string) => void
  onRerunTask?: (task: TaskDefinition) => void
  onCloseTerminal?: (running: boolean) => void
  onTabCountChange?: (count: number) => void
}) {
  const next = useRef(2)
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    const saved = savedTabs.get(projectId)?.[0]
    const tab: Tab = { key: 1, shell: 'Terminal', cwd: saved?.cwd ?? projectPath, customTitle: saved?.customTitle,
      task: taskRequest?.task, taskState: taskRequest ? { type: 'running' } : undefined }
    return { tabs: [tab], visible: [1], active: 1, axis: 'horizontal' as const }
  })
  const controls = useRef(new Map<number, Controls>())
  const panel = useRef<HTMLElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [showSearch, setShowSearch] = useState(false)
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<number | null>(null)
  const cancelRename = useRef(false)
  const [rename, setRename] = useState('')
  const [tabMenu, setTabMenu] = useState<{ kind: 'tab' | 'split'; key?: number; x: number; y: number } | null>(null)
  const [maximized, setMaximized] = useState(false)
  const height = useTerminalHeight()
  const drag = useRef<{ y: number; height: number } | null>(null)
  const folder = projectPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || projectPath || tr('Dự án')
  const titleOf = (tab: Tab) => tab.customTitle || (tab.task ? tab.task.label : `${folder} — ${tab.shell}`)
  const add = (task?: TaskDefinition, split = false, direction: TerminalSplitDirection = 'right') => {
    dispatch({ type: 'add', split, direction, tab: { key: next.current++, shell: 'Terminal', cwd: projectPath, task, taskState: task ? { type: 'running' } : undefined } })
  }
  const newTerminal = () => { add(); onNewTerminal?.() }
  const splitTerminal = (direction: TerminalSplitDirection) => {
    if (state.visible.length >= 2) return
    add(undefined, true, direction)
    onSplitTerminal?.(direction)
  }
  const rerunTask = (tab: Tab) => { if (tab.task) { add(tab.task); onRerunTask?.(tab.task) } }
  const closeTab = (tab: Tab) => {
    const running = tab.taskState?.type === 'running'
    if (running && !window.confirm(tr('Terminal “{title}” đang chạy. Đóng terminal này?', { title: titleOf(tab) }))) return
    dispatch({ type: 'close', key: tab.key })
    onCloseTerminal?.(!!running)
  }
  const commitRename = (key: number, title: string) => {
    dispatch({ type: 'rename', key, title })
    onRenameTerminal?.(title)
  }
  const toggleMaximize = () => {
    const maximizedNext = !maximized
    setMaximized(maximizedNext)
    onZoomChange?.(maximizedNext)
  }
  const seenNew = useRef(newRequest)
  useEffect(() => {
    if (newRequest === seenNew.current) return
    seenNew.current = newRequest
    add()
  }, [newRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  const seenTask = useRef<number | null>(taskRequest?.seq ?? null)
  useEffect(() => {
    if (!taskRequest || taskRequest.seq === seenTask.current) return
    seenTask.current = taskRequest.seq
    add(taskRequest.task)
  }, [taskRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!state.tabs.length) onCloseAll() }, [state.tabs.length, onCloseAll])
  useEffect(() => { savedTabs.set(projectId, state.tabs.map(({ cwd, customTitle }) => ({ cwd, customTitle }))) }, [projectId, state.tabs])
  useEffect(() => { onTabCountChange?.(state.tabs.length) }, [state.tabs.length, onTabCountChange])
  useEffect(() => {
    if (!tabMenu) return
    const close = () => setTabMenu(null)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [tabMenu])

  const activeControls = () => state.active === null ? undefined : controls.current.get(state.active)
  const openSearch = (seedSelection: boolean) => {
    const selected = seedSelection ? activeControls()?.selection() : ''
    if (selected) {
      setQuery(selected)
    }
    setShowSearch(true)
    searchInput.current?.focus()
  }
  const closeSearch = () => {
    activeControls()?.clearSearch()
    setShowSearch(false)
    setQuery('')
    activeControls()?.focus()
  }
  useEffect(() => {
    if (showSearch) {
      searchInput.current?.focus()
      activeControls()?.search(query, false, true)
    }
  }, [showSearch, state.active, query]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (hidden || !(event.target instanceof Node) || !panel.current?.contains(event.target)) return
      if (event.key === 'Escape' && event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault(); event.stopPropagation()
        toggleMaximize()
        return
      }
      const target = event.target instanceof Element ? event.target : null
      if (!target?.closest('.terminal-view, .terminal-search') || !modified(event) || event.shiftKey || event.altKey) return
      switch (event.key.toLowerCase()) {
        case 'd':
          if (!target.closest('.terminal-view')) return
          event.preventDefault(); event.stopPropagation()
          splitTerminal('right')
          break
        case 'f':
          event.preventDefault(); event.stopPropagation()
          openSearch(!!target.closest('.terminal-view'))
          break
        case 'k':
          event.preventDefault(); event.stopPropagation()
          activeControls()?.clear()
          break
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [hidden, state.active, state.visible.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Kho tuỳ chọn tự áp giới hạn dưới và làm tròn; ở đây chỉ chặn để panel không ăn hết cửa sổ.
  const resize = (value: number) => setTerminalHeight(Math.min(window.innerHeight - 200, value))
  const toggleRename = (tab: Tab) => { setRename(titleOf(tab)); setRenaming(tab.key) }
  const activeTab = state.tabs.find((tab) => tab.key === state.active)
  const menuTab = tabMenu?.key === undefined ? undefined : state.tabs.find((tab) => tab.key === tabMenu.key)
  return (
    <section ref={panel} className="terminal-panel" aria-label="Terminal" hidden={hidden} data-maximized={maximized || undefined}
      style={{ '--terminal-height': `${height}px` } as CSSProperties}>
      {!maximized && <div className="terminal-resize" role="separator" aria-orientation="horizontal" aria-label={tr('Chiều cao terminal')} tabIndex={0}
        onPointerDown={(event) => { drag.current = { y: event.clientY, height }; event.currentTarget.setPointerCapture(event.pointerId) }}
        onPointerMove={(event) => { if (drag.current) resize(drag.current.height + drag.current.y - event.clientY) }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); resize(height + (event.key === 'ArrowUp' ? 20 : -20)) } }} />}
      <div className="terminal-tabs">
        <div className="terminal-tab-list" role="tablist" aria-label={tr('Các terminal')}>
          {state.tabs.map((tab) => {
            const title = titleOf(tab)
            const status = tab.taskState?.type === 'running' ? tr('Đang chạy')
              : tab.taskState?.type === 'error' ? tr('Không khởi chạy')
                : tab.taskState?.type === 'exited' ? `${tab.taskState.code === 0 ? tr('Thành công') : tr('Thất bại')} (${tab.taskState.code})` : null
            return <span key={tab.key} className="terminal-tab" data-active={tab.key === state.active || undefined}>
              {renaming === tab.key ? <input className="terminal-rename" aria-label={tr('Tên terminal')} value={rename} autoFocus
                onFocus={(event) => event.currentTarget.select()} onChange={(event) => setRename(event.target.value)}
                onBlur={() => {
                  if (!cancelRename.current) commitRename(tab.key, rename.trim())
                  cancelRename.current = false
                  setRenaming(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); controls.current.get(tab.key)?.focus() }
                  else if (event.key === 'Escape') { event.preventDefault(); cancelRename.current = true; event.currentTarget.blur(); controls.current.get(tab.key)?.focus() }
                }} /> : <button type="button" role="tab" aria-selected={tab.key === state.active} title={status ? `${title} — ${status}` : title}
                  onClick={() => dispatch({ type: 'select', key: tab.key })} onDoubleClick={() => toggleRename(tab)}
                  onContextMenu={(event) => { event.preventDefault(); dispatch({ type: 'select', key: tab.key }); setTabMenu({ kind: 'tab', key: tab.key, x: event.clientX, y: event.clientY }) }}>
                  <TaskIcon state={tab.taskState} /><span className="terminal-tab-title">{title}</span>
                  {status && <span className="terminal-task-status" data-status={tab.taskState?.type === 'exited' ? (tab.taskState.code === 0 ? 'success' : 'failed') : tab.taskState?.type}>{status}</span>}
                </button>}
              <button type="button" className="terminal-tab-close" aria-label={tr('Đóng {title}', { title })} onClick={() => closeTab(tab)}><Icon name="close" size={11} /></button>
            </span>
          })}
        </div>
        <button type="button" className="terminal-icon" aria-label={tr('Terminal mới')} title={tr('Terminal mới (⌃⇧`)')} onClick={newTerminal}><Icon name="plus" size={14} /></button>
        <button type="button" className="terminal-icon" aria-label={tr('Chia terminal')} title={tr('Chia terminal (⌘D)')} disabled={state.visible.length >= 2}
          onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setTabMenu({ kind: 'split', x: box.left, y: box.bottom }) }}><Icon name="panelRight" size={14} /></button>
        <span className="terminal-count" aria-label={tr('Số terminal')} title={tr('Số terminal')}>{state.tabs.length}</span>
        <span className="terminal-spacer" />
        <button type="button" className="terminal-icon" aria-label={tr('Đổi tên terminal')} title={tr('Đổi tên terminal')} disabled={!activeTab} onClick={() => { if (activeTab) toggleRename(activeTab) }}><Icon name="pencil" size={14} /></button>
        <button type="button" className="terminal-icon" aria-label={tr('Tìm trong terminal')} title={tr('Tìm trong terminal (⌘F)')} onClick={() => openSearch(true)}><Icon name="search" size={14} /></button>
        <button type="button" className="terminal-icon" aria-label={maximized ? tr('Khôi phục terminal') : tr('Phóng to terminal')} title={`${maximized ? tr('Khôi phục') : tr('Phóng to')} terminal (⇧Esc)`} aria-pressed={maximized}
          onClick={toggleMaximize}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {maximized ? <path d="M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5" /> : <path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5" />}
          </svg></button>
        <button type="button" className="terminal-icon" aria-label={tr('Ẩn terminal')} title={tr('Ẩn terminal (⌃`)')} onClick={onHide}><Icon name="close" size={14} /></button>
      </div>
      {tabMenu && <div role="menu" className="terminal-tab-menu" style={{ left: tabMenu.x, top: tabMenu.y }}
        onPointerDown={(event) => event.stopPropagation()}>
        {tabMenu.kind === 'split' ? (['right', 'left', 'up', 'down'] as const).map((direction) =>
          <button key={direction} type="button" role="menuitem" onClick={() => { setTabMenu(null); splitTerminal(direction) }}>
            {tr('Chia sang {direction}', { direction: { right: tr('phải'), left: tr('trái'), up: tr('trên'), down: tr('dưới') }[direction] })}
          </button>) : <>
          <button type="button" role="menuitem" onClick={() => { setTabMenu(null); if (menuTab) toggleRename(menuTab) }}>{tr('Đổi tên')}</button>
          {menuTab?.task && <button type="button" role="menuitem" onClick={() => { setTabMenu(null); rerunTask(menuTab) }}>{tr('Chạy lại')}</button>}
          <button type="button" role="menuitem" onClick={() => { setTabMenu(null); if (menuTab) closeTab(menuTab) }}>{tr('Đóng')}</button>
        </>}
      </div>}
      <div className="terminal-body" data-axis={state.axis}>
        {state.tabs.map((tab) => <TerminalView key={tab.key} projectId={projectId} tab={tab} title={titleOf(tab)}
          visible={state.visible.includes(tab.key)} focused={tab.key === state.active} hidden={hidden}
          pane={state.visible.indexOf(tab.key)} split={state.visible.length > 1} controls={controls.current}
          onSelect={() => dispatch({ type: 'select', key: tab.key })} onClose={() => closeTab(tab)}
          onReady={(shell) => dispatch({ type: 'ready', key: tab.key, shell })}
          onExit={(code) => dispatch({ type: 'exit', key: tab.key, code })}
          onError={() => dispatch({ type: 'error', key: tab.key })} onOpenFile={onOpenFile} />)}
        {showSearch && <div className="terminal-search" role="search" aria-label={tr('Tìm trong terminal')}>
          <input ref={searchInput} aria-label={tr('Từ cần tìm trong terminal')} value={query} placeholder={tr('Tìm trong terminal')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); activeControls()?.search(query, event.shiftKey) }
              else if (event.key === 'Escape' && !event.shiftKey) { event.preventDefault(); closeSearch() }
            }} />
          <button type="button" className="terminal-icon terminal-search-previous" aria-label={tr('Kết quả trước')} title={tr('Kết quả trước (⇧Enter)')} onClick={() => activeControls()?.search(query, true)}><Icon name="chevron" size={14} /></button>
          <button type="button" className="terminal-icon terminal-search-next" aria-label={tr('Kết quả tiếp theo')} title={tr('Kết quả tiếp theo (Enter)')} onClick={() => activeControls()?.search(query)}><Icon name="chevron" size={14} /></button>
          <button type="button" className="terminal-icon" aria-label={tr('Đóng tìm kiếm')} onClick={closeSearch}><Icon name="close" size={14} /></button>
        </div>}
      </div>
    </section>
  )
}
