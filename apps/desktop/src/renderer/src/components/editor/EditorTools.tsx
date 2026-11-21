import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { LspCallHierarchyCall, LspCallHierarchyItem, LspDocumentSymbol, LspLocation, LspWorkspaceSymbol } from '@shared/api'
import { tr } from '../../strings'
import { useCommand } from '../../state/commands'
import type { ActiveEditor } from '../../state/activeEditor'
import { errorText } from '../../state/errorText'
import { largerSymbolAt, positionInRange, previousFromHistory, siblingSymbol, smallestSymbolAt } from '../../state/syntaxSelection'
import { Highlight, Picker } from '../layout/Picker'
import * as editorMonaco from './monaco'
import { parseGoToLine } from './goToLine'
import { getEditorPrefs, setEditorPrefs } from '../../state/editorPrefs'
import type { OpenEditorLocation } from './EditorPanels'
import './editor-tools.css'

type HierarchyRow = { key: string; item: LspCallHierarchyItem; name: string; file: string; line: number; column: number; isCall: boolean }
type HierarchyMode = { kind: 'hierarchy'; direction: 'incoming' | 'outgoing'; roots: HierarchyRow[]; stack: LspCallHierarchyItem[]; rows: HierarchyRow[]; status: string }
type Mode =
  | { kind: 'goto' | 'rename' | 'document'; editor: ActiveEditor }
  | { kind: 'workspace' }
  | { kind: 'locations'; title: string; locations: LspLocation[] }
  | HierarchyMode
type SymbolRow = { id: string; symbol: LspDocumentSymbol }

function flattenSymbols(symbols: LspDocumentSymbol[], prefix = ''): SymbolRow[] {
  return symbols.flatMap((symbol, index) => {
    const id = `${prefix}/${index}`
    return [{ id, symbol }, ...flattenSymbols(symbol.children ?? [], id)]
  })
}

function GoToLineDialog({ editor, close }: { editor: ActiveEditor; close: (restore?: boolean) => void }) {
  const [position] = useState(() => editor.handle.getPosition?.() ?? { line: 1, column: 1 })
  const [lineCount] = useState(() => editor.handle.getLineCount?.() ?? editor.text().split('\n').length)
  const [scroll] = useState(() => editor.handle.getScrollPosition?.())
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const committed = useRef(false)
  useEffect(() => () => {
    editor.handle.clearPreview?.()
    if (!committed.current && scroll) editor.handle.setScrollPosition?.(scroll)
  }, [editor, scroll])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const target = parseGoToLine(value, position.line, lineCount)
    if (!target) { setInvalid(true); return }
    committed.current = true
    editor.handle.clearPreview?.()
    if (editor.handle.revealPosition) editor.handle.revealPosition(target.line, target.column)
    else editor.handle.revealLines(target.line)
    close()
  }
  return <div className="picker-layer" onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <form className="picker editor-tool-dialog" role="dialog" aria-modal="true" aria-label={tr('Đi đến dòng')} onSubmit={submit} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close() } }}>
      <label htmlFor="goto-line-input">{tr('Đi đến dòng')}</label>
      <input id="goto-line-input" autoFocus value={value} placeholder={tr('Dòng[:cột] hoặc +/- số dòng')} aria-describedby="goto-line-help" aria-invalid={invalid}
        onChange={(event) => {
          const next = event.target.value
          setValue(next)
          setInvalid(false)
          const target = parseGoToLine(next, position.line, lineCount)
          if (target) editor.handle.previewPosition?.(target.line)
          else { editor.handle.clearPreview?.(); if (scroll) editor.handle.setScrollPosition?.(scroll) }
        }} />
      <p id="goto-line-help">{tr('Dòng hiện tại: {line} / {lineCount} (cột {column})', { line: position.line, lineCount, column: position.column })}</p>
      {invalid && <p className="editor-tool-error" role="alert">{tr('Nhập dòng hoặc dòng:cột hợp lệ.')}</p>}
      <div className="editor-tool-actions"><button type="button" onClick={() => close()}>{tr('Hủy')}</button><button type="submit">{tr('Đi đến')}</button></div>
    </form>
  </div>
}

