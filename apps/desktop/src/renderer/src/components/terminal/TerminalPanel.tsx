import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Icon } from '../common/icons'
import { observeTheme } from '../../state/useTheme'
import './terminal.css'
import { errorText } from '../../state/errorText'

type Tab = { key: number; title: string }

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
// Màu terminal lấy từ token của app như editor: nền và chữ theo theme đang dùng.
const xtermTheme = () => ({ background: css('--color-surface') || '#1e1e1e', foreground: css('--color-text') || '#d4d4d4', cursor: css('--color-text') || '#d4d4d4', selectionBackground: css('--accent-soft') || '#264f78' })

/** Một phiên: xterm.js trong renderer nối với pty ở main qua IPC terminal:*. */
function TerminalView({ projectId, active, onTitle, onExit }: { projectId: string; active: boolean; onTitle: (title: string) => void; onExit: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const fit = useRef<FitAddon | null>(null)
  const term = useRef<Terminal | null>(null)
  const callbacks = useRef({ onTitle, onExit })
  callbacks.current = { onTitle, onExit }

  useEffect(() => {
    const api = window.nexgraph.terminal
    if (!api || !host.current) return
    const font = css('--font-mono')
    const xterm = new Terminal({ fontSize: 12, fontFamily: font || 'monospace', cursorBlink: true, allowProposedApi: false, theme: xtermTheme(), scrollback: 5000 })
    const fitter = new FitAddon()
    xterm.loadAddon(fitter)
    xterm.open(host.current)
    fitter.fit()
    term.current = xterm
    fit.current = fitter
    let id: number | null = null
    let alive = true
    const off = api.onEvent((event) => {
      if (event.id !== id) return
      if (event.type === 'data') xterm.write(event.data)
      else callbacks.current.onExit()
    })
    const stopTheme = observeTheme(() => { xterm.options.theme = xtermTheme() })
    const input = xterm.onData((data) => { if (id !== null) void api.write(id, data) })
    const titled = xterm.onTitleChange((title) => callbacks.current.onTitle(title))
    const resized = xterm.onResize(({ cols, rows }) => { if (id !== null) void api.resize(id, cols, rows) })
    api.create(projectId, xterm.cols, xterm.rows).then((session) => {
      if (!alive) return void api.kill(session.id)
      id = session.id
      callbacks.current.onTitle(session.shell)
    }).catch((e: unknown) => xterm.write(`\r\nKhông mở được terminal: ${errorText(e)}\r\n`))
    const observer = new ResizeObserver(() => { if (host.current?.offsetParent) fitter.fit() })
    observer.observe(host.current)
    return () => {
      alive = false
      observer.disconnect()
      off(); stopTheme(); input.dispose(); titled.dispose(); resized.dispose()
      if (id !== null) void api.kill(id)
      xterm.dispose()
    }
  }, [projectId])

  useEffect(() => {
    if (!active) return
    fit.current?.fit()
    term.current?.focus()
  }, [active])

  return <div ref={host} className="terminal-view" data-active={active || undefined} />
}

/** Bảng terminal ở đáy vùng giữa kiểu Wu: hàng thẻ (một thẻ mỗi phiên), nút thêm và đóng; ẩn bảng thì các phiên vẫn chạy. */
export function TerminalPanel({ projectId, newRequest, hidden, onHide, onCloseAll }: { projectId: string; newRequest: number; hidden: boolean; onHide: () => void; onCloseAll: () => void }) {
  const next = useRef(1)
  const [tabs, setTabs] = useState<Tab[]>(() => [{ key: next.current++, title: 'Terminal' }])
  const [active, setActive] = useState(tabs[0].key)
  const add = () => {
    const key = next.current++
    setTabs((cur) => [...cur, { key, title: 'Terminal' }])
    setActive(key)
  }
  // So với giá trị đã xử lý (không dùng cờ "lần đầu"): StrictMode chạy effect hai lần sẽ mở thừa một thẻ.
  const seen = useRef(newRequest)
  useEffect(() => {
    if (newRequest === seen.current) return
    seen.current = newRequest
    add()
  }, [newRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = (key: number) => {
    setTabs((cur) => {
      const rest = cur.filter((tab) => tab.key !== key)
      if (rest.length === 0) onCloseAll()
      else if (key === active) setActive(rest[rest.length - 1].key)
      return rest
    })
  }
  const [height, setHeight] = useState(() => { try { return Math.max(120, Number(localStorage.getItem('nexgraph.terminal.height')) || 280) } catch { return 280 } })
  const drag = useRef<{ y: number; height: number } | null>(null)
  const resize = (value: number) => {
    const clamped = Math.round(Math.max(120, Math.min(window.innerHeight - 200, value)))
    setHeight(clamped)
    try { localStorage.setItem('nexgraph.terminal.height', String(clamped)) } catch { /* chỉ là tuỳ chọn */ }
  }
  return (
    <section className="terminal-panel" aria-label="Terminal" hidden={hidden} style={{ '--terminal-height': `${height}px` } as CSSProperties}>
      <div className="terminal-resize" role="separator" aria-orientation="horizontal" aria-label="Chiều cao terminal" tabIndex={0}
        onPointerDown={(event) => { drag.current = { y: event.clientY, height }; event.currentTarget.setPointerCapture(event.pointerId) }}
        onPointerMove={(event) => { if (drag.current) resize(drag.current.height + drag.current.y - event.clientY) }}
        onPointerUp={() => { drag.current = null }}
        onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); resize(height + (event.key === 'ArrowUp' ? 20 : -20)) } }} />
      <div className="terminal-tabs" role="tablist" aria-label="Các terminal">
        {tabs.map((tab) => (
          <span key={tab.key} className="terminal-tab" data-active={tab.key === active || undefined}>
            <button type="button" role="tab" aria-selected={tab.key === active} onClick={() => setActive(tab.key)}><Icon name="terminal" size={13} /><span>{tab.title}</span></button>
            <button type="button" className="terminal-tab-close" aria-label={`Đóng ${tab.title}`} onClick={() => close(tab.key)}><Icon name="close" size={11} /></button>
          </span>
        ))}
        <button type="button" className="terminal-icon" aria-label="Terminal mới" title="Terminal mới (⌃⇧`)" onClick={add}><Icon name="plus" size={14} /></button>
        <span className="terminal-spacer" />
        <button type="button" className="terminal-icon" aria-label="Ẩn terminal" title="Ẩn terminal (⌃`)" onClick={onHide}><Icon name="close" size={14} /></button>
      </div>
      <div className="terminal-body">
        {tabs.map((tab) => (
          <TerminalView key={tab.key} projectId={projectId} active={!hidden && tab.key === active}
            onTitle={(title) => setTabs((cur) => cur.map((item) => (item.key === tab.key ? { ...item, title } : item)))}
            onExit={() => close(tab.key)} />
        ))}
      </div>
    </section>
  )
}
