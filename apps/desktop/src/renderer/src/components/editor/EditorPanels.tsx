import { useEffect, useRef, useState } from 'react'
import type { LspDiagnostic, LspDocumentSymbol } from '@shared/api'
import type { ActiveEditor } from '../../state/activeEditor'
import { refreshDiagnostics, useDiagnostics } from '../../state/diagnostics'
import { errorMsg } from '../../state/errorText'
import { msgText, type Message } from '../../state/messages'
import { fuzzyMatch } from '../../state/fuzzy'
import { smallestSymbolAt } from '../../state/syntaxSelection'
import { tr } from '../../strings'
import './editor-tools.css'

export type OpenEditorLocation = (file: string, line: number, column?: number) => void

export function useDocumentSymbols(projectId: string, editor: ActiveEditor | null): { symbols: LspDocumentSymbol[]; error: Message | null } {
  const [result, setResult] = useState<{ editor: ActiveEditor | null; symbols: LspDocumentSymbol[]; error: Message | null }>({ editor: null, symbols: [], error: null })
  useEffect(() => {
    if (!editor) return
    let live = true
    let serial = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      const request = ++serial
      const api = window.nexgraph?.lsp?.documentSymbols
      if (!api) { setResult({ editor, symbols: [], error: null }); return }
      void Promise.resolve().then(() => api(projectId, editor.file, editor.text())).then((symbols) => {
        if (live && request === serial) setResult({ editor, symbols, error: null })
      }).catch((error: unknown) => {
        if (live && request === serial) setResult({ editor, symbols: [], error: errorMsg(error) })
      })
    }
    load()
    const off = editor.handle.watchChanges?.(() => {
      serial++
      clearTimeout(timer)
      timer = setTimeout(load, 200)
    })
    return () => { live = false; clearTimeout(timer); off?.() }
  }, [projectId, editor])
  return result.editor === editor ? result : { symbols: [], error: null }
}

function symbolMatches(symbol: LspDocumentSymbol, query: string): boolean {
  return !!fuzzyMatch(query, symbol.name) || !!symbol.children?.some((child) => symbolMatches(child, query))
}

const symbolKey = (symbol: LspDocumentSymbol): string =>
  `${symbol.kind}:${symbol.name}:${symbol.range.start.line}:${symbol.range.start.character}:${symbol.range.end.line}:${symbol.range.end.character}`

function allKeys(symbols: readonly LspDocumentSymbol[]): string[] {
  return symbols.flatMap((symbol) => [symbolKey(symbol), ...allKeys(symbol.children ?? [])])
}

/** Khoá của nút đang chứa con trỏ và các nút cha, để tự mở đường tới ký hiệu đó. */
function symbolPath(symbols: readonly LspDocumentSymbol[], target: LspDocumentSymbol): string[] {
  for (const symbol of symbols) {
    if (symbol === target) return [symbolKey(symbol)]
    const nested = symbolPath(symbol.children ?? [], target)
    if (nested.length) return [symbolKey(symbol), ...nested]
  }
  return []
}

interface ListProps {
  symbols: LspDocumentSymbol[]
  query: string
  collapsed: string[]
  active: LspDocumentSymbol | null
  onPick: (symbol: LspDocumentSymbol) => void
  onToggle: (key: string) => void
  register: (key: string, node: HTMLButtonElement | null) => void
}

