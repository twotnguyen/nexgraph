import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { LspDocumentSymbol, LspLocation, LspWorkspaceSymbol } from '@shared/api'
import { useCommand } from '../../state/commands'
import type { ActiveEditor } from '../../state/activeEditor'
import { errorText } from '../../state/errorText'
import { Highlight, Picker } from '../layout/Picker'
import * as editorMonaco from './monaco'
import { parseGoToLine } from './goToLine'
import type { OpenEditorLocation } from './EditorPanels'
import './editor-tools.css'

type Mode = { kind: 'goto' | 'rename' | 'document'; editor: ActiveEditor } | { kind: 'workspace' } | { kind: 'locations'; title: string; locations: LspLocation[] }
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
    <form className="picker editor-tool-dialog" role="dialog" aria-modal="true" aria-label="Đi đến dòng" onSubmit={submit} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close() } }}>
      <label htmlFor="goto-line-input">Đi đến dòng</label>
      <input id="goto-line-input" autoFocus value={value} placeholder="Dòng[:cột] hoặc +/- số dòng" aria-describedby="goto-line-help" aria-invalid={invalid}
        onChange={(event) => {
          const next = event.target.value
          setValue(next)
          setInvalid(false)
          const target = parseGoToLine(next, position.line, lineCount)
          if (target) editor.handle.previewPosition?.(target.line)
          else { editor.handle.clearPreview?.(); if (scroll) editor.handle.setScrollPosition?.(scroll) }
        }} />
      <p id="goto-line-help">Dòng hiện tại: {position.line} / {lineCount} (cột {position.column})</p>
      {invalid && <p className="editor-tool-error" role="alert">Nhập dòng hoặc dòng:cột hợp lệ.</p>}
      <div className="editor-tool-actions"><button type="button" onClick={() => close()}>Hủy</button><button type="submit">Đi đến</button></div>
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
    if (!name.trim()) { setError('Nhập tên mới.'); return }
    if (!position || !window.nexgraph?.lsp?.rename) { setError('Không thể đổi tên ký hiệu trong tệp này.'); return }
    setBusy(true)
    setError(null)
    try {
      await editorMonaco.syncProjectModels(projectId)
      const text = editor.text()
      const edit = await window.nexgraph.lsp.rename(projectId, editor.file, text, position.line, position.column, name.trim())
      if (editor.text() !== text) throw new Error('Tệp đã thay đổi trong khi đổi tên. Hãy thử lại.')
      await editorMonaco.applyWorkspaceEdit(projectId, edit)
      close()
    } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <div className="picker-layer" onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) close() }}>
    <form className="picker editor-tool-dialog" role="dialog" aria-modal="true" aria-label="Đổi tên ký hiệu" onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); close() } }}>
      <label htmlFor="rename-symbol-input">Tên mới</label>
      <input id="rename-symbol-input" ref={input} autoFocus value={name} onChange={(event) => setName(event.target.value)} disabled={busy} aria-invalid={!!error} />
      {error && <p className="editor-tool-error" role="alert">{error}</p>}
      <div className="editor-tool-actions"><button type="button" disabled={busy} onClick={() => close()}>Hủy</button><button type="submit" disabled={busy}>Đổi tên</button></div>
    </form>
  </div>
}

function WorkspaceSymbolPicker({ projectId, onOpen, close }: { projectId: string; onOpen: OpenEditorLocation; close: (restore?: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [symbols, setSymbols] = useState<LspWorkspaceSymbol[]>([])
  const [status, setStatus] = useState('Đang tìm ký hiệu…')
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      const api = window.nexgraph?.lsp?.workspaceSymbols
      if (!api) { setStatus('Không hỗ trợ tìm ký hiệu trong dự án.'); return }
      void Promise.resolve().then(() => api(projectId, query)).then((items) => {
        if (live) { setSymbols(items.slice(0, 100)); setStatus('Không có ký hiệu khớp') }
      }).catch((error: unknown) => { if (live) setStatus(errorText(error)) })
    }, 200)
    return () => { live = false; clearTimeout(timer) }
  }, [projectId, query])
  return <Picker label="Tìm ký hiệu trong dự án" placeholder="Tìm ký hiệu trong dự án…" items={symbols}
    itemKey={(item) => `${item.file}:${item.range.start.line}:${item.range.start.character}:${item.name}`} itemText={(item) => item.name}
    filter={(items) => items.map((item) => ({ item, positions: [] }))} onQueryChange={(value) => { setSymbols([]); setStatus('Đang tìm ký hiệu…'); setQuery(value) }}
    empty={status} onCancel={() => close()} onPick={(symbol) => { close(false); onOpen(symbol.file, symbol.range.start.line + 1, symbol.range.start.character + 1) }}
    renderItem={(symbol) => <><span>{symbol.name}{symbol.containerName ? ` · ${symbol.containerName}` : ''}</span><small>{symbol.file}:{symbol.range.start.line + 1}</small></>} />
}

