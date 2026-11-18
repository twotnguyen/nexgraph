import type { NodeKind } from '@shared/graph-types'

// Màu theo loại nút (token ở design/mockups/shared.css); màu chỉ mang ý nghĩa.
const COLORS: Partial<Record<NodeKind, string>> = {
  class: 'var(--blue)', mixin: 'var(--blue)', enum: 'var(--blue)', extension: 'var(--blue)', screen: 'var(--blue)',
  widget: 'var(--violet)', function: 'var(--teal)', method: 'var(--teal)', test: 'var(--green)', route: 'var(--magenta)',
  document: 'var(--amber)', concept: 'var(--amber)', repository: 'var(--color-text)', directory: 'var(--blue)'
}

export function kindStyle(kind: NodeKind): { color: string } {
  return { color: COLORS[kind] ?? 'var(--color-muted)' }
}

export type HighlightKind = 'changed' | 'impacted' | 'test' | 'gap' | 'current' | 'visited'

// Màu ngữ nghĩa của vùng ảnh hưởng và luồng (spec §5.9): ảnh hưởng, test, chưa có test, bước luồng.
export const HIGHLIGHT_COLORS: Record<HighlightKind, string> = {
  changed: 'var(--orange)', impacted: 'var(--orange)', test: 'var(--green)', gap: 'var(--color-error-red)',
  current: 'var(--magenta)', visited: 'var(--magenta)'
}
