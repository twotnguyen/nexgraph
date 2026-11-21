import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '../common/icons'
import { FileTypeIcon } from '../common/FileTypeIcon'
import { errorText } from '../../state/errorText'
import { isFenceClosed, resolveReference, taskEdit } from './markdown'
import { MermaidBlock } from './MermaidBlock'
import { observeBuffer, type PreviewBuffer } from './modelBuffer'
import './markdown-preview.css'

type Position = { line: number; column: number }
const ItemPosition = createContext<Position | null>(null)
const imageTypes: Record<string, string> = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp', bmp: 'bmp', ico: 'x-icon', svg: 'svg+xml', avif: 'avif' }

function LocalImage({ projectId, sourceFile, src, alt }: { projectId: string; sourceFile: string; src?: string; alt?: string }) {
  const [result, setResult] = useState<{ url?: string; error?: string }>({})
  const target = src ? resolveReference(sourceFile, src) : null
  const path = target?.kind === 'file' ? target.file : null
  useEffect(() => {
    setResult({})
    if (!path) return
    const mime = imageTypes[path.split('.').pop()?.toLowerCase() ?? '']
    if (!mime) { setResult({ error: 'Định dạng ảnh không được hỗ trợ' }); return }
    let live = true
    const read = window.nexgraph.fs.readBinary
    if (!read) { setResult({ error: 'Không đọc được ảnh' }); return }
    void read(projectId, path).then(({ data }) => {
      if (live) setResult({ url: `data:image/${mime};base64,${data}` })
    }).catch((error: unknown) => { if (live) setResult({ error: errorText(error) }) })
    return () => { live = false }
  }, [path, projectId])
  if (target?.kind === 'external') return <a href={target.url} target="_blank" rel="noopener noreferrer">{alt || target.url}</a>
  if (!path) return <span className="md-image-note">{alt || 'Ảnh không hợp lệ'}</span>
  if (result.error) return <span className="md-image-note" title={result.error}>{alt || 'Không tải được ảnh'}</span>
  return result.url ? <img src={result.url} alt={alt ?? ''} /> : <span className="md-image-note">Đang tải ảnh…</span>
}

type TextNode = { type: string; value?: string; children?: TextNode[]; properties?: Record<string, unknown>; position?: { start: { offset?: number }; end: { offset?: number } } }
function nodeText(node: TextNode): string {
  return node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(nodeText).join('')
}

function CodeBlock({ children, node, source }: { children: ReactNode; node?: TextNode; source: string }) {
  const [copyState, setCopyState] = useState('Sao chép')
  const code = node?.children?.[0]
  const text = code ? nodeText(code) : ''
  const classes = code?.properties?.className
  const { start, end } = node?.position ?? {}
  // Khối mermaid chưa có dòng đóng rào kéo dài đến hết tài liệu: giữ dạng mã cho đến khi gõ xong.
  const mermaid = Array.isArray(classes) && classes.some((name) => String(name).toLowerCase() === 'language-mermaid')
    && start?.offset !== undefined && end?.offset !== undefined && isFenceClosed(source, start.offset, end.offset)
  return <div className="md-code-block">
    <button type="button" onClick={() => {
      if (!navigator.clipboard) return setCopyState('Không sao chép được')
      void navigator.clipboard.writeText(text).then(() => setCopyState('Đã sao chép')).catch(() => setCopyState('Không sao chép được'))
    }}>{copyState}</button>
    {mermaid ? <MermaidBlock code={text}>{children}</MermaidBlock> : <pre>{children}</pre>}
  </div>
}

