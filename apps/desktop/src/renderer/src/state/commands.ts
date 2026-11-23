import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import { BASE_KEYMAPS, type BaseKeymapId } from './baseKeymaps'

/**
 * Lệnh của ứng dụng: danh sách tĩnh (để bảng lệnh và trang Phím tắt biết mọi lệnh) cộng handler do màn đang mở gắn vào.
 * Phím viết dạng "mod+shift+p"; hợp âm hai bước cách nhau dấu cách ("mod+k mod+t"). mod = ⌘ trên macOS, Ctrl nơi khác.
 */
export interface CommandDef {
  id: string
  title: string
  category: string
  key?: string
}

/** Lệnh dựng sẵn; extension thêm lệnh vào cuối bằng `addCommands`. */
export const COMMANDS: CommandDef[] = [
  { id: 'command_palette.toggle', category: 'Bảng lệnh', title: 'Mở bảng lệnh', key: 'mod+shift+p' },
  { id: 'picker.reopen', category: 'Ứng dụng', title: 'Mở lại bộ chọn gần đây', key: 'mod+k mod+p' },
  { id: 'file_finder.toggle', category: 'Tệp', title: 'Tìm và mở tệp', key: 'mod+p' },
  { id: 'file.new', category: 'Tệp', title: 'Tệp văn bản mới', key: 'mod+n' },
  { id: 'file.new_dialog', category: 'Tệp', title: 'Tệp mới…' },
  { id: 'file.open', category: 'Tệp', title: 'Mở tệp…', key: 'mod+o' },
  { id: 'folder.open', category: 'Tệp', title: 'Mở thư mục…', key: 'mod+k mod+o' },
  { id: 'file.open_recent', category: 'Tệp', title: 'Mở gần đây', key: 'mod+k mod+r' },
  { id: 'file.save_all', category: 'Tệp', title: 'Lưu tất cả', key: 'mod+k s' },
  { id: 'file.save_as', category: 'Tệp', title: 'Lưu thành…', key: 'mod+shift+s' },
  { id: 'file.revert', category: 'Tệp', title: 'Hoàn tác tệp' },
  { id: 'folder.close', category: 'Tệp', title: 'Đóng thư mục', key: 'mod+k f' },
  { id: 'editor.close_f4', category: 'Thẻ', title: 'Đóng editor', key: 'ctrl+f4' },
  { id: 'window.new', category: 'Ứng dụng', title: 'Cửa sổ mới', key: 'mod+shift+n' },
  { id: 'window.close', category: 'Ứng dụng', title: 'Đóng cửa sổ' },
  { id: 'theme_selector.toggle', category: 'Giao diện', title: 'Chọn theme', key: 'mod+k mod+t' },
  { id: 'settings.open', category: 'Ứng dụng', title: 'Mở cài đặt', key: 'mod+,' },
  { id: 'keymap.open', category: 'Ứng dụng', title: 'Mở phím tắt', key: 'mod+k mod+s' },
  { id: 'notification.clear', category: 'Ứng dụng', title: 'Xoá tất cả thông báo' },
  { id: 'notifications.toggle', category: 'Ứng dụng', title: 'Mở trung tâm thông báo' },
  { id: 'projects.open', category: 'Ứng dụng', title: 'Về danh sách dự án' },
  { id: 'agent.toggle', category: 'Trợ lý AI', title: 'Bật/tắt khung trợ lý', key: 'mod+l' },
  { id: 'explorer.toggle', category: 'Bảng công cụ', title: 'Hiện cây tệp', key: 'mod+shift+e' },
  { id: 'graph_search.toggle', category: 'Bảng công cụ', title: 'Tìm trong đồ thị' },
  { id: 'project_search.toggle', category: 'Bảng công cụ', title: 'Tìm và thay trong tệp', key: 'mod+shift+f' },
  { id: 'changes.toggle', category: 'Bảng công cụ', title: 'Hiện thay đổi và vùng ảnh hưởng' },
  { id: 'git_panel.toggle', category: 'Git', title: 'Hiện Git panel', key: 'ctrl+shift+g' },
  { id: 'git.blame', category: 'Git', title: 'Bật/tắt blame từng dòng' },
  { id: 'git.worktree', category: 'Git', title: 'Worktree' },
  { id: 'git.copy_permalink', category: 'Git', title: 'Sao chép permalink tới dòng' },
  { id: 'git.open_permalink', category: 'Git', title: 'Mở permalink tới dòng' },
  { id: 'debug.toggle', category: 'Gỡ lỗi', title: 'Hiện bảng Gỡ lỗi', key: 'mod+shift+d' },
  { id: 'debug.start', category: 'Gỡ lỗi', title: 'Bắt đầu / chạy tiếp', key: 'f5' },
  { id: 'debug.step_over', category: 'Gỡ lỗi', title: 'Bước qua', key: 'f10' },
  { id: 'debug.step_into', category: 'Gỡ lỗi', title: 'Bước vào', key: 'f11' },
  { id: 'debug.step_out', category: 'Gỡ lỗi', title: 'Bước ra', key: 'shift+f11' },
  { id: 'debug.stop', category: 'Gỡ lỗi', title: 'Dừng gỡ lỗi', key: 'shift+f5' },
  { id: 'debug.pause', category: 'Gỡ lỗi', title: 'Tạm dừng', key: 'f6' },
  { id: 'debug.restart', category: 'Gỡ lỗi', title: 'Chạy lại phiên', key: 'mod+shift+f5' },
  { id: 'debug.toggle_breakpoint', category: 'Gỡ lỗi', title: 'Bật/tắt điểm dừng', key: 'f9' },
  { id: 'debug.edit_breakpoint', category: 'Gỡ lỗi', title: 'Sửa điểm dừng', key: 'shift+f9' },
  { id: 'debug.clear_breakpoints', category: 'Gỡ lỗi', title: 'Xoá tất cả điểm dừng' },
  { id: 'collab.share', category: 'Cộng tác', title: 'Chia sẻ tệp đang mở trong mạng LAN' },
  { id: 'collab.join', category: 'Cộng tác', title: 'Tham gia phiên của máy khác' },
  { id: 'collab.leave', category: 'Cộng tác', title: 'Rời / dừng phiên cộng tác' },
  { id: 'tour.toggle', category: 'Bảng công cụ', title: 'Hiện tour dự án' },
  { id: 'tab.close', category: 'Thẻ', title: 'Đóng thẻ đang mở', key: 'mod+w' },
  { id: 'tab.reopen', category: 'Thẻ', title: 'Mở lại thẻ vừa đóng', key: 'mod+shift+t' },
  { id: 'tab.next_mru', category: 'Thẻ', title: 'Chuyển sang thẻ dùng gần đây', key: 'ctrl+tab' },
  { id: 'tab.previous_mru', category: 'Thẻ', title: 'Chuyển ngược thẻ dùng gần đây', key: 'ctrl+shift+tab' },
  ...Array.from({ length: 10 }, (_, n) => ({ id: `tab.activate_${n}`, category: 'Thẻ', title: n ? `Mở thẻ ${n}` : 'Mở thẻ cuối', key: `ctrl+${n}` })),
  { id: 'tab.pin', category: 'Thẻ', title: 'Ghim / bỏ ghim thẻ', key: 'mod+k shift+enter' },
  { id: 'dock.left', category: 'Bảng công cụ', title: 'Ẩn / hiện bảng bên trái', key: 'mod+b' },
  { id: 'dock.right', category: 'Bảng công cụ', title: 'Ẩn / hiện bảng bên phải', key: 'alt+shift+b' }, // mod+alt+b của Wu thuộc editor.implementation trong base JetBrains
  { id: 'dock.all', category: 'Bảng công cụ', title: 'Ẩn / hiện tất cả bảng', key: 'mod+alt+y' },
  { id: 'dock.bottom', category: 'Terminal', title: 'Ẩn / hiện terminal', key: 'mod+j' },
  { id: 'editor.split_right', category: 'Editor', title: 'Chia đôi sang phải / bỏ chia đôi', key: 'mod+\\' },
  { id: 'editor.toggle_read_only', category: 'Editor', title: 'Bật/tắt chế độ chỉ đọc cho thẻ', key: 'mod+k shift+r' },
  { id: 'editor.split_up', category: 'Editor', title: 'Chia đôi lên trên / bỏ chia đôi' },
  { id: 'editor.split_down', category: 'Editor', title: 'Chia đôi xuống dưới / bỏ chia đôi' },
  { id: 'editor.split_left', category: 'Editor', title: 'Chia đôi sang trái / bỏ chia đôi' },
  { id: 'focus.next_part', category: 'Editor', title: 'Chuyển tiêu điểm sang phần tiếp theo', key: 'mod+f6' }, // f6 thuộc debug.pause
  { id: 'focus.previous_part', category: 'Editor', title: 'Chuyển tiêu điểm sang phần trước đó', key: 'mod+shift+f6' }, // shift+f6 thuộc editor.rename trong base JetBrains
  { id: 'editor.toggle_vim', category: 'Editor', title: 'Bật/tắt chế độ Vim' },
  { id: 'editor.goto_line', category: 'Editor', title: 'Đi đến dòng', key: 'ctrl+g' },
  { id: 'editor.document_symbols', category: 'Editor', title: 'Tìm ký hiệu trong tệp', key: 'mod+shift+o' },
  { id: 'editor.workspace_symbols', category: 'Editor', title: 'Tìm ký hiệu trong dự án', key: 'mod+t' },
  { id: 'editor.diagnostics', category: 'Editor', title: 'Hiện lỗi trong dự án', key: 'mod+shift+m' },
  { id: 'editor.rename', category: 'Editor', title: 'Đổi tên ký hiệu', key: 'f2' },
  { id: 'editor.implementation', category: 'Editor', title: 'Đi đến phần triển khai', key: 'shift+f12' },
  // Wu: ⌃F12 khai báo, ⌘F12 định nghĩa kiểu. Ngoài macOS ⌃ thành mod nên khai báo thêm ⌥ để không trùng ⌘F12.
  { id: 'editor.declaration', category: 'Editor', title: 'Đi đến khai báo', key: 'ctrl+alt+f12' },
  // ⌘F12 thuộc editor.implementation trong base VS Code và editor.document_symbols trong base JetBrains: chọn base đó thì lệnh này mất phím như các lệnh khác.
  { id: 'editor.type_definition', category: 'Editor', title: 'Đi đến định nghĩa kiểu', key: 'mod+f12' },
  { id: 'editor.references', category: 'Editor', title: 'Tìm tham chiếu', key: 'alt+shift+f12' },
  { id: 'editor.next_diagnostic', category: 'Editor', title: 'Lỗi tiếp theo', key: 'f8' },
  { id: 'editor.previous_diagnostic', category: 'Editor', title: 'Lỗi trước đó', key: 'shift+f8' },
  { id: 'editor.format', category: 'Editor', title: 'Định dạng tệp', key: 'alt+shift+f' },
  { id: 'editor.code_actions', category: 'Editor', title: 'Thao tác mã', key: 'mod+.' },
  { id: 'editor.toggle_bookmark', category: 'Editor', title: 'Bật/tắt dấu trang dòng', key: 'mod+k b' }, // mod+k mod+b thuộc dock.left của base Sublime
  { id: 'editor.next_bookmark', category: 'Editor', title: 'Dấu trang tiếp theo', key: 'alt+pagedown' },
  { id: 'editor.previous_bookmark', category: 'Editor', title: 'Dấu trang trước đó', key: 'alt+pageup' },
  { id: 'editor.view_bookmarks', category: 'Editor', title: 'Xem danh sách dấu trang' },
  { id: 'editor.select_larger', category: 'Editor', title: 'Mở rộng vùng chọn theo cú pháp', key: 'mod+ctrl+arrowright' },
  { id: 'editor.select_smaller', category: 'Editor', title: 'Thu hẹp vùng chọn theo cú pháp', key: 'mod+ctrl+arrowleft' },
  { id: 'editor.next_syntax', category: 'Editor', title: 'Chọn node cú pháp tiếp theo', key: 'mod+ctrl+arrowdown' },
  { id: 'editor.previous_syntax', category: 'Editor', title: 'Chọn node cú pháp trước đó', key: 'mod+ctrl+arrowup' },
  { id: 'editor.call_hierarchy_incoming', category: 'Editor', title: 'Xem lời gọi đến', key: 'mod+k mod+h' },
  { id: 'editor.call_hierarchy_outgoing', category: 'Editor', title: 'Xem lời gọi đi', key: 'mod+alt+h' },
  { id: 'editor.open_multibuffer', category: 'Editor', title: 'Mở multibuffer', key: 'mod+k mod+m' },
  { id: 'editor.toggle_line_numbers', category: 'Editor', title: 'Bật/tắt số dòng', key: 'mod+;' },
  { id: 'editor.toggle_minimap', category: 'Editor', title: 'Bật/tắt bản đồ thu nhỏ', key: 'mod+alt+m' },
  { id: 'editor.toggle_soft_wrap', category: 'Editor', title: 'Bật/tắt xuống dòng mềm', key: 'mod+k z' },
  { id: 'editor.toggle_whitespace', category: 'Editor', title: 'Bật/tắt khoảng trắng', key: 'mod+k mod+w' },
  { id: 'editor.toggle_sticky_scroll', category: 'Editor', title: 'Bật/tắt cuộn dính', key: 'mod+alt+s' },
  { id: 'editor.toggle_breadcrumbs', category: 'Editor', title: 'Bật/tắt thanh điều hướng', key: 'mod+alt+shift+c' }, // mod+alt+b thuộc Implementation của base JetBrains
  { id: 'editor.toggle_inlay_hints', category: 'Editor', title: 'Bật/tắt gợi ý trong dòng', key: 'mod+alt+shift+i' }, // mod+ctrl+i của base VS Code thành mod+alt+i ngoài macOS
  { id: 'editor.toggle_semantic_highlights', category: 'Editor', title: 'Bật/tắt tô sáng ngữ nghĩa', key: 'mod+alt+shift+s' },
  { id: 'editor.toggle_code_lens', category: 'Editor', title: 'Bật/tắt Code Lens', key: 'mod+alt+shift+l' }, // mod+alt+l thuộc Reformat Code của base JetBrains
  { id: 'editor.toggle_colorize_brackets', category: 'Editor', title: 'Bật/tắt tô màu ngoặc', key: 'mod+alt+shift+b' },
  { id: 'editor.toggle_fold_all', category: 'Editor', title: 'Bật/tắt thu gọn tất cả', key: 'mod+k mod+l' }, // mod+shift+enter thuộc view.zoom_pane
  { id: 'editor.toggle_auto_signature_help', category: 'Editor', title: 'Bật/tắt gợi ý chữ ký tự động', key: 'mod+alt+shift+g' },
  { id: 'editor.toggle_inline_diagnostics', category: 'Editor', title: 'Bật/tắt chẩn đoán trong dòng', key: 'mod+alt+shift+d' },
  { id: 'editor.toggle_hover', category: 'Editor', title: 'Bật/tắt thông tin khi di chuột', key: 'mod+alt+shift+e' }, // mod+alt+shift+h thuộc search.toggle_replace
  { id: 'editor.toggle_cursor_blink', category: 'Editor', title: 'Bật/tắt chớp con trỏ' },
  { id: 'editor.set_cursor_shape', category: 'Editor', title: 'Chọn kiểu con trỏ' },
  { id: 'editor.toggle_current_line_highlight', category: 'Editor', title: 'Bật/tắt tô sáng dòng hiện tại' },
  { id: 'editor.toggle_selection_highlight', category: 'Editor', title: 'Bật/tắt tô sáng vùng chọn' },
  { id: 'editor.select_next_occurrence', category: 'Editor', title: 'Chọn lần xuất hiện tiếp theo', key: 'mod+d' },
  { id: 'editor.select_all_occurrences', category: 'Editor', title: 'Chọn tất cả lần xuất hiện', key: 'mod+alt+shift+a' }, // mod+shift+l thuộc Chat của base JetBrains
  { id: 'editor.add_cursor_above', category: 'Editor', title: 'Thêm con trỏ phía trên', key: 'mod+alt+shift+arrowup' }, // mod+alt+arrowup là Syntax Node trước đó ngoài macOS
  { id: 'editor.add_cursor_below', category: 'Editor', title: 'Thêm con trỏ phía dưới', key: 'mod+alt+shift+arrowdown' }, // mod+alt+arrowdown là Syntax Node tiếp theo ngoài macOS
  { id: 'editor.move_line_up', category: 'Editor', title: 'Di chuyển dòng lên', key: 'alt+arrowup' },
  { id: 'editor.move_line_down', category: 'Editor', title: 'Di chuyển dòng xuống', key: 'alt+arrowdown' },
  { id: 'editor.duplicate_line', category: 'Editor', title: 'Nhân đôi dòng', key: 'alt+shift+arrowdown' },
  { id: 'editor.copy_and_trim', category: 'Editor', title: 'Sao chép và cắt bỏ', key: 'mod+k c' },
  { id: 'editor.toggle_comment', category: 'Editor', title: 'Bật/tắt chú thích', key: 'mod+/' },
  { id: 'editor.select_line_ending', category: 'Editor', title: 'Chọn kết thúc dòng' },
  { id: 'editor.indentation_selector', category: 'Editor', title: 'Chọn kiểu thụt lề (indent)' },
  { id: 'editor.select_language', category: 'Editor', title: 'Chọn ngôn ngữ', key: 'mod+k l' },
  { id: 'markdown.preview', category: 'Markdown', title: 'Mở / đóng xem trước Markdown', key: 'mod+shift+v' },
  { id: 'markdown.preview_side', category: 'Markdown', title: 'Xem trước Markdown bên cạnh', key: 'mod+k v' },
  { id: 'table.preview', category: 'CSV/TSV', title: 'Chuyển giữa dạng bảng và mã nguồn' },
  { id: 'image.zoom_in', category: 'Ảnh', title: 'Phóng to ảnh', key: 'mod+=' },
  { id: 'image.zoom_out', category: 'Ảnh', title: 'Thu nhỏ ảnh', key: 'mod+-' },
  { id: 'image.reset_zoom', category: 'Ảnh', title: 'Đặt lại độ phóng ảnh', key: 'mod+0' },
  { id: 'image.fit_to_view', category: 'Ảnh', title: 'Vừa khung xem', key: 'mod+shift+0' },
  { id: 'terminal.toggle', category: 'Terminal', title: 'Bật/tắt terminal', key: 'ctrl+`' },
  { id: 'terminal.new', category: 'Terminal', title: 'Terminal mới', key: 'ctrl+shift+`' },
  { id: 'task.spawn', category: 'Task', title: 'Chạy task', key: 'mod+shift+r' },
  { id: 'task.rerun', category: 'Task', title: 'Chạy lại task gần nhất', key: 'mod+alt+r' },
  { id: 'view.arch', category: 'Xem', title: 'Kiến trúc' },
  { id: 'view.map', category: 'Xem', title: 'Bản đồ' },
  { id: 'view.flows', category: 'Xem', title: 'Luồng' },
  { id: 'view.graph', category: 'Xem', title: 'Graph' },
  { id: 'view.tree', category: 'Xem', title: 'Cây' },
  { id: 'view.report', category: 'Xem', title: 'Báo cáo' },
  { id: 'view.zoom_pane', category: 'Xem', title: 'Phóng to cửa sổ đang chọn', key: 'mod+shift+enter' },
  { id: 'view.centered_layout', category: 'Xem', title: 'Bố cục giữa' },
  { id: 'graph.export', category: 'Đồ thị', title: 'Xuất đồ thị' },
  { id: 'project.overview', category: 'Dự án', title: 'Về tổng quan dự án' },
  { id: 'search.toggle_case', category: 'Tìm kiếm', title: 'Bật/tắt phân biệt hoa thường', key: 'mod+alt+c' },
  { id: 'search.toggle_whole_word', category: 'Tìm kiếm', title: 'Bật/tắt toàn từ', key: 'mod+alt+w' },
  { id: 'search.toggle_regex', category: 'Tìm kiếm', title: 'Bật/tắt regex', key: 'mod+alt+shift+r' }, // mod+alt+r thuộc task.rerun
  { id: 'search.toggle_replace', category: 'Tìm kiếm', title: 'Bật/tắt thay thế', key: 'mod+alt+shift+h' }, // mod+alt+h thuộc editor.call_hierarchy_outgoing
  { id: 'search.toggle_filters', category: 'Tìm kiếm', title: 'Bật/tắt bộ lọc', key: 'mod+alt+f' },
  { id: 'search.refresh', category: 'Tìm kiếm', title: 'Làm mới kết quả', key: 'mod+alt+g' },
  { id: 'search.clear', category: 'Tìm kiếm', title: 'Xoá tìm kiếm', key: 'mod+alt+k' },
  { id: 'search.collapse_all', category: 'Tìm kiếm', title: 'Thu gọn tất cả', key: 'mod+alt+shift+x' },
  { id: 'search.open_in_editor', category: 'Tìm kiếm', title: 'Mở trong editor', key: 'mod+alt+shift+o' }, // mod+alt+o của editor.workspace_symbols trong base JetBrains
  { id: 'navigation.back', category: 'Điều hướng', title: 'Quay lại', key: 'alt+arrowleft' }, // ctrl+- thành mod+- ngoài macOS, trùng image.zoom_out
  { id: 'navigation.forward', category: 'Điều hướng', title: 'Tiến tới', key: 'ctrl+shift+-' },
  { id: 'hierarchy.switch_direction', category: 'Editor', title: 'Đổi hướng lời gọi', key: 'mod+k mod+shift+h' }, // alt+mod+h chuẩn hoá thành mod+alt+h của outgoing
  { id: 'hierarchy.back', category: 'Editor', title: 'Quay lại lời gọi trước' }
]

