import { Fragment } from 'react'
import type { Citation } from '@shared/graph-types'
import { vi } from '../../strings'

interface Props {
  text: string
  citations: Citation[]
  onOpen: (file: string, start: number, end: number) => void
}

const label = (c: Citation): string => `${c.file}:${c.start}${c.end > c.start ? `–${c.end}` : ''}`

/** Dấu `code` thành <code>; mọi `[[tệp:dòng]]` thành chip. Chip không kiểm chứng được bị gạch ngang và không bấm được. */
function inline(text: string, keyPrefix: string) {
  return text.split(/(`[^`\n]+`)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={`${keyPrefix}${i}`}>{part.slice(1, -1)}</code> : <Fragment key={`${keyPrefix}${i}`}>{part}</Fragment>)
}

export function CitationText({ text, citations, onOpen }: Props) {
  const byRaw = new Map(citations.map((c) => [c.raw, c]))
  const parts = text.split(/(\[\[[^[\]]+\]\])/g)
  return (
    <div className="chat-text" style={{ whiteSpace: 'pre-wrap' }}>
      {parts.map((part, i) => {
        const c = byRaw.get(part)
        if (!c) return <Fragment key={i}>{inline(part, `t${i}-`)}</Fragment>
        return c.valid ? (
          <button key={i} type="button" className="cite" onClick={() => onOpen(c.file, c.start, c.end)}>{label(c)}</button>
        ) : (
          <button key={i} type="button" className="cite bad" disabled title={c.reason ? vi.chat.reason[c.reason] : undefined}
            aria-label={`${label(c)} ${vi.chat.unverified}`}>{label(c)}</button>
        )
      })}
    </div>
  )
}
