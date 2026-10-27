import type { NodeKind } from '@shared/graph-types'

// Màu theo loại nút (token ở design/mockups/shared.css); màu chỉ mang ý nghĩa.
const COLORS: Partial<Record<NodeKind, string>> = {
  class: '#1f5fbf', mixin: '#1f5fbf', enum: '#1f5fbf', extension: '#1f5fbf', screen: '#1f5fbf',
  widget: '#6a4fb3', function: '#0f7c78', method: '#0f7c78', test: '#2e7d4f', route: '#b3407a'
}

export function kindStyle(kind: NodeKind): { color: string } {
  return { color: COLORS[kind] ?? '#5b6b7d' }
}