const handlers = new Map<string, (() => void)[]>()
const CHANGED = 'nexgraph:keybindings'

/** Cài đặt ẩn Không gian làm việc nhưng giữ buffer; không để lệnh của màn đã ẩn chạy. */
export const CommandsEnabled = createContext(true)

/** Gắn handler cho một lệnh; trả về hàm gỡ. Handler gắn sau cùng thắng. */
export function registerHandler(id: string, fn: () => void): () => void {
  const added = !handlers.has(id)
  handlers.set(id, [...(handlers.get(id) ?? []), fn])
  if (added) window.dispatchEvent(new Event(CHANGED))
  return () => {
    const rest = (handlers.get(id) ?? []).filter((item) => item !== fn)
    if (rest.length) handlers.set(id, rest)
    else { handlers.delete(id); window.dispatchEvent(new Event(CHANGED)) }
  }
}

/** Gắn handler cho lệnh khi component còn mount. */
export function useCommand(id: string, run: () => void, enabled = true): void {
  const latest = useRef(run)
  latest.current = run
  const scoped = useContext(CommandsEnabled)
  useEffect(() => (enabled && scoped ? registerHandler(id, () => latest.current()) : undefined), [id, enabled, scoped])
}

/** Thêm lệnh của extension (bỏ id trùng); trang Phím tắt và bảng lệnh thấy ngay. */
export function addCommands(defs: readonly CommandDef[]): void {
  for (const def of defs) if (!COMMANDS.some((c) => c.id === def.id)) COMMANDS.push(def)
  notifyKeymap()
}
export function removeCommands(prefix: string): void {
  for (let i = COMMANDS.length - 1; i >= 0; i--) if (COMMANDS[i].id.startsWith(prefix)) COMMANDS.splice(i, 1)
  notifyKeymap()
}

