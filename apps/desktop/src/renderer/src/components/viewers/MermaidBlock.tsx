import type { Mermaid } from 'mermaid'
import { useEffect, useState, type ReactNode } from 'react'
import { errorText } from '../../state/errorText'
import { useDebounced } from '../../state/useDebounced'
import { useTheme } from '../../state/useTheme'

// Nạp khi cần để gói mermaid không nằm trong bản tải lúc khởi động; mọi khối dùng chung một lần nạp.
let loading: Promise<Mermaid> | undefined
// Mermaid xoá phần tử cùng id trong tài liệu khi vẽ, nên mỗi lần vẽ dùng id mới để không xoá sơ đồ đã chèn.
let sequence = 0

// Mermaid đo chữ ngay sau khi gán style, còn quy tắc prefers-reduced-motion của app đặt transition-duration 0.01ms cho mọi phần tử nên số đo lấy giữa chừng chuyển tiếp và bố cục hỏng.
// Vẽ trong vùng nháp riêng đã tắt chuyển tiếp (xem markdown-preview.css); nó cũng giữ phần tử tạm của mermaid khỏi lộ ở cuối trang.
function scratchArea(): HTMLElement {
  let area = document.querySelector<HTMLElement>('.md-mermaid-scratch')
  if (!area) {
    area = document.body.appendChild(document.createElement('div'))
    area.className = 'md-mermaid-scratch'
    area.setAttribute('aria-hidden', 'true')
  }
  return area
}

/** Vẽ khối ```mermaid thành SVG. Đang vẽ hoặc vẽ lỗi thì giữ mã nguồn (`children`), lỗi kèm thông báo. */
export function MermaidBlock({ code, children }: { code: string; children: ReactNode }) {
  const theme = useTheme()
  // Gõ liên tục trong khung bên cạnh: chỉ vẽ khi nội dung đứng yên, lần đầu vẽ ngay.
  const source = useDebounced(code, 250)
  const [result, setResult] = useState<{ svg?: string; error?: string }>({})
  useEffect(() => {
    let live = true
    loading ??= import('mermaid').then((module) => module.default)
    void loading.then((mermaid) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: theme === 'dark' ? 'dark' : 'default' })
      return mermaid.render(`nexgraph-mermaid-${++sequence}`, source, scratchArea())
    }).then(({ svg }) => { if (live) setResult({ svg }) }, (error: unknown) => { if (live) setResult({ error: errorText(error) }) })
    return () => { live = false }
  }, [source, theme])
  // SVG do mermaid trả về ở securityLevel 'strict' (đã qua DOMPurify), không chèn HTML nào khác.
  if (result.svg) return <div className="md-mermaid" dangerouslySetInnerHTML={{ __html: result.svg }} />
  return <>
    {result.error && <p role="alert" className="md-mermaid-error">Không vẽ được sơ đồ: {result.error}</p>}
    <pre>{children}</pre>
  </>
}