function RenameDialog({ projectId, editor, close }: { projectId: string; editor: ActiveEditor; close: (restore?: boolean) => void }) {
  const [position] = useState(() => editor.handle.getPosition?.())
  const [name, setName] = useState(() => editor.handle.getWordAtCursor?.() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.select() }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!name.trim()) { setError(tr('Nhập tên mới.')); return }
    if (!position || !window.nexgraph?.lsp?.rename) { setError(tr('Không thể đổi tên ký hiệu trong tệp này.')); return }
    setBusy(true)
    setError(null)
    try {
      await editorMonaco.syncProjectModels(projectId)
      const text = editor.text()
      const edit = await window.nexgraph.lsp.rename(projectId, editor.file, text, position.line, position.column, name.trim())
      if (editor.text() !== text) throw new Error(tr('Tệp đã thay đổi trong khi đổi tên. Hãy thử lại.'))
      await editorMonaco.applyWorkspaceEdit(projectId, edit)
      close()
    } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <div className="picker-layer" onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) close() }}>
    <form className="picker editor-tool-dialog" role="dialog" aria-modal="true" aria-label={tr('Đổi tên ký hiệu')} onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); close() } }}>
      <label htmlFor="rename-symbol-input">{tr('Tên mới')}</label>
      <input id="rename-symbol-input" ref={input} autoFocus value={name} onChange={(event) => setName(event.target.value)} disabled={busy} aria-invalid={!!error} />
      {error && <p className="editor-tool-error" role="alert">{error}</p>}
      <div className="editor-tool-actions"><button type="button" disabled={busy} onClick={() => close()}>{tr('Hủy')}</button><button type="submit" disabled={busy}>{tr('Đổi tên')}</button></div>
    </form>
  </div>
}

function WorkspaceSymbolPicker({ projectId, onOpen, close }: { projectId: string; onOpen: OpenEditorLocation; close: (restore?: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [symbols, setSymbols] = useState<LspWorkspaceSymbol[]>([])
  const [status, setStatus] = useState(() => tr('Đang tìm ký hiệu…'))
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      const api = window.nexgraph?.lsp?.workspaceSymbols
      if (!api) { setStatus(tr('Không hỗ trợ tìm ký hiệu trong dự án.')); return }
      void Promise.resolve().then(() => api(projectId, query)).then((items) => {
        if (live) { setSymbols(items.slice(0, 100)); setStatus(tr('Không có ký hiệu khớp')) }
      }).catch((error: unknown) => { if (live) setStatus(errorText(error)) })
    }, 200)
    return () => { live = false; clearTimeout(timer) }
  }, [projectId, query])
  return <Picker label={tr('Tìm ký hiệu trong dự án')} placeholder={tr('Tìm ký hiệu trong dự án…')} items={symbols}
    itemKey={(item) => `${item.file}:${item.range.start.line}:${item.range.start.character}:${item.name}`} itemText={(item) => item.name}
    filter={(items) => items.map((item) => ({ item, positions: [] }))} onQueryChange={(value) => { setSymbols([]); setStatus(tr('Đang tìm ký hiệu…')); setQuery(value) }}
    empty={status} onCancel={() => close()} onPick={(symbol) => { close(false); onOpen(symbol.file, symbol.range.start.line + 1, symbol.range.start.character + 1) }}
    renderItem={(symbol) => <><span>{symbol.name}{symbol.containerName ? ` · ${symbol.containerName}` : ''}</span><small>{symbol.file}:{symbol.range.start.line + 1}</small></>} />
}