export function runCommand(id: string): boolean {
  const fn = handlers.get(id)?.at(-1)
  if (!fn) return false
  fn()
  return true
}

/** Lệnh đang chạy được ở màn hiện tại. */
export const availableCommands = (): CommandDef[] => COMMANDS.filter((command) => handlers.has(command.id))

// --- Phím tắt: ba lớp mặc định < base keymap < người dùng. Lớp người dùng chỉ lưu phần khác lớp dưới ("" = bỏ phím). ---
const STORE = 'nexgraph.keybindings'
const BASE_STORE = 'nexgraph.keymap.base'

let overrides: Record<string, string> = (() => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORE) ?? '{}')
    return parsed && typeof parsed === 'object' ? Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) : {}
  } catch {
    return {}
  }
})()
let baseId: BaseKeymapId = (() => {
  try {
    const id = localStorage.getItem(BASE_STORE)
    return id !== null && Object.hasOwn(BASE_KEYMAPS, id) ? (id as BaseKeymapId) : 'default'
  } catch {
    return 'default'
  }
})()

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
// Ngoài macOS phím Ctrl chính là "mod": phím mặc định viết "ctrl+…" (như ctrl+` của Wu) phải khớp với lần nhấn đã chuẩn hoá thành "mod+…".
// ⌃⌘X của macOS (base keymap VS Code) tương ứng Ctrl+Alt+X.
const forPlatform = (key: string) => (IS_MAC ? key : key.replace(/\bmod\+ctrl\+/g, 'mod+alt+').replace(/\bctrl\+/g, 'mod+'))

