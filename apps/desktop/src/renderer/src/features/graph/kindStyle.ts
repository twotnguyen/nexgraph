import type { NodeKind } from '@nexgraph/contracts/graph-types'
import { getLocale } from '../../shared/lib/locale'

// Màu theo loại nút (token ở design/mockups/shared.css); màu chỉ mang ý nghĩa.
const COLORS: Partial<Record<NodeKind, string>> = {
  class: 'var(--blue)', mixin: 'var(--blue)', enum: 'var(--blue)', extension: 'var(--blue)', screen: 'var(--blue)',
  widget: 'var(--violet)', function: 'var(--teal)', method: 'var(--teal)', test: 'var(--green)', route: 'var(--magenta)',
  document: 'var(--amber)', concept: 'var(--amber)', repository: 'var(--color-text)', directory: 'var(--blue)',
  type: 'var(--blue)', table: 'var(--violet)', resource: 'var(--magenta)'
}

export function kindStyle(kind: NodeKind): { color: string } {
  return { color: COLORS[kind] ?? 'var(--color-muted)' }
}

/** Nhãn hiển thị của loại nút; dữ liệu `kind` vẫn giữ nguyên tiếng Anh. */
const KIND_LABELS: Record<NodeKind, { vi: string; en: string }> = {
  repository: { vi: 'Kho mã', en: 'Repository' }, package: { vi: 'Gói', en: 'Package' },
  directory: { vi: 'Thư mục', en: 'Directory' }, file: { vi: 'Tệp', en: 'File' },
  module: { vi: 'Mô-đun', en: 'Module' }, class: { vi: 'Lớp', en: 'Class' },
  mixin: { vi: 'Mixin', en: 'Mixin' }, enum: { vi: 'Enum', en: 'Enum' },
  extension: { vi: 'Extension', en: 'Extension' }, function: { vi: 'Hàm', en: 'Function' },
  method: { vi: 'Phương thức', en: 'Method' }, test: { vi: 'Test', en: 'Test' },
  widget: { vi: 'Widget', en: 'Widget' }, screen: { vi: 'Màn hình', en: 'Screen' },
  route: { vi: 'Route', en: 'Route' }, document: { vi: 'Tài liệu', en: 'Document' },
  concept: { vi: 'Khái niệm', en: 'Concept' }, type: { vi: 'Kiểu', en: 'Type' },
  variable: { vi: 'Biến', en: 'Variable' }, table: { vi: 'Bảng', en: 'Table' },
  resource: { vi: 'Tài nguyên', en: 'Resource' }, config_key: { vi: 'Khoá cấu hình', en: 'Config key' }
}

export function kindLabel(kind: NodeKind): string {
  const label = KIND_LABELS[kind]
  if (!label) return kind
  return getLocale() === 'en' ? label.en : label.vi
}

export type HighlightKind = 'changed' | 'impacted' | 'test' | 'gap' | 'current' | 'visited'

// Màu ngữ nghĩa của vùng ảnh hưởng và luồng (spec §5.9): ảnh hưởng, test, chưa có test, bước luồng.
export const HIGHLIGHT_COLORS: Record<HighlightKind, string> = {
  changed: 'var(--orange)', impacted: 'var(--orange)', test: 'var(--green)', gap: 'var(--color-error-red)',
  current: 'var(--magenta)', visited: 'var(--magenta)'
}
