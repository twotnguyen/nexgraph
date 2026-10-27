import { useEffect } from 'react'
import type { ArchEvidence } from '@shared/graph-types'
import { vi } from '../../strings'

interface Props {
  items: ArchEvidence[]
  loading: boolean
  error: string | null
  title?: string
  onOpenNode: (nodeId: string) => void
  onClose: () => void
}

/** "lib/a.dart::A.run#method" -> "A.run"; "lib/a.dart#file" -> "a.dart". */
export function shortName(id: string): string {
  const base = id.split('#')[0]
  return base.includes('::') ? (base.split('::').pop() as string) : (base.split('/').pop() as string)
}

export function EvidencePopover({ items, loading, error, title, onOpenNode, onClose }: Props) {
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
      {error && <p role="alert" className="error">{error}</p>}
      {!loading && !error && items.length === 0 && <p className="muted">{vi.arch.noEvidence}</p>}
      {!loading && items.length > 0 && (
        <ul>
          {items.map((it) => (
            <li key={`${it.edge.id}`}>
              <button type="button" onClick={() => onOpenNode(it.edge.source)}>
                <span className="mono">{`${it.file}:${it.line}`}</span>
                <span className="kind">{it.edge.type}</span>
                <span>{`${shortName(it.edge.source)} → ${shortName(it.edge.target)}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