export type KeySource = 'default' | 'base' | 'user'
export type KeyEntry = { key: string; source: KeySource }

/**
 * Gộp ba lớp phím theo ưu tiên người dùng > base > mặc định. Một phím chỉ thuộc một lệnh:
 * lớp trên đặt phím nào cho lệnh nào thì lệnh khác của lớp dưới đang giữ đúng phím đó bị bỏ phím.
 */
export function layerKeymap(defaults: Record<string, string>, base: Record<string, string>, user: Record<string, string>): Map<string, KeyEntry> {
  const keymap = new Map<string, KeyEntry>(Object.entries(defaults).map(([id, key]) => [id, { key, source: 'default' }]))
  for (const [layer, source] of [[base, 'base'], [user, 'user']] as const) {
    const taken = new Set(Object.entries(layer).filter(([id, key]) => key && keymap.has(id)).map(([, key]) => key))
    for (const [id, entry] of keymap) if (!Object.hasOwn(layer, id) && taken.has(entry.key)) keymap.set(id, { key: '', source })
    for (const [id, key] of Object.entries(layer)) if (keymap.has(id)) keymap.set(id, { key, source })
  }
  return keymap
}

const resolve = (user: Record<string, string>) => layerKeymap(
  Object.fromEntries(COMMANDS.map((command) => [command.id, forPlatform(command.key ?? '')])),
  Object.fromEntries(Object.entries(BASE_KEYMAPS[baseId].keys).map(([id, key]) => [id, forPlatform(key)])),
  user
)
// Bản gộp được nhớ lại; bỏ đi mỗi khi phím, base keymap hoặc danh sách lệnh đổi.
let resolved: Map<string, KeyEntry> | null = null
const keymap = () => (resolved ??= resolve(overrides))
export const bindingFor = (id: string): string => keymap().get(id)?.key ?? ''
/** Lớp nào quyết định phím hiện tại của lệnh (lệnh bị lớp trên lấy mất phím cũng tính cho lớp đó). */
export const bindingSource = (id: string): KeySource => keymap().get(id)?.source ?? 'default'
export const isCustomBinding = (id: string): boolean => Object.hasOwn(overrides, id)

