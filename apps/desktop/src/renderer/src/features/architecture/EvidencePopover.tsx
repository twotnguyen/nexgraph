import { useEffect } from 'react'
import type { ArchEvidence } from '@nexgraph/contracts/graph-types'
import { vi } from '../../i18n/strings'
import { msgText, type Message } from '../../shared/lib/messages'

interface Props {
  items: ArchEvidence[]
  loading: boolean
  error: Message | null
  title?: string
  onOpenNode: (nodeId: string) => void
  /** Khi có: bấm mục mở mã tại tệp:dòng, còn nút "Xem nút" mở nút ở thẻ Graph. */
  onOpenCode?: (file: string, line: number) => void
  onClose: () => void
}

/** "lib/a.dart::A.run#method" -> "A.run"; "lib/a.dart#file" -> "a.dart". */
export function shortName(id: string): string {
  const base = id.split('#')[0]
  return base.includes('::') ? (base.split('::').pop() as string) : (base.split('/').pop() as string)
}

export function EvidencePopover({ items, loading, error, title, onOpenNode, onOpenCode, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div role="dialog" aria-label={vi.arch.evidence} className="evidence-popover">
      <header>
        <b>{title ?? vi.arch.evidence}</b>
        <button type="button" aria-label={vi.arch.close} onClick={onClose}>×</button>
      </header>
      {loading && <p className="muted">{vi.arch.loading}</p>}
      {error && <p role="alert" className="error">{msgText(error)}</p>}
      {!loading && !error && items.length === 0 && <p className="muted">{vi.arch.noEvidence}</p>}
      {!loading && items.length > 0 && (
        <ul>
          {items.map((it) => (
            <li key={`${it.edge.id}`}>
              <button type="button" onClick={() => (onOpenCode ? onOpenCode(it.file, it.line) : onOpenNode(it.edge.source))}>
                <span className="mono">{`${it.file}:${it.line}`}</span>
                <span className="kind">{it.edge.type}</span>
                <span>{`${shortName(it.edge.source)} → ${shortName(it.edge.target)}`}</span>
              </button>
              {onOpenCode && (
                <button type="button" className="link" onClick={() => onOpenNode(it.edge.source)}>{vi.code.viewNode}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
