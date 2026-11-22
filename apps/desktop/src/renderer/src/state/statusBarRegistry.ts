/**
 * Danh mục mục thanh trạng thái kiểu Wu. Nhãn là khoá `tr()`, lệnh phải có trong `COMMANDS`.
 * Các mục nhóm `editor` chỉ xuất hiện khi thẻ/viewer tương ứng mount và đưa mục qua portal.
 */
export type StatusBarGroup = 'engine' | 'diagnostics' | 'git' | 'editor' | 'notifications'

export interface StatusBarItem {
  id: string
  labelKey: string
  command: string
  group: StatusBarGroup
  /** Mục của provider tuỳ chọn (vim) không hiện mặc định khi chưa có provider. */
  visible?: boolean
}

export const STATUS_BAR_ITEMS: readonly StatusBarItem[] = [
  { id: 'engine', labelKey: 'Trạng thái engine', command: 'settings.open', group: 'engine' },
  { id: 'diagnostics', labelKey: 'Chẩn đoán', command: 'editor.diagnostics', group: 'diagnostics' },
  { id: 'diagnosticsDetail', labelKey: 'Chi tiết chẩn đoán', command: 'editor.next_diagnostic', group: 'diagnostics' },
  { id: 'git', labelKey: 'Git', command: 'git_panel.toggle', group: 'git' },
  { id: 'cursor', labelKey: 'Đi đến dòng', command: 'editor.goto_line', group: 'editor' },
  { id: 'selection', labelKey: 'Vùng chọn', command: 'editor.goto_line', group: 'editor' },
  { id: 'language', labelKey: 'Ngôn ngữ', command: 'editor.select_language', group: 'editor' },
  { id: 'eol', labelKey: 'Kiểu xuống dòng', command: 'editor.select_line_ending', group: 'editor' },
  // Engine chỉ lưu UTF-8; mở cài đặt để xem giải thích thay vì dựng picker giả.
  { id: 'encoding', labelKey: 'Bảng mã', command: 'settings.open', group: 'editor' },
  { id: 'indentation', labelKey: 'Thụt lề', command: 'editor.indentation_selector', group: 'editor' },
  { id: 'notifications', labelKey: 'Thông báo', command: 'notifications.toggle', group: 'notifications' },
  { id: 'vim', labelKey: 'Chế độ Vim', command: 'editor.toggle_vim', group: 'editor', visible: false }
]

export const getStatusBarItem = (id: string): StatusBarItem | undefined => STATUS_BAR_ITEMS.find((item) => item.id === id)