export function EditorTools({ projectId, editor, symbols, symbolsError, onOpen, onDiagnostics, onError }: {
  projectId: string; editor: ActiveEditor | null; symbols: LspDocumentSymbol[]; symbolsError: string | null
  onOpen: OpenEditorLocation; onDiagnostics: () => void; onError: (message: string) => void
}) {
  const [mode, setMode] = useState<Mode | null>(null)
  const syntaxState = useRef<{ file: string; symbols: LspDocumentSymbol[]; current: LspDocumentSymbol; history: LspDocumentSymbol[] } | null>(null)
  const hierarchySerial = useRef(0)
  const origin = useRef<HTMLElement | null>(null)
  const open = (next: Mode) => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setMode(next)
  }
  const close = (restore = true) => {
    hierarchySerial.current++
    setMode(null)
    if (restore) { const target = origin.current; window.setTimeout(() => { if (target?.isConnected) target.focus() }, 0) }
  }
  useEffect(() => { syntaxState.current = null }, [editor, symbols])
  useEffect(() => editor?.handle.watchChanges?.(() => { syntaxState.current = null }), [editor])
  const syntax = (kind: 'larger' | 'smaller' | 'next' | 'previous') => {
    if (!editor || !symbols.length || !editor.handle.selectRange) return
    const position = editor.handle.getPosition?.()
    if (!position) return
    const cursor = { line: position.line - 1, character: position.column - 1 }
    const state = syntaxState.current
    const cached = state && state.file === editor.file && state.symbols === symbols && positionInRange(state.current.range, cursor) ? state : null
    let current = cached?.current ?? smallestSymbolAt(symbols, cursor)
    let history = cached?.history ?? []
    if (!current) { syntaxState.current = null; return }
    if (kind === 'larger') {
      if (cached) {
        const parent = largerSymbolAt(symbols, current, cursor)
        if (!parent) return
        current = parent
      }
      history = [...history, current]
    } else if (kind === 'smaller') {
      const previous = previousFromHistory(history)
      if (!previous) return
      current = previous
      history = history.slice(0, -1)
    } else {
      const sibling = siblingSymbol(symbols, current, kind === 'next' ? 1 : -1)
      if (!sibling) return
      current = sibling
      history = []
    }
    // LSP là 0-based, selectRange nhận 1-based cho cả dòng lẫn cột.
    const { start, end } = current.range
    editor.handle.selectRange({ startLine: start.line + 1, startColumn: start.character + 1, endLine: end.line + 1, endColumn: end.character + 1 })
    syntaxState.current = { file: editor.file, symbols, current, history }
  }
  const loadCalls = async (direction: 'incoming' | 'outgoing', stack: LspCallHierarchyItem[], roots: HierarchyRow[]) => {
    const root = stack[stack.length - 1]
    if (!root) return
    const serial = ++hierarchySerial.current
    setMode({ kind: 'hierarchy', direction, roots, stack, rows: [], status: tr('Đang tải lời gọi…') })
    try {
      const api = window.nexgraph?.lsp
      if (!api?.callHierarchyIncoming || !api.callHierarchyOutgoing) { onError(tr('Phân cấp lời gọi không dùng được trong tệp này.')); return }
      const text = editor && root.file === editor.file ? editor.text() : await window.nexgraph?.fs?.read(projectId, root.file).then((read) => read.text)
      if (text === undefined) { onError(tr('Không đọc được tệp chứa ký hiệu.')); return }
      const line = root.range.start.line + 1
      const column = root.range.start.character + 1
      const calls: LspCallHierarchyCall[] = direction === 'incoming'
        ? await api.callHierarchyIncoming(projectId, root.file, text, line, column, root)
        : await api.callHierarchyOutgoing(projectId, root.file, text, line, column, root)
      if (serial !== hierarchySerial.current) return
      // Một caller có thể gọi nhiều lần: gộp các fromRanges để chỉ hiện một dòng có số lượt gọi.
      const groups = new Map<string, { call: LspCallHierarchyCall; ranges: LspCallHierarchyCall['fromRanges'] }>()
      for (const call of calls) {
        const from = call.from
        const key = `${from.file}:${from.range.start.line}:${from.range.start.character}:${from.name}`
        const group = groups.get(key)
        if (group) group.ranges.push(...call.fromRanges)
        else groups.set(key, { call, ranges: [...call.fromRanges] })
      }
      setMode((current) => current?.kind === 'hierarchy' && serial === hierarchySerial.current ? {
        ...current,
        rows: [...groups.values()].map(({ call, ranges }, index) => {
          const site = ranges[0]?.start ?? call.from.range.start
          const total = ranges.length
          return {
            key: `${call.from.file}:${call.from.range.start.line}:${call.from.range.start.character}:${index}`,
            item: call.from, name: total > 1 ? `${call.from.name} — ${call.from.file}${tr(' ({count} lời gọi)', { count: total })}` : call.from.name,
            file: call.from.file, line: site.line + 1, column: site.character + 1, isCall: true
          }
        }),
        status: calls.length ? '' : (direction === 'incoming' ? tr('Không có lời gọi vào.') : tr('Không có lời gọi ra.'))
      } : current)
    } catch (error) { if (serial === hierarchySerial.current) { onError(errorText(error)); close() } }
  }
  const hierarchy = async (direction: 'incoming' | 'outgoing') => {
    if (!editor) return
    const shown = mode?.kind === 'hierarchy' ? mode : null
    if (shown) {
      if (shown.direction === direction) close()
      else if (shown.stack.length) void loadCalls(direction, shown.stack, shown.roots)
      else setMode({ ...shown, direction })
      return
    }
    const position = editor.handle.getPosition?.()
    const api = window.nexgraph?.lsp
    if (!position || !api?.callHierarchyPrepare || !api.callHierarchyIncoming || !api.callHierarchyOutgoing) {
      onError(tr('Phân cấp lời gọi không dùng được trong tệp này.'))
      return
    }
    const serial = ++hierarchySerial.current
    try {
      const items = await api.callHierarchyPrepare(projectId, editor.file, editor.text(), position.line, position.column)
      if (serial !== hierarchySerial.current) return
      const rows: HierarchyRow[] = (items ?? []).map((item, index) => ({
        key: `${item.file}:${item.range.start.line}:${item.range.start.character}:${index}`,
        item, name: item.name, file: item.file,
        line: item.range.start.line + 1, column: item.range.start.character + 1, isCall: false
      }))
      open({ kind: 'hierarchy', direction, roots: rows, stack: [], rows, status: rows.length ? '' : tr('Không có ký hiệu gọi được tại con trỏ.') })
    } catch (error) { if (serial === hierarchySerial.current) onError(errorText(error)) }
  }
  const hierarchyBack = () => {
    const shown = mode?.kind === 'hierarchy' ? mode : null
    if (!shown || !shown.stack.length) return
    if (shown.stack.length === 1) {
      setMode({ ...shown, stack: [], rows: shown.roots, status: shown.roots.length ? '' : tr('Không có ký hiệu gọi được tại con trỏ.') })
      return
    }
    void loadCalls(shown.direction, shown.stack.slice(0, -1), shown.roots)
  }
  const hierarchyShowCalls = (shown: HierarchyMode, row: HierarchyRow) => {
    void loadCalls(shown.direction, row.isCall ? [...shown.stack, row.item] : [row.item], shown.roots)
  }
  const hierarchySwitch = (shown: HierarchyMode, row?: HierarchyRow) => {
    const direction = shown.direction === 'incoming' ? 'outgoing' : 'incoming'
    void loadCalls(direction, shown.stack.length ? shown.stack : row ? [row.item] : [], shown.roots)
  }
  const action = (id: string) => {
    if (!editor) return
    if (!editor.handle.runAction) return
    void editor.handle.runAction(id).catch((error: unknown) => onError(errorText(error)))
  }
  const locations = async (kind: 'references' | 'implementation') => {
    if (!editor) return
    const position = editor.handle.getPosition?.()
    const api = window.nexgraph?.lsp?.[kind]
    if (!position || !api) { onError(tr('Không hỗ trợ điều hướng ký hiệu trong tệp này.')); return }
    try {
      const found = await api(projectId, editor.file, editor.text(), position.line, position.column)
      if (!found.length) { onError(kind === 'references' ? tr('Không tìm thấy tham chiếu.') : tr('Không tìm thấy phần triển khai.')); return }
      if (found.length === 1) onOpen(found[0].file, found[0].line, found[0].column)
      else open({ kind: 'locations', title: kind === 'references' ? tr('Tham chiếu') : tr('Phần triển khai'), locations: found })
    } catch (error) { onError(errorText(error)) }
  }
  // Permalink kiểu Wu: vùng chọn (không có thì dòng con trỏ) tại commit HEAD trên remote; main quy số dòng về HEAD.
  const permalink = async (copy: boolean) => {
    if (!editor) return
    const api = window.nexgraph?.git
    if (!api) { onError(tr('Git không dùng được ở chế độ này.')); return }
    const selection = editor.handle.getSelection?.()
    const line = editor.handle.getPosition?.().line
    try {
      const { url, published } = await api.permalink(projectId, editor.file, selection?.start ?? line, selection?.end ?? line, editor.text())
      if (copy) await navigator.clipboard.writeText(url)
      else window.open(url, '_blank', 'noopener,noreferrer') // main chỉ mở http(s) (setWindowOpenHandler → externalWebUrl)
      if (!published) onError(tr('Lưu ý: commit HEAD chưa có trên remote nên liên kết có thể không mở được. Hãy push trước khi chia sẻ.'))
    } catch (error) { onError(errorText(error)) }
  }
  const copyTrimmed = async () => {
    if (!editor) return
    const position = editor.handle.getPosition?.()
    const source = editor.handle.getSelection?.()?.text
      ?? (position ? editor.text().split('\n')[position.line - 1] ?? '' : editor.text())
    const lines = source.replace(/\r\n?/g, '\n').split('\n')
    const indents = lines.filter((line) => line.trim()).map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0)
    const cut = indents.length ? Math.min(...indents) : 0
    const text = lines.map((line) => line.replace(/^[ \t]*/, (space) => space.slice(cut))).join(editor.handle.getEOL?.() ?? '\n')
    try { await navigator.clipboard.writeText(text) } catch (error) { onError(errorText(error)) }
  }
  useCommand('editor.goto_line', () => { if (editor) open({ kind: 'goto', editor }) }, !!editor)
  useCommand('editor.document_symbols', () => { if (editor) open({ kind: 'document', editor }) }, !!editor)
  useCommand('editor.workspace_symbols', () => open({ kind: 'workspace' }))
  useCommand('editor.diagnostics', onDiagnostics)
  useCommand('editor.rename', () => { if (editor) open({ kind: 'rename', editor }) }, !!editor)
  useCommand('editor.implementation', () => void locations('implementation'), !!editor)
  useCommand('editor.references', () => void locations('references'), !!editor)
  useCommand('editor.next_diagnostic', () => action('editor.action.marker.next'), !!editor)
  useCommand('editor.previous_diagnostic', () => action('editor.action.marker.prev'), !!editor)
  useCommand('editor.format', () => action('editor.action.formatDocument'), !!editor)
  useCommand('editor.code_actions', () => action('editor.action.quickFix'), !!editor)
  useCommand('editor.select_larger', () => syntax('larger'), !!editor)
  useCommand('editor.select_smaller', () => syntax('smaller'), !!editor)
  useCommand('editor.next_syntax', () => syntax('next'), !!editor)
  useCommand('editor.previous_syntax', () => syntax('previous'), !!editor)
  useCommand('editor.call_hierarchy_incoming', () => void hierarchy('incoming'), !!editor)
  useCommand('editor.call_hierarchy_outgoing', () => void hierarchy('outgoing'), !!editor)
  useCommand('hierarchy.back', () => hierarchyBack(), mode?.kind === 'hierarchy')
  useCommand('hierarchy.switch_direction', () => { if (mode?.kind === 'hierarchy') hierarchySwitch(mode, mode.rows[0]) }, mode?.kind === 'hierarchy')
  useCommand('git.copy_permalink', () => void permalink(true), !!editor)
  useCommand('git.open_permalink', () => void permalink(false), !!editor)
  useCommand('editor.toggle_line_numbers', () => setEditorPrefs({ lineNumbers: !getEditorPrefs().lineNumbers }))
  useCommand('editor.toggle_minimap', () => setEditorPrefs({ minimap: !getEditorPrefs().minimap }))
  useCommand('editor.toggle_soft_wrap', () => setEditorPrefs({ wordWrap: getEditorPrefs().wordWrap === 'on' ? 'off' : 'on' }))
  useCommand('editor.toggle_whitespace', () => {
    const modes = ['none', 'boundary', 'selection', 'trailing', 'all'] as const
    const current = getEditorPrefs().renderWhitespace
    setEditorPrefs({ renderWhitespace: modes[(modes.indexOf(current) + 1) % modes.length] })
  })
  useCommand('editor.toggle_sticky_scroll', () => setEditorPrefs({ stickyScroll: !getEditorPrefs().stickyScroll }))
  useCommand('editor.toggle_breadcrumbs', () => setEditorPrefs({ breadcrumbs: !getEditorPrefs().breadcrumbs }))
  useCommand('editor.toggle_inlay_hints', () => setEditorPrefs({ inlayHints: !getEditorPrefs().inlayHints }))
  useCommand('editor.toggle_semantic_highlights', () => setEditorPrefs({ semanticHighlighting: !getEditorPrefs().semanticHighlighting }))
  useCommand('editor.toggle_code_lens', () => setEditorPrefs({ codeLens: !getEditorPrefs().codeLens }))
  useCommand('editor.toggle_colorize_brackets', () => setEditorPrefs({ colorizeBrackets: !getEditorPrefs().colorizeBrackets }))
  useCommand('editor.select_next_occurrence', () => action('editor.action.addSelectionToNextFindMatch'), !!editor)
  useCommand('editor.select_all_occurrences', () => action('editor.action.selectHighlights'), !!editor)
  useCommand('editor.add_cursor_above', () => action('editor.action.insertCursorAbove'), !!editor)
  useCommand('editor.add_cursor_below', () => action('editor.action.insertCursorBelow'), !!editor)
  useCommand('editor.move_line_up', () => action('editor.action.moveLinesUpAction'), !!editor)
  useCommand('editor.move_line_down', () => action('editor.action.moveLinesDownAction'), !!editor)
  useCommand('editor.duplicate_line', () => action('editor.action.copyLinesDownAction'), !!editor)
  useCommand('editor.copy_and_trim', () => { void copyTrimmed() }, !!editor)
  useCommand('editor.toggle_comment', () => action('editor.action.commentLine'), !!editor)
  if (!mode) return null
  if (mode.kind === 'goto') return <GoToLineDialog editor={mode.editor} close={close} />
  if (mode.kind === 'rename') return <RenameDialog projectId={projectId} editor={mode.editor} close={close} />
  if (mode.kind === 'workspace') return <WorkspaceSymbolPicker projectId={projectId} onOpen={onOpen} close={close} />
  if (mode.kind === 'locations') return <Picker label={mode.title} placeholder={tr('Lọc vị trí…')} items={mode.locations.map((location, index) => ({ location, index }))}
    itemKey={(item) => String(item.index)} itemText={(item) => `${item.location.file}:${item.location.line}:${item.location.column}`}
    empty={tr('Không có vị trí khớp')} onCancel={() => close()} onPick={({ location }) => { close(false); onOpen(location.file, location.line, location.column) }}
    renderItem={({ location }, positions) => <span><Highlight text={`${location.file}:${location.line}:${location.column}`} positions={positions} /></span>} />
  if (mode.kind === 'hierarchy') {
    const shown = mode
    return <Picker label={tr('Phân cấp lời gọi')} placeholder={tr('Lọc ký hiệu hoặc lời gọi…')} items={shown.rows}
      itemKey={(row) => row.key} itemText={(row) => row.name}
      renderItem={(row, positions) => <><span><Highlight text={row.name} positions={positions} /></span><small>{row.file}:{row.line}</small></>}
      empty={shown.status} onCancel={() => close()} onPick={(row) => {
        if (!row.isCall) { void loadCalls(shown.direction, [row.item], shown.roots); return }
        close(false)
        onOpen(row.file, row.line, row.column)
      }}
      footer={(row) => <>
        <button type="button" disabled={!shown.stack.length} onClick={() => hierarchyBack()}>{tr('Quay lại')}</button>
        <button type="button" onClick={() => hierarchyShowCalls(shown, row)}>{tr('Hiện lời gọi')}</button>
        <button type="button" onClick={() => hierarchySwitch(shown, row)}>{tr('Đổi hướng')}</button>
      </>} />
  }
  const rows = flattenSymbols(symbols)
  return <Picker label={tr('Tìm ký hiệu trong tệp')} placeholder={tr('Tìm ký hiệu trong tệp…')} items={rows} itemKey={(item) => item.id} itemText={(item) => item.symbol.name}
    empty={symbolsError ?? tr('Không có ký hiệu khớp')} onCancel={() => close()} onPick={({ symbol }) => {
      close(false)
      const { line, character } = symbol.selectionRange.start
      if (mode.editor.handle.revealPosition) mode.editor.handle.revealPosition(line + 1, character + 1)
      else mode.editor.handle.revealLines(line + 1)
    }} renderItem={({ symbol }, positions) => <><span><Highlight text={symbol.name} positions={positions} /></span><small>{symbol.selectionRange.start.line + 1}</small></>} />
}
