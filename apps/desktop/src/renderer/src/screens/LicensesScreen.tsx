import { useEffect, useMemo, useState } from 'react'
import { errorMsg } from '../state/errorText'
import { msgText, type Message } from '../state/messages'
import { tr } from '../strings'
import './licenses.css'

type Section = { title: string; body: string }

/**
 * Tách `THIRD_PARTY_LICENSES.md` thành các mục `## …` để ô tìm lọc theo mục.
 * Phần trước tiêu đề đầu tiên là lời dẫn, luôn hiện.
 * Xuống dòng được chuẩn hoá về LF trước khi tách: bản cài Windows dựng từ checkout CRLF
 * (`core.autocrlf`) nếu không sẽ mang `\r` vào thân mục trên DOM.
 */
export function splitLicenseSections(raw: string): { intro: string; sections: Section[] } {
  const text = raw.replace(/\r\n?/g, '\n')
  const first = text.search(/^## /m)
  if (first < 0) return { intro: '', sections: [{ title: '', body: text.trim() }] }
  const intro = text.slice(0, first).trim()
  const sections: Section[] = []
  const rest = text.slice(first)
  for (const block of rest.split(/^## /m).slice(1)) {
    const newline = block.indexOf('\n')
    const title = (newline < 0 ? block : block.slice(0, newline)).trim()
    const body = (newline < 0 ? '' : block.slice(newline + 1)).trim()
    sections.push({ title, body })
  }
  return { intro, sections }
}

/** Tô sáng mọi lần xuất hiện của `query` (không phân biệt hoa thường), giữ nguyên chữ gốc. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return <>{parts.map((part, index) => part.toLocaleLowerCase('vi') === query.toLocaleLowerCase('vi')
    ? <mark key={index}>{part}</mark>
    : part)}</>
}

/**
 * LIC-2: màn Giấy phép mã nguồn mở — chỗ DUY NHẤT trong UI được nêu tên dự án nguồn
 * (ADR 0025). Nội dung đọc từ `THIRD_PARTY_LICENSES.md` đã đóng gói, chỉ đọc, có ô tìm.
 */
export function LicensesScreen({ onBack }: { onBack: () => void }) {
  const [doc, setDoc] = useState<{ text: string; path: string } | null>(null)
  const [error, setError] = useState<Message | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    window.nexgraph?.licenses?.read()
      .then((value) => { if (alive) setDoc(value) })
      .catch((e: unknown) => { if (alive) setError(errorMsg(e)) })
    return () => { alive = false }
  }, [])

  const parsed = useMemo(() => (doc ? splitLicenseSections(doc.text) : { intro: '', sections: [] }), [doc])
  const q = query.trim().toLocaleLowerCase('vi')
  const shown = q
    ? parsed.sections.filter((section) => `${section.title}\n${section.body}`.toLocaleLowerCase('vi').includes(q))
    : parsed.sections

  return (
    <main className="screen licenses">
      <header className="licenses-header">
        <button type="button" className="licenses-back" onClick={onBack}>{tr('Quay lại')}</button>
        <div className="licenses-title">
          <h1>{tr('Giấy phép mã nguồn mở')}</h1>
          <p className="muted">{tr('Phần mềm bên thứ ba và giấy phép đi kèm bản cài NexGraph.')}</p>
        </div>
        <label className="licenses-search">
          <input type="search" aria-label={tr('Tìm trong giấy phép')} placeholder={tr('Tìm trong giấy phép…')}
            value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </header>

      {error && <p role="alert" className="inline-message error">{msgText(error)}</p>}
      {!doc && !error && <p className="muted licenses-loading" role="status">{tr('Đang tải giấy phép…')}</p>}

      {doc && (
        <div className="licenses-doc" role="document" aria-readonly="true" aria-label={tr('Giấy phép mã nguồn mở')}>
          {parsed.intro && <pre className="licenses-intro">{parsed.intro}</pre>}
          <p className="muted small licenses-count" role="status">{tr('{shown}/{total} mục', { shown: shown.length, total: parsed.sections.length })}</p>
          {shown.length === 0
            ? <p className="licenses-empty">{tr('Không có mục nào khớp “{query}”', { query: query.trim() })}</p>
            : shown.map((section) => (
              <section className="license-section" key={section.title}>
                <h2>{section.title}</h2>
                <pre><Highlight text={section.body} query={query.trim()} /></pre>
              </section>
            ))}
          <p className="muted small licenses-source">{tr('Tệp: {name}', { name: 'THIRD_PARTY_LICENSES.md' })}</p>
        </div>
      )}
    </main>
  )
}
