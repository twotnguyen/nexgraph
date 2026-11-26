import type { AgentContextUsage } from '@nexgraph/contracts/agent-types'
import { formatNumber } from '../../state/locale'
import { tr } from '../../strings'

// Ngưỡng cảnh báo như vòng context của Wu: từ 75% vàng, từ 90% đỏ.
const WARNING = 0.75
const DANGER = 0.9
export type ContextLevel = 'normal' | 'warning' | 'danger'

/** Tỉ lệ ngữ cảnh đã dùng; null khi thiếu số hoặc cửa sổ không dương (không đoán). Có thể vượt 1 nếu backend báo quá cửa sổ. */
export function contextFraction(context: AgentContextUsage | null | undefined): number | null {
  if (!context || !Number.isFinite(context.tokens) || !Number.isFinite(context.window) || context.tokens < 0 || context.window <= 0) return null
  return context.tokens / context.window
}

export const contextLevel = (fraction: number): ContextLevel => fraction >= DANGER ? 'danger' : fraction >= WARNING ? 'warning' : 'normal'

/** Tooltip: `x / y token (z%)`. */
export function contextTooltip(context: AgentContextUsage): string {
  const fraction = contextFraction(context) ?? 0
  return tr('{used} / {total} token ({percent}%)', { used: formatNumber(context.tokens), total: formatNumber(context.window), percent: Math.round(fraction * 100) })
}

const RADIUS = 6
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Vòng nhỏ % ngữ cảnh đã dùng của phiên. Không có số tin cậy thì không vẽ gì (không hiện 0% giả). */
export function ContextRing({ context }: { context: AgentContextUsage | null | undefined }) {
  const fraction = contextFraction(context)
  if (!context || fraction === null) return null
  const tip = contextTooltip(context)
  return <span className="agent-context" data-level={contextLevel(fraction)} role="img" aria-label={tr('Ngữ cảnh đã dùng: {tip}', { tip })} title={tip}>
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle className="agent-context-track" cx="8" cy="8" r={RADIUS} />
      <circle className="agent-context-arc" cx="8" cy="8" r={RADIUS} strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - Math.min(1, fraction))} transform="rotate(-90 8 8)" />
    </svg>
    <span aria-hidden="true">{Math.round(fraction * 100)}%</span>
  </span>
}
