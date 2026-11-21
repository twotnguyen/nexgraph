import { useEffect, useState } from 'react'
import type { LspDocumentSymbol } from '@shared/api'
import type { ActiveEditor } from '../../state/activeEditor'
import { useDiagnostics } from '../../state/diagnostics'
import { errorText } from '../../state/errorText'
import { fuzzyMatch } from '../../state/fuzzy'
import './editor-tools.css'

export type OpenEditorLocation = (file: string, line: number, column?: number) => void

export function useDocumentSymbols(projectId: string, editor: ActiveEditor | null): { symbols: LspDocumentSymbol[]; error: string | null } {
  const [result, setResult] = useState<{ editor: ActiveEditor | null; symbols: LspDocumentSymbol[]; error: string | null }>({ editor: null, symbols: [], error: null })
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
        if (live && request === serial) setResult({ editor, symbols: [], error: errorText(error) })
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

function SymbolList({ symbols, query, onPick }: { symbols: LspDocumentSymbol[]; query: string; onPick: (symbol: LspDocumentSymbol) => void }) {
  return <ul>{symbols.filter((symbol) => symbolMatches(symbol, query)).map((symbol, index) => <li key={`${symbol.name}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.character}:${index}`}>
    <button type="button" onClick={() => onPick(symbol)} title={symbol.name}>{symbol.name}</button>
    {!!symbol.children?.length && <SymbolList symbols={symbol.children} query={query} onPick={onPick} />}
  </li>)}</ul>
}

export function OutlinePanel({ editor, symbols, error }: { editor: ActiveEditor | null; symbols: LspDocumentSymbol[]; error: string | null }) {
  const [query, setQuery] = useState('')
  return <div className="editor-outline">
    <input type="search" aria-label="Tìm ký hiệu" placeholder="Tìm ký hiệu…" value={query} onChange={(event) => setQuery(event.target.value)} />
    {!editor ? <p className="muted">Mở một tệp để xem ký hiệu.</p> : error ? <p role="alert">{error}</p> :
      symbols.length === 0 ? <p className="muted">Không có ký hiệu trong tệp.</p> :
      <SymbolList symbols={symbols} query={query} onPick={(symbol) => {
        const { line, character } = symbol.selectionRange.start
        if (editor.handle.revealPosition) editor.handle.revealPosition(line + 1, character + 1)
        else editor.handle.revealLines(line + 1)
      }} />}
  </div>
}

export function DiagnosticsPanel({ projectId, onOpen }: { projectId: string; onOpen: OpenEditorLocation }) {
  const diagnostics = useDiagnostics(projectId)
  const files = Object.entries(diagnostics).filter(([, items]) => items.length > 0).sort(([a], [b]) => a.localeCompare(b))
  return <div className="editor-diagnostics">
    {files.length === 0 ? <p className="muted">Không có lỗi trong dự án</p> : files.map(([file, items]) => <section key={file}>
      <h3 title={file}>{file} <small>({items.length})</small></h3>
      <ul>{items.map((item, index) => {
        const { line, character } = item.range.start
        const severity = item.severity === 2 ? 'Cảnh báo' : item.severity === 3 ? 'Thông tin' : item.severity === 4 ? 'Gợi ý' : 'Lỗi'
        return <li key={`${line}:${character}:${index}`}><button type="button" onClick={() => onOpen(file, line + 1, character + 1)}>
          <span>{severity}: {item.message}</span><small>{line + 1}:{character + 1}{item.source ? ` · ${item.source}` : ''}</small>
        </button></li>
      })}</ul>
    </section>)}
  </div>
}