function SymbolList({ symbols, query, collapsed, active, onPick, onToggle, register }: ListProps) {
  return <ul>{symbols.filter((symbol) => symbolMatches(symbol, query)).map((symbol) => {
    const key = symbolKey(symbol)
    const children = symbol.children ?? []
    const isCollapsed = collapsed.includes(key)
    return <li key={key}>
      <span className="outline-row">
        {children.length > 0 && <button type="button" aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? tr('Mở rộng') : tr('Thu gọn')} ${symbol.name}`} onClick={() => onToggle(key)}>{isCollapsed ? '▸' : '▾'}</button>}
        <button ref={(node) => register(key, node)} type="button" className={active === symbol ? 'outline-active' : undefined} style={active === symbol ? { background: 'var(--accent-soft)' } : undefined} data-symbol-key={key} title={symbol.name} onClick={() => onPick(symbol)}>{symbol.name}</button>
      </span>
      {children.length > 0 && !isCollapsed && <SymbolList symbols={children} query={query} collapsed={collapsed} active={active} onPick={onPick} onToggle={onToggle} register={register} />}
    </li>
  })}</ul>
}

type PinnedOutline = { editor: ActiveEditor; symbols: LspDocumentSymbol[]; error: Message | null }

export function OutlinePanel({ editor, symbols, error }: { editor: ActiveEditor | null; symbols: LspDocumentSymbol[]; error: Message | null }) {
  const [query, setQuery] = useState('')
  const [pinned, setPinned] = useState<PinnedOutline | null>(null)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [cursor, setCursor] = useState<{ line: number; character: number } | null>(null)
  const rows = useRef(new Map<string, HTMLButtonElement>())
  const revealed = useRef<string | null>(null)
  const shown = pinned ?? { editor, symbols, error }
  const activeSymbol = cursor ? smallestSymbolAt(shown.symbols, cursor) : null

  useEffect(() => {
    revealed.current = null
    const target = shown.editor
    if (!target) { setCursor(null); return }
    const position = target.handle.getPosition?.()
    setCursor(position ? { line: position.line, character: position.column - 1 } : null)
    return target.handle.onCursor?.((line, column) => setCursor({ line: line - 1, character: column - 1 }))
  }, [shown.editor])

  useEffect(() => {
    if (!activeSymbol) { revealed.current = null; return }
    const key = symbolKey(activeSymbol)
    if (revealed.current === key) return
    revealed.current = key
    const path = symbolPath(shown.symbols, activeSymbol)
    setCollapsed((current) => path.some((item) => current.includes(item)) ? current.filter((item) => !path.includes(item)) : current)
  }, [activeSymbol, shown.symbols])

  useEffect(() => {
    if (!activeSymbol) return
    const node = rows.current.get(symbolKey(activeSymbol))
    if (typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [activeSymbol, shown.symbols, collapsed])

  const visible = shown.symbols.filter((symbol) => symbolMatches(symbol, query))
  const keys = allKeys(visible)
  const allCollapsed = keys.length > 0 && keys.every((key) => collapsed.includes(key))
  return <div className="editor-outline">
    <div className="outline-filter" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input type="search" aria-label={tr('Tìm ký hiệu')} placeholder={tr('Tìm ký hiệu…')} value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="button" aria-label={tr('Xóa bộ lọc')} title={tr('Xóa bộ lọc')} disabled={!query} onClick={() => setQuery('')}>✕</button>
    </div>
    <div className="outline-actions" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
      <button type="button" aria-pressed={!!pinned} disabled={!editor && !pinned} onClick={() => setPinned(pinned ? null : editor ? { editor, symbols, error } : null)}>
        {pinned ? tr('Bỏ ghim') : tr('Ghim editor')}
      </button>
      <button type="button" disabled={keys.length === 0} onClick={() => setCollapsed(allCollapsed ? [] : keys)}>
        {allCollapsed ? tr('Mở rộng tất cả') : tr('Thu gọn tất cả')}
      </button>
    </div>
    {!shown.editor ? <p className="muted">{tr('Mở một tệp để xem ký hiệu.')}</p> : shown.error ? <p role="alert">{msgText(shown.error)}</p> :
      shown.symbols.length === 0 ? <p className="muted">{tr('Không có ký hiệu trong tệp.')}</p> :
      <SymbolList symbols={shown.symbols} query={query} collapsed={collapsed} active={activeSymbol}
        register={(key, node) => { if (node) rows.current.set(key, node); else rows.current.delete(key) }}
        onPick={(symbol) => {
          const { line, character } = symbol.selectionRange.start
          if (shown.editor?.handle.revealPosition) shown.editor.handle.revealPosition(line + 1, character + 1)
          else shown.editor?.handle.revealLines(line + 1)
        }}
        onToggle={(key) => setCollapsed((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} />}
  </div>
}

const ackKey = (projectId: string) => `nexgraph.diagnostics.ack:${projectId}`
const readAcked = (projectId: string): Set<string> => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(ackKey(projectId)) ?? '[]')
    return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : [])
  } catch { return new Set() }
}

export function DiagnosticsPanel({ projectId, onOpen }: { projectId: string; onOpen: OpenEditorLocation }) {
  const diagnostics = useDiagnostics(projectId)
  const [acked, setAcked] = useState(() => readAcked(projectId))
  const [includeWarnings, setIncludeWarnings] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const loaded = useRef(projectId)
  useEffect(() => {
    if (loaded.current === projectId) return
    loaded.current = projectId
    setAcked(readAcked(projectId))
  }, [projectId])

  const files = Object.entries(diagnostics)
    .map(([file, items]) => [file, includeWarnings ? items : items.filter((item) => item.severity !== 2)] as [string, LspDiagnostic[]])
    .filter(([, items]) => items.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try { await refreshDiagnostics(projectId) }
    finally { setRefreshing(false) }
  }
  const acknowledge = (file: string, line: number) => {
    const next = new Set(acked).add(`${file}:${line}`)
    setAcked(next)
    try { localStorage.setItem(ackKey(projectId), JSON.stringify([...next])) } catch { /* chỉ là tuỳ chọn */ }
  }
  const row = (file: string, item: LspDiagnostic, seen: boolean, index: number) => {
    const { line, character } = item.range.start
    const severity = item.severity === 2 ? tr('Cảnh báo') : item.severity === 3 ? tr('Thông tin') : item.severity === 4 ? tr('Gợi ý') : tr('Lỗi')
    return <li key={`${line}:${character}:${index}`} className={seen ? 'diagnostic-seen' : undefined} style={seen ? { opacity: 0.6 } : undefined}>
      <button type="button" onClick={() => onOpen(file, line + 1, character + 1)}>
        <span>{severity}: {item.message}</span><small>{line + 1}:{character + 1}{item.source ? ` · ${item.source}` : ''}</small>
      </button>
      {!seen && <button type="button" onClick={() => acknowledge(file, line)}>{tr('Đã xem')}</button>}
    </li>
  }
  return <div className="editor-diagnostics">
    <div className="editor-tool-actions" style={{ justifyContent: 'flex-start', margin: '6px 0' }}>
      <button type="button" aria-pressed={includeWarnings} title={tr('Bao gồm cảnh báo')}
        style={{ width: 'auto', display: 'inline-flex', padding: '3px 6px' }}
        onClick={() => setIncludeWarnings((value) => !value)}>{tr('Bao gồm cảnh báo')}</button>
      <button type="button" disabled={refreshing} title={tr('Làm mới chẩn đoán')} aria-label={tr('Làm mới chẩn đoán')}
        style={{ width: 'auto', display: 'inline-flex', padding: '3px 6px' }}
        onClick={() => void refresh()}>{refreshing ? tr('Đang làm mới…') : tr('Làm mới')}</button>
    </div>
    {files.length === 0 ? <p className="muted">{tr('Không có lỗi trong dự án')}</p> : files.map(([file, items]) => {
      const unseen = items.filter((item) => !acked.has(`${file}:${item.range.start.line}`))
      const seen = items.filter((item) => acked.has(`${file}:${item.range.start.line}`))
      return <section key={file}>
        <h3 title={file}>{file} <small>({unseen.length})</small></h3>
        <ul aria-label={tr('Chưa xem')}>{unseen.map((item, index) => row(file, item, false, index))}</ul>
        {seen.length > 0 && <>
          <h4>{tr('Đã xem')} ({seen.length})</h4>
          <ul aria-label={tr('Đã xem')}>{seen.map((item, index) => row(file, item, true, index))}</ul>
        </>}
      </section>
    })}
  </div>
}