/** key = null: về phím của base/mặc định. Một phím chỉ thuộc một lệnh: lệnh khác đang giữ phím đó bị bỏ phím. */
export function setBinding(id: string, key: string | null): void {
  const next = { ...overrides }
  if (key === null) delete next[id]
  else {
    for (const command of COMMANDS) if (command.id !== id && bindingFor(command.id) === key) next[command.id] = ''
    next[id] = key
  }
  const lower = resolve({})
  for (const command of COMMANDS) if (next[command.id] === lower.get(command.id)?.key) delete next[command.id]
  overrides = next
  resolved = null
  try { localStorage.setItem(STORE, JSON.stringify(next)) } catch { /* bộ nhớ đầy: vẫn áp dụng trong phiên */ }
  window.dispatchEvent(new Event(CHANGED))
}

/** Đổi base keymap: áp ngay cho bảng phím, bảng lệnh và bộ phân phối phím; phím người dùng đã sửa vẫn thắng. */
export function setBaseKeymap(id: BaseKeymapId): void {
  baseId = id
  try { localStorage.setItem(BASE_STORE, id) } catch { /* bộ nhớ đầy: vẫn áp dụng trong phiên */ }
  notifyKeymap()
}

const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGED, notify)
  return () => window.removeEventListener(CHANGED, notify)
}
/** Re-render khi phím tắt, base keymap hoặc danh sách lệnh đổi; trả về bảng ghi đè hiện tại (đổi tham chiếu mỗi lần đổi). */
export const useKeybindings = (): Record<string, string> => useSyncExternalStore(subscribe, () => overrides)
export const useBaseKeymap = (): BaseKeymapId => useSyncExternalStore(subscribe, () => baseId)
/** Lệnh có handler ở màn hiện tại: mục global của thanh trạng thái biến mất khi rời màn. */
export function useCommandAvailable(id: string): boolean {
  return useSyncExternalStore(subscribe, () => handlers.has(id))
}
// Danh sách lệnh hoặc base keymap đổi: bỏ bản gộp đã nhớ và đổi tham chiếu bảng ghi đè để useKeybindings vẽ lại.
function notifyKeymap() {
  resolved = null
  overrides = { ...overrides }
  window.dispatchEvent(new Event(CHANGED))
}

