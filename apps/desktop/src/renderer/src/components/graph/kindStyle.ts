import type { NodeKind } from '@shared/graph-types'

// Màu theo loại nút (token ở design/mockups/shared.css); màu chỉ mang ý nghĩa.
const COLORS: Partial<Record<NodeKind, string>> = {
  class: '#1f5fbf', mixin: '#1f5fbf', enum: '#1f5fbf', extension: '#1f5fbf', screen: '#1f5fbf',
  widget: '#6a4fb3', function: '#0f7c78', method: '#0f7c78', test: '#2e7d4f', route: '#b3407a',
  document: '#8a6d1f', concept: '#8a6d1f'
}

export function kindStyle(kind: NodeKind): { color: string } {
  return { color: COLORS[kind] ?? '#5b6b7d' }
}

export type HighlightKind = 'changed' | 'impacted' | 'test' | 'gap' | 'current' | 'visited'

// Màu ngữ nghĩa của vùng ảnh hưởng và luồng (spec §5.9): ảnh hưởng, test, chưa có test, bước luồng.
export const HIGHLIGHT_COLORS: Record<HighlightKind, string> = {
  changed: '#b86e00', impacted: '#b86e00', test: '#2e7d4f', gap: '#b3261e',
  current: '#1f5fbf', visited: '#1f5fbf'
}
