import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Citation } from '@shared/graph-types'
import { vi } from '../../strings'
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
function citationPlugin(citations: Citation[]) {
  const byRaw = new Map(citations.map((citation, index) => [citation.raw, index]))
  return () => (tree: MarkdownNode) => {
    const transform = (node: MarkdownNode): void => {
      if (!node.children || ['code', 'inlineCode', 'link', 'linkReference'].includes(node.type)) return
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== 'text' || !child.value) { transform(child); return [child] }
        return child.value.split(/(\[\[[^[\]]+\]\])/g).filter(Boolean).map((value) => {
          const index = byRaw.get(value)
          if (index === undefined) return { type: 'text', value }
          return {
            type: 'link', url: '#nexgraph-citation',
            data: { hProperties: { dataNexgraphCitation: String(index) } },
            children: [{ type: 'text', value: label(citations[index]) }]
          }
        })
      })
    }
    transform(tree)
  }
}

export function CitationText({ text, citations, onOpen }: Props) {
  const plugin = useMemo(() => citationPlugin(citations), [citations])
  return (
    <div className="chat-text markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, plugin]} skipHtml
        urlTransform={(url) => url === '#nexgraph-citation' ? url : externalUrl(url) ?? ''}
        components={{
          a: ({ children, href, node }) => {
            const index = node?.properties.dataNexgraphCitation
            const citation = typeof index === 'string' ? citations[Number(index)] : undefined
            if (citation) return citation.valid ? (
              <button type="button" className="cite" onClick={() => onOpen(citation.file, citation.start, citation.end)}>{label(citation)}</button>
            ) : (
              <button type="button" className="cite bad" disabled title={citation.reason ? vi.chat.reason[citation.reason] : undefined}
                aria-label={`${label(citation)} ${vi.chat.unverified}`}>{label(citation)}</button>
            )
            const safe = externalUrl(href)
            return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>
          },
          img: ({ alt }) => <span className="markdown-image">{alt ? `Hình ảnh · ${alt}` : 'Hình ảnh'}</span>,
          table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>
        }}>{text}</ReactMarkdown>
    </div>
  )
}
