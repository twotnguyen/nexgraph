import type { FlowKind, FlowSummary } from '@shared/graph-types'
import { vi } from '../../strings'

interface Props {
  flows: FlowSummary[]
  total: number
  selectedId: number | null
  onSelect: (id: number) => void
  query: string
  onQueryChange: (q: string) => void
  currentKind?: FlowKind
  onKindChange: (kind?: FlowKind) => void
  truncated: boolean
  onLoadMore?: () => void
}

const KINDS: { key?: FlowKind; label: string }[] = [
  { key: undefined, label: vi.flows.kindAll },
  { key: 'route', label: vi.flows.kinds.route },
  { key: 'main', label: vi.flows.kinds.main },
  { key: 'cli', label: vi.flows.kinds.cli },
  { key: 'event', label: vi.flows.kinds.event },
  { key: 'root', label: vi.flows.kinds.root }
]

export function FlowList({
  flows,
  total,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  currentKind,
  onKindChange,
  truncated,
  onLoadMore
}: Props) {
  return (
    <aside className="flow-list-col">
      <div className="list-header">
        <input
          type="search"
          className="search-box"
          placeholder={vi.flows.search}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <div className="kind-filter" role="tablist">
          {KINDS.map((k) => (
            <button
              key={`${k.key}:${k.label}`}
              type="button"
              className={`kind-chip ${currentKind === k.key ? 'active' : ''}`}
              onClick={() => onKindChange(k.key)}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flow-items">
        {flows.length === 0 ? (
          <p className="muted small center" style={{ padding: 16 }}>
            {query || currentKind ? vi.flows.noMatch : vi.flows.empty}
          </p>
        ) : (
          flows.map((f) => {
            const isSelected = f.id === selectedId
            const pct = Math.round(f.criticality * 100)
            return (
              <div
                key={f.id}
                role="button"
                tabIndex={0}
                className={`flow-card ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelect(f.id)}
                onKeyDown={(e) => e.key === 'Enter' && onSelect(f.id)}
                aria-pressed={isSelected}
              >
                <div className="flow-card-title">
                  <span>{f.name}</span>
                  <span className="flow-card-kind">{f.kind}</span>
                </div>
                {f.detail && <div className="flow-card-detail">{f.detail}</div>}
                {/* hai controller có thể cùng tên phương thức: tệp của điểm vào là thứ phân biệt chúng */}
                {f.entry.file && <div className="flow-card-detail" title={f.entry.file}>{f.entry.file.split('/').pop()}</div>}
                <div className="flow-card-meta">
                  <span>{vi.flows.meta(f.steps, f.files)}</span>
                  <div className="crit-bar" title={vi.flows.criticality(pct)}>
                    <div className="crit-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {flows.length > 0 && (
        <div className="list-footer">
          <span>{vi.flows.shown(flows.length, total)}</span>
          {truncated && onLoadMore && (
            <button type="button" className="link small" onClick={onLoadMore} style={{ marginLeft: 8 }}>
              {vi.flows.more}
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
