import { useMemo, useRef } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Citation } from '@shared/graph-types'
import { CITATION_SOURCE } from '@shared/citations'
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

/** Chỉ text node được đổi thành chip. Code fence, inline code và nội dung liên kết giữ nguyên Markdown. */
const CITATION_TEXT = new RegExp(CITATION_SOURCE, 'g')

/** Tách một text node thành các mảnh text/chip theo đúng các trích dẫn đã kiểm chứng. */
function splitCitations(value: string, byRaw: Map<string, number>, citations: Citation[]): MarkdownNode[] {
  const out: MarkdownNode[] = []
  let last = 0
  for (const m of value.matchAll(CITATION_TEXT)) {
    const index = byRaw.get(m[0])
    if (index === undefined || m.index === undefined) continue
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
    out.push({
      type: 'link', url: '#nexgraph-citation',
      data: { hProperties: { dataNexgraphCitation: String(index) } },
      children: [{ type: 'text', value: label(citations[index]) }]
    })
    last = m.index + m[0].length
  }
  if (out.length === 0) return [{ type: 'text', value }]
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function citationPlugin(citations: Citation[]) {
  const byRaw = new Map(citations.map((citation, index) => [citation.raw, index]))
  return () => (tree: MarkdownNode) => {
    const transform = (node: MarkdownNode): void => {
      if (!node.children || ['code', 'inlineCode', 'link', 'linkReference'].includes(node.type)) return
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== 'text' || !child.value) { transform(child); return [child] }
        return splitCitations(child.value, byRaw, citations)
      })
    }
    transform(tree)
  }
}

export function CitationText({ text, citations, onOpen }: Props) {
  const locale = useLocale()
  const plugin = useMemo(() => citationPlugin(citations), [citations])
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