function Checkbox({ checked, readOnly, onToggle }: { checked: boolean; readOnly: boolean; onToggle: (position: Position, checked: boolean) => void }) {
  const position = useContext(ItemPosition)
  return <input type="checkbox" checked={checked} disabled={!position || readOnly} aria-label={checked ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'}
    onChange={(event) => { if (position) onToggle(position, event.currentTarget.checked) }} />
}

interface Props {
  projectId: string
  file: string
  active?: boolean
  side?: boolean
  readOnly?: boolean
  loadError?: string | null
  onClose: () => void
  onOpenFile: (file: string, line?: number) => void
}

/** Xem trước Markdown trên cùng bộ đệm Monaco, kể cả nội dung chưa lưu. */
export function MarkdownPreview({ projectId, file, active = true, side = false, readOnly = false, loadError, onClose, onOpenFile }: Props) {
  const [text, setText] = useState<string | null>(null)
  const buffer = useRef<PreviewBuffer | null>(null)
  const latestText = useRef(text)
  latestText.current = text
  const opener = useRef(onOpenFile)
  opener.current = onOpenFile
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setText(null)
    const current = observeBuffer(projectId, file, setText)
    buffer.current = current
    return () => { buffer.current = null; current.dispose() }
  }, [projectId, file])
  useEffect(() => { if (active && !side) host.current?.focus() }, [active, side])
  const components = useMemo<Components>(() => ({
    li: ({ node, children, ...props }) => {
      const position = node?.position?.start
      return <li {...props}><ItemPosition.Provider value={position ? { line: position.line, column: position.column } : null}>{children}</ItemPosition.Provider></li>
    },
    input: ({ checked }) => <Checkbox checked={!!checked} readOnly={readOnly} onToggle={(position, next) => {
      if (readOnly) return
      const source = latestText.current
      if (source === null) return
      const edit = taskEdit(source, position.line, position.column, next)
      if (edit) buffer.current?.edit(source, edit)
    }} />,
    a: ({ href, children }) => {
      const target = href ? resolveReference(file, href) : null
      if (target?.kind === 'external') return <a href={target.url} target="_blank" rel="noopener noreferrer">{children}</a>
      if (target?.kind === 'file') return <a href="#" onClick={(event) => { event.preventDefault(); opener.current(target.file) }}>{children}</a>
      if (target?.kind === 'fragment') return <a href={`#${target.fragment}`} onClick={(event) => {
        event.preventDefault()
        let id: string
        try { id = decodeURIComponent(target.fragment) } catch { return }
        const seen = new Map<string, number>()
        for (const heading of host.current?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? []) {
          const slug = (heading.textContent ?? '').toLowerCase().trim().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s+/g, '-')
          const count = seen.get(slug) ?? 0
          seen.set(slug, count + 1)
          if ((count ? `${slug}-${count}` : slug) === id) { heading.scrollIntoView(); break }
        }
      }}>{children}</a>
      return <span>{children}</span>
    },
    img: ({ src, alt }) => <LocalImage projectId={projectId} sourceFile={file} src={src} alt={alt} />,
    pre: ({ children, node }) => <CodeBlock node={node as TextNode | undefined} source={latestText.current ?? ''}>{children}</CodeBlock>,
    table: ({ children }) => <div className="md-table"><table>{children}</table></div>
  }), [file, projectId, readOnly])
  return <div ref={host} tabIndex={-1} data-mirror-file={file} className={`code-viewer editor-tab markdown-preview${side ? ' editor-side' : ''}`} style={active ? undefined : { display: 'none' }}>
    <header className="code-head">
      <span className="editor-path mono" title={file}><FileTypeIcon name={file} size={14} /> Xem trước {file}</span>
      <span className="ws-editor-actions"><button type="button" className="ws-icon-button" aria-label="Đóng xem trước" title="Đóng xem trước" onClick={onClose}><Icon name="close" size={15} /></button></span>
    </header>
    <div className="md-preview-scroll">{loadError ? <p role="alert" className="error">{loadError}</p> : text === null ? <p className="muted">Đang mở nội dung…</p> :
      <article className="md-document"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={(url) => url} components={components}>{text}</ReactMarkdown></article>}
    </div>
  </div>
}
