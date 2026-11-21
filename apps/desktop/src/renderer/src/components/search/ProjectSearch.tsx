import { useEffect, useMemo, useRef, useState } from 'react'
import type { TextSearchQuery, TextSearchResult } from '@shared/api'
import { useDebounced } from '../../state/useDebounced'
import { tr } from '../../strings'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { Icon } from '../common/icons'
import './project-search.css'

interface Props {
  projectId: string
  onOpen: (file: string, line: number) => void
  /** Tệp đang sửa dở trong editor: không thay để tránh ghi đè. */
  dirtyFiles: ReadonlySet<string>
  /** Tăng mỗi lần ⌘⇧F để đưa tiêu điểm về ô tìm. */
  focusRequest?: number
}

const message = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e))

/** Tìm và thay trong cả dự án kiểu project search của Wu: ô tìm có nút Aa / từ nguyên / regex, ô thay, lọc tệp, kết quả nhóm theo tệp. */
export function ProjectSearch({ projectId, onOpen, dirtyFiles, focusRequest }: Props) {
  const [query, setQuery] = useState<TextSearchQuery>({ query: '' })
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [result, setResult] = useState<TextSearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [runs, setRuns] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const debounced = useDebounced(query, 250)
  const api = window.nexgraph.fs

  useEffect(() => { input.current?.focus(); input.current?.select() }, [focusRequest])

  useEffect(() => {
    if (!debounced.query || !api.searchText) { setResult(null); setError(null); return }
    let live = true
    setBusy(true)
    api.searchText(projectId, debounced)
      .then((r) => { if (live) { setResult(r); setError(null) } })
      .catch((e: unknown) => { if (live) { setResult(null); setError(message(e)) } })
      .finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [projectId, debounced, runs, api])

  const total = useMemo(() => result?.files.reduce((n, f) => n + f.matches.length, 0) ?? 0, [result])
  const set = (patch: Partial<TextSearchQuery>) => { setStatus(null); setQuery((q) => ({ ...q, ...patch })) }
  const toggle = (key: 'caseSensitive' | 'wholeWord' | 'regex', label: string, text: string) => (
    <button type="button" className="ps-toggle" aria-label={label} title={label} aria-pressed={!!query[key]} onClick={() => set({ [key]: !query[key] })}>{text}</button>
  )

  const replaceAll = async () => {
    if (!result || !api.replaceText) return
    const files = result.files.map((f) => f.file).filter((f) => !dirtyFiles.has(f))
    const held = result.files.length - files.length
    if (!files.length || !window.confirm(tr('Thay {count} chỗ trong {files} tệp bằng “{text}”?', { count: total, files: files.length, text: replacement }))) return
    try {
      const done = await api.replaceText(projectId, debounced, replacement, files)
      const skipped = done.skipped.length + held
      const skippedText = skipped ? tr('; bỏ qua {count} tệp đang sửa hoặc vừa đổi', { count: skipped }) : ''
      setStatus(tr('Đã thay {count} chỗ trong {files} tệp{skipped}.', { count: done.replacements, files: done.files, skipped: skippedText }))
      setRuns((n) => n + 1)
    } catch (e) {
      setError(message(e))
    }
  }

  return (
    <div className="project-search">
      <div className="ps-row">
        <button type="button" className="ps-toggle ps-expand" aria-label={showReplace ? tr('Ẩn ô thay') : tr('Hiện ô thay')} aria-expanded={showReplace} onClick={() => setShowReplace((v) => !v)}>
          <Icon name="chevron" size={12} />
        </button>
        <div className="ps-field">
          <input ref={input} type="text" aria-label={tr('Tìm trong tệp')} placeholder={tr('Tìm trong tệp…')} value={query.query} onChange={(e) => set({ query: e.target.value })} />
          {toggle('caseSensitive', tr('Phân biệt hoa thường'), 'Aa')}
          {toggle('wholeWord', tr('Khớp nguyên từ'), 'ab')}
          {toggle('regex', tr('Biểu thức chính quy'), '.*')}
          <button type="button" className="ps-toggle" aria-label={tr('Lọc tệp')} aria-pressed={showFilters} title={tr('Lọc tệp')} onClick={() => setShowFilters((v) => !v)}>…</button>
        </div>
      </div>
      {showReplace && (
        <div className="ps-row ps-indent">
          <div className="ps-field">
            <input aria-label={tr('Thay bằng')} placeholder={tr('Thay bằng…')} value={replacement} onChange={(e) => setReplacement(e.target.value)} />
            <button type="button" className="ps-toggle" aria-label={tr('Thay tất cả')} title={tr('Thay tất cả')} disabled={!total || busy} onClick={() => void replaceAll()}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h12m-3-3 3 3-3 3M20 17H8m3-3-3 3 3 3" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {showFilters && (
        <div className="ps-filters ps-indent">
          <input aria-label={tr('Chỉ trong tệp')} placeholder={tr('Chỉ trong: src/**, *.ts')} value={query.include ?? ''} onChange={(e) => set({ include: e.target.value })} />
          <input aria-label={tr('Bỏ qua tệp')} placeholder={tr('Bỏ qua: **/*.test.ts')} value={query.exclude ?? ''} onChange={(e) => set({ exclude: e.target.value })} />
        </div>
      )}
      <p className="ps-summary muted" role="status">
        {error ?? status ?? (busy ? tr('Đang tìm…') : result ? (total ? tr('{count} kết quả trong {files} tệp{truncated}', { count: total, files: result.files.length, truncated: result.truncated ? tr(' (đã rút gọn)') : '' }) : tr('Không có kết quả')) : '')}
      </p>
      {result && (
        <ul className="ps-results" aria-label={tr('Kết quả tìm')}>
          {result.files.map(({ file, matches }) => {
            const cut = file.lastIndexOf('/') + 1
            const open = !collapsed.has(file)
            return (
              <li key={file}>
                <button type="button" className="ps-file" aria-expanded={open} title={file}
                  onClick={() => setCollapsed((cur) => { const next = new Set(cur); if (open) next.add(file); else next.delete(file); return next })}>
                  <Icon name="chevron" size={12} />
                  <FileTypeIcon name={file} size={14} />
                  <span className="ps-name">{file.slice(cut)}</span>
                  <span className="ps-dir muted">{file.slice(0, cut)}</span>
                  <span className="ps-count">{matches.length}</span>
                </button>
                {open && (
                  <ul>
                    {matches.map((m) => {
                      const at = m.column - 1 - m.previewStart
                      const text = m.preview
                      const before = text.slice(0, at)
                      const after = text.slice(at + m.length)
                      const contextStart = Math.max(0, before.length - 24)
                      const start = contextStart > 0 && /[\uDC00-\uDFFF]/.test(before[contextStart]) && /[\uD800-\uDBFF]/.test(before[contextStart - 1])
                        ? contextStart - 1 : contextStart
                      const contextEnd = Math.min(after.length, 160)
                      const end = contextEnd > 0 && contextEnd < after.length && /[\uD800-\uDBFF]/.test(after[contextEnd - 1]) && /[\uDC00-\uDFFF]/.test(after[contextEnd])
                        ? contextEnd + 1 : contextEnd
                      // shortcut: a preview ending at the API's 200-unit limit may not be cropped; upgrade when the API exposes the line end.
                      const croppedEnd = text.length - at === 200 || at + m.length > text.length
                      return (
                        <li key={`${m.line}:${m.column}`}>
                          <button type="button" className="ps-match" onClick={() => onOpen(file, m.line)} title={tr('Dòng {line}', { line: m.line })}>
                            <span className="ps-line muted">{m.line}</span>
                            <span className="ps-preview">
                              <span className="ps-context-before">{m.previewStart > 0 || start > 0 ? '…' : ''}{before.slice(start)}</span>
                              <mark>{text.slice(at, at + m.length)}</mark>
                              <span className="ps-context-after">{after.slice(0, end)}{croppedEnd || end < after.length ? '…' : ''}</span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