const MODIFIERS: Record<string, true> = { Meta: true, Control: true, Alt: true, Shift: true }

// Phím ký hiệu đọc theo code để Shift không đổi ký tự (shift+` ra "~" trên bàn phím US).
const SYMBOL_CODE: Record<string, string> = { Backquote: '`', Backslash: '\\', Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'" }

/** Một lần nhấn → "mod+shift+p"; null nếu chỉ là phím bổ trợ. Dùng code cho chữ/số/ký hiệu để Option (macOS), Shift và bố cục bàn phím không làm đổi phím. */
export function eventToStroke(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string | null {
  if (MODIFIERS[event.key]) return null
  const code = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code)
  const key = code ? (code[1] ?? code[2]).toLowerCase() : SYMBOL_CODE[event.code] ?? (event.key === ' ' ? 'space' : event.key.toLowerCase())
  const parts: string[] = []
  if (IS_MAC ? event.metaKey : event.ctrlKey) parts.push('mod')
  if (IS_MAC && event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

const MAC_GLYPH: Record<string, string> = { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', enter: '↩', escape: '⎋', backspace: '⌫', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', space: '␣' }
const PC_NAME: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', escape: 'Esc', space: 'Space' }

/** "mod+shift+p" → "⌘⇧P" (macOS) hoặc "Ctrl+Shift+P"; hợp âm nối bằng dấu cách. */
export function formatKey(key: string, mac = IS_MAC): string {
  return key.split(' ').filter(Boolean).map((stroke) => {
    const parts = stroke.split('+').map((part) => {
      const known = (mac ? MAC_GLYPH : PC_NAME)[part]
      return known ?? (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))
    })
    return parts.join(mac ? '' : '+')
  }).join(' ')
}

/**
 * Bộ phân phối phím toàn cục (pha capture để đi trước Monaco). Lệnh chưa có handler ở màn hiện tại thì bỏ qua để phím rơi về chỗ cũ.
 * Bỏ qua khi đang ghi phím ở trang Phím tắt ([data-keymap-recorder]).
 */
export function installKeymap(target: Window = window): () => void {
  let pending: { stroke: string; at: number } | null = null
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[data-keymap-recorder]'))) return
    const stroke = eventToStroke(event)
    if (!stroke) return
    if (event.target instanceof Element && event.target.closest('.terminal-panel') &&
      (stroke === 'shift+escape' || (event.target.closest('.terminal-view, .terminal-search') && ['mod+d', 'mod+f', 'mod+k'].includes(stroke)))) {
      pending = null
      return
    }
    const sequence = pending && Date.now() - pending.at < 1500 ? `${pending.stroke} ${stroke}` : stroke
    pending = null
    const element = event.target instanceof Element ? event.target : null
    const inDialog = !!element?.closest('[role=dialog]')
    const inInput = !!element?.closest('input, textarea, select, [contenteditable=true]') && !element?.closest('.monaco-editor')
    const live = COMMANDS.filter((command) => handlers.has(command.id)
      && !(command.id.startsWith('editor.') && (inDialog || inInput))
      && !(command.id === 'editor.rename' && element?.closest('[role=tree]')))
    const exact = live.find((command) => bindingFor(command.id) === sequence)
    if (exact) {
      event.preventDefault()
      event.stopPropagation()
      runCommand(exact.id)
      return
    }
    if (!sequence.includes(' ') && live.some((command) => bindingFor(command.id).startsWith(`${sequence} `))) {
      event.preventDefault()
      event.stopPropagation()
      pending = { stroke, at: Date.now() }
    }
  }
  target.addEventListener('keydown', onKey, true)
  return () => target.removeEventListener('keydown', onKey, true)
}
