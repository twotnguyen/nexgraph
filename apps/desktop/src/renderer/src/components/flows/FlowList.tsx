import type { FlowKind, FlowSummary } from '@nexgraph/contracts/graph-types'
import { tr, vi } from '../../strings'
import { useLocale } from '../../state/locale'

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
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onLoadMore?: () => void
}

/** Nhãn loại luồng tính lúc render: đổi ngôn ngữ là đổi ngay, không chốt bản dịch lúc nạp module. */
const kinds = (): { key?: FlowKind; label: string }[] => [
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
  loading,
  error,
  onRetry,
  onLoadMore
}: Props) {
  useLocale()
  return (
    <aside className="flow-list-col">
      <div className="list-header">
        <input
          type="search"
          aria-label={vi.flows.search}
          className="search-box"
          placeholder={vi.flows.search}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <div className="kind-filter" role="group" aria-label={tr('Loại luồng')}>
          {kinds().map((k) => (
            <button
              key={`${k.key}:${k.label}`}
              type="button"
              aria-pressed={currentKind === k.key}
              className={`kind-chip ${currentKind === k.key ? 'active' : ''}`}
              onClick={() => onKindChange(k.key)}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flow-items" aria-busy={loading}>
        {loading && <p role="status" className="muted small flow-message">{tr('Đang tải danh sách luồng…')}</p>}
        {error && <div className="flow-message"><p role="alert" className="error">{error}</p>
          {onRetry && <button type="button" onClick={onRetry}>{tr('Thử lại')}</button>}</div>}
        {flows.length === 0 && !loading && !error ? (
          <p className="muted small center" style={{ padding: 16 }}>
            {query || currentKind ? vi.flows.noMatch : vi.flows.empty}
          </p>
        ) : (
          flows.map((f) => {
            const isSelected = f.id === selectedId
            const pct = Math.round(f.criticality * 100)
            return (
              <button
                key={f.id}
                type="button"
                className={`flow-card ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelect(f.id)}
                aria-pressed={isSelected}
              >
                <span className="flow-card-title">
                  <span>{f.name}</span>
                  <span className="flow-card-kind">{f.kind}</span>
                </span>
                {f.detail && <span className="flow-card-detail">{f.detail}</span>}
                {/* hai controller có thể cùng tên phương thức: tệp của điểm vào là thứ phân biệt chúng */}
                {f.entry.file && <span className="flow-card-detail" title={f.entry.file}>{f.entry.file.split('/').pop()}</span>}
                <span className="flow-card-meta">
                  <span>{vi.flows.meta(f.steps, f.files)}</span>
                  <span className="crit-bar" title={vi.flows.criticality(pct)}>
                    <span className="crit-fill" style={{ width: `${pct}%` }} />
                  </span>
                </span>
              </button>
            )
          })
        )}
      </div>

      {flows.length > 0 && (
        <div className="list-footer">
          <span>{vi.flows.shown(flows.length, total)}</span>
          {truncated && onLoadMore && (
            <button type="button" className="link small" disabled={loading} onClick={onLoadMore} style={{ marginLeft: 8 }}>
              {vi.flows.more}
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
