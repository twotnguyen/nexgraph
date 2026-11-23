import { useMemo, useRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Citation } from '@shared/graph-types'
import { type ScannedCitation, scanCitations } from '@shared/citations'
import { tr, vi } from '../../strings'
import { useLocale } from '../../state/locale'
import './citation-text.css'

interface Props {
  text: string
  citations: Citation[]
  onOpen: (file: string, start: number, end: number) => void
}
type MarkdownNode = {
  type: string
  value?: string
  children?: MarkdownNode[]
  url?: string
  data?: { hProperties: Record<string, string> }
}
const label = (c: Citation): string => `${c.file}:${c.start}${c.end > c.start ? `–${c.end}` : ''}`

function externalUrl(value: string | undefined): string | undefined {
  try {
    const url = new URL(value ?? '')
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

const keyOf = (file: string, start: number, end: number): string => `${file}\u0000${start}\u0000${end}`

/**
 * Tra chip theo `file` + khoảng dòng, không theo `raw`: main đã bỏ tiền tố danh sách và bỏ dần chữ
 * của câu (“Theo flow app/x.py”) khi engine xác nhận tệp, nên cùng một trích dẫn có thể có `raw`
 * dài ngắn khác nhau giữa lúc đếm và lúc renderer thấy text node.
 */
function resolve(scanned: ScannedCitation, citations: Citation[], byKey: Map<string, number>): { index: number; keep: number } | null {
  const direct = byKey.get(keyOf(scanned.file, scanned.start, scanned.end))
  if (direct !== undefined) return { index: direct, keep: 0 }
  const parts = scanned.file.split(' ')
  for (let i = 1; i < parts.length; i++) {
    const file = parts.slice(i).join(' ')
    const found = byKey.get(keyOf(file, scanned.start, scanned.end))
    if (found !== undefined) return { index: found, keep: scanned.file.length - file.length }
  }
  return null
}

/** Tách một đoạn văn bản thành text/chip; trong inline code, phần không phải trích dẫn vẫn là code. */
function splitCitations(value: string, citations: Citation[], byKey: Map<string, number>, asCode = false): MarkdownNode[] {
  const text = (chunk: string): MarkdownNode => (asCode ? { type: 'inlineCode', value: chunk } : { type: 'text', value: chunk })
  const out: MarkdownNode[] = []
  let last = 0
  for (const scanned of scanCitations(value)) {
    const found = resolve(scanned, citations, byKey)
    if (!found) continue
    if (scanned.index > last) out.push(text(value.slice(last, scanned.index)))
    // Chỉ giữ chữ đứng trước đường dẫn khi `raw` bắt đầu đúng bằng `file` (dạng không ngoặc).
    // Dạng có ngoặc bắt đầu bằng `[[`: cắt theo `keep` sẽ để lại rác `[[flo`, nên bỏ cả cụm ngoặc.
    const keep = scanned.raw.startsWith(scanned.file) ? found.keep : 0
    if (keep > 0) out.push(text(scanned.raw.slice(0, keep)))
    out.push({
      type: 'link', url: '#nexgraph-citation',
      data: { hProperties: { dataNexgraphCitation: String(found.index) } },
      children: [{ type: 'text', value: label(citations[found.index]) }]
    })
    last = scanned.index + scanned.raw.length
  }
  if (out.length === 0) return [text(value)]
  if (last < value.length) out.push(text(value.slice(last)))
  return out
}

/**
 * Trong code fence, thay nội dung bằng chip sẽ phá thụt lề/monospace và làm sai thứ người dùng
 * copy ra — nên giữ nguyên khối code và hiện chip ở một dòng ngay dưới khối. Trong inline code thì
 * tách: phần không phải trích dẫn vẫn là code, riêng trích dẫn thành chip.
 */
function citationPlugin(citations: Citation[], blockLabel: string) {
  const byKey = new Map<string, number>()
  citations.forEach((citation, index) => {
    const key = keyOf(citation.file, citation.start, citation.end)
    if (!byKey.has(key)) byKey.set(key, index)
  })
  return () => (tree: MarkdownNode) => {
    const transform = (node: MarkdownNode): void => {
      if (!node.children) return
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (['link', 'linkReference'].includes(child.type)) return [child]
        if (child.type === 'inlineCode' && child.value) {
          const parts = splitCitations(child.value, citations, byKey, true)
          return parts.some((part) => part.type === 'link') ? parts : [child]
        }
        if (child.type === 'code' && child.value) {
          // Cùng một trích dẫn lặp trong một khối mã: chỉ một chip; nhiều chip thì có dấu phẩy ngăn cách.
          const seen = new Set<string>()
          const chips: MarkdownNode[] = []
          for (const part of splitCitations(child.value, citations, byKey)) {
            if (part.type !== 'link') continue
            const id = part.data?.hProperties.dataNexgraphCitation ?? ''
            if (seen.has(id)) continue
            seen.add(id)
            if (chips.length > 0) chips.push({ type: 'text', value: ', ' })
            chips.push(part)
          }
          if (chips.length === 0) return [child]
          return [child, { type: 'paragraph', children: [{ type: 'text', value: `${blockLabel} ` }, ...chips] }]
        }
        if (child.type === 'text' && child.value) return splitCitations(child.value, citations, byKey)
        transform(child)
        return [child]
      })
    }
    transform(tree)
  }
}

export function CitationText({ text, citations, onOpen }: Props) {
  const locale = useLocale()
  const plugin = useMemo(() => citationPlugin(citations, tr('Trích dẫn trong khối mã:')), [citations, locale])
  const open = useRef(onOpen)
  open.current = onOpen
  // Giữ nguyên danh tính component giữa các lần vẽ: hàm mới mỗi lần làm React dựng lại chip, nên bấm trượt khi cha vẽ lại giữa mousedown và mouseup.
  const components = useMemo<Components>(() => ({
    a: ({ children, href, node }) => {
      const index = node?.properties.dataNexgraphCitation
      const citation = typeof index === 'string' ? citations[Number(index)] : undefined
      if (citation) return citation.valid ? (
        <button type="button" className="cite" onClick={() => open.current(citation.file, citation.start, citation.end)}>{label(citation)}</button>
      ) : (
        <button type="button" className="cite bad" disabled title={citation.reason ? vi.chat.reason[citation.reason] : undefined}
          aria-label={`${label(citation)} ${vi.chat.unverified}`}>{label(citation)}</button>
      )
      const safe = externalUrl(href)
      return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
    },
    img: ({ alt }) => <span className="markdown-image">{alt ? tr('Hình ảnh · {alt}', { alt }) : tr('Hình ảnh')}</span>,
    table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>
  }), [citations, locale])
  return (
    <div className="chat-text markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, plugin]} skipHtml
        urlTransform={(url) => url === '#nexgraph-citation' ? url : externalUrl(url) ?? ''}
        components={components}>{text}</ReactMarkdown>
    </div>
  )
}