export function EditorTools({ projectId, editor, symbols, symbolsError, onOpen, onDiagnostics, onError }: {
  projectId: string; editor: ActiveEditor | null; symbols: LspDocumentSymbol[]; symbolsError: string | null
  onOpen: OpenEditorLocation; onDiagnostics: () => void; onError: (message: string) => void
}) {
  const [mode, setMode] = useState<Mode | null>(null)
  const origin = useRef<HTMLElement | null>(null)
  const open = (next: Mode) => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setMode(next)
  }
  const close = (restore = true) => {
    setMode(null)
    if (restore) { const target = origin.current; window.setTimeout(() => { if (target?.isConnected) target.focus() }, 0) }
  }
  const action = (id: string) => {
    if (!editor) return
    void editor.handle.runAction?.(id).catch((error: unknown) => onError(errorText(error)))
  }
  const locations = async (kind: 'references' | 'implementation') => {
    if (!editor) return
    const position = editor.handle.getPosition?.()
    const api = window.nexgraph?.lsp?.[kind]
    if (!position || !api) { onError('Không hỗ trợ điều hướng ký hiệu trong tệp này.'); return }
    try {
      const found = await api(projectId, editor.file, editor.text(), position.line, position.column)
      if (!found.length) { onError(kind === 'references' ? 'Không tìm thấy tham chiếu.' : 'Không tìm thấy phần triển khai.'); return }
      if (found.length === 1) onOpen(found[0].file, found[0].line, found[0].column)
      else open({ kind: 'locations', title: kind === 'references' ? 'Tham chiếu' : 'Phần triển khai', locations: found })
    } catch (error) { onError(errorText(error)) }
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
  if (!mode) return null
  if (mode.kind === 'goto') return <GoToLineDialog editor={mode.editor} close={close} />
  if (mode.kind === 'rename') return <RenameDialog projectId={projectId} editor={mode.editor} close={close} />
  if (mode.kind === 'workspace') return <WorkspaceSymbolPicker projectId={projectId} onOpen={onOpen} close={close} />
  if (mode.kind === 'locations') return <Picker label={mode.title} placeholder="Lọc vị trí…" items={mode.locations.map((location, index) => ({ location, index }))}
    itemKey={(item) => String(item.index)} itemText={(item) => `${item.location.file}:${item.location.line}:${item.location.column}`}
    empty="Không có vị trí khớp" onCancel={() => close()} onPick={({ location }) => { close(false); onOpen(location.file, location.line, location.column) }}
    renderItem={({ location }, positions) => <span><Highlight text={`${location.file}:${location.line}:${location.column}`} positions={positions} /></span>} />
  const rows = flattenSymbols(symbols)
  return <Picker label="Tìm ký hiệu trong tệp" placeholder="Tìm ký hiệu trong tệp…" items={rows} itemKey={(item) => item.id} itemText={(item) => item.symbol.name}
    empty={symbolsError ?? 'Không có ký hiệu khớp'} onCancel={() => close()} onPick={({ symbol }) => {
      close(false)
      const { line, character } = symbol.selectionRange.start
      if (mode.editor.handle.revealPosition) mode.editor.handle.revealPosition(line + 1, character + 1)
      else mode.editor.handle.revealLines(line + 1)
    }} renderItem={({ symbol }, positions) => <><span><Highlight text={symbol.name} positions={positions} /></span><small>{symbol.selectionRange.start.line + 1}</small></>} />
}
