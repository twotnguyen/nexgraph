import type { NodeKind } from '@shared/graph-types'

// Màu theo loại nút (token ở design/mockups/shared.css); màu chỉ mang ý nghĩa.
const COLORS: Partial<Record<NodeKind, string>> = {
  class: '#3257f0', mixin: '#3257f0', enum: '#3257f0', extension: '#3257f0', screen: '#3257f0',
  widget: '#7a4df2', function: '#0a9c99', method: '#0a9c99', test: '#1c9a5b', route: '#e23d94',
  document: '#c27c00', concept: '#c27c00', repository: '#12183a', directory: '#2b9be0'
}

export function kindStyle(kind: NodeKind): { color: string } {
  return { color: COLORS[kind] ?? '#5d6685' }
}

export type HighlightKind = 'changed' | 'impacted' | 'test' | 'gap' | 'current' | 'visited'

// Màu ngữ nghĩa của vùng ảnh hưởng và luồng (spec §5.9): ảnh hưởng, test, chưa có test, bước luồng.
export const HIGHLIGHT_COLORS: Record<HighlightKind, string> = {
  changed: '#e07a00', impacted: '#e07a00', test: '#1c9a5b', gap: '#d93a2f',
  current: '#e23d94', visited: '#e23d94'
}
