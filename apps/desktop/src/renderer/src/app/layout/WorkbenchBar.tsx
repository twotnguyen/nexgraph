import { useEffect, useState } from 'react'
import { tr } from '../../i18n/strings'
import { Icon, type IconName, Logo } from '../../shared/ui/icons'
import { PopoverMenu, type MenuItem } from '../../shared/ui/PopoverMenu'
import { NotificationCenter } from '../../shared/ui/NotificationCenter'
import { runCommand } from '../../shared/lib/commands'
import { THEMES, useTheme, useThemeId } from '../../shared/lib/useTheme'
import { ThemePickerHost, openThemePicker } from './ThemePicker'

const action = (label: string, id: string, icon: IconName = 'check'): MenuItem => ({ label, icon, onSelect: () => { runCommand(id) } })
/** Dãy nút kiểu Wu ở đầu vùng editor: mỗi nút là một nhóm lệnh đã đăng ký sẵn. */
export function QuickActionBar() {
  const groups: { label: string; icon: IconName; items: MenuItem[] }[] = [
    { label: tr('Tìm kiếm nhanh'), icon: 'search', items: [
      action(tr('Tìm và mở tệp'), 'file_finder.toggle', 'search'),
      action(tr('Tìm và thay trong tệp'), 'project_search.toggle', 'search'),
      action(tr('Tìm ký hiệu trong tệp'), 'editor.document_symbols', 'tree'),
      action(tr('Tìm ký hiệu trong dự án'), 'editor.workspace_symbols', 'tree')
    ] },
    { label: tr('Vùng chọn'), icon: 'pencil', items: [
      action(tr('Chọn lần xuất hiện tiếp theo'), 'editor.select_next_occurrence', 'pencil'),
      action(tr('Chọn tất cả lần xuất hiện'), 'editor.select_all_occurrences', 'pencil')
    ] },
    { label: tr('Điều khiển trình soạn thảo'), icon: 'sliders', items: [
      action(tr('Bật/tắt số dòng'), 'editor.toggle_line_numbers'),
      action(tr('Bật/tắt xuống dòng mềm'), 'editor.toggle_soft_wrap'),
      action(tr('Bật/tắt bản đồ thu nhỏ'), 'editor.toggle_minimap'),
      action(tr('Bật/tắt khoảng trắng'), 'editor.toggle_whitespace'),
      action(tr('Bật/tắt cuộn dính'), 'editor.toggle_sticky_scroll'),
      action(tr('Bật/tắt thanh điều hướng'), 'editor.toggle_breadcrumbs'),
      action(tr('Bật/tắt gợi ý trong dòng'), 'editor.toggle_inlay_hints'),
      action(tr('Bật/tắt tô sáng ngữ nghĩa'), 'editor.toggle_semantic_highlights'),
      action(tr('Bật/tắt Code Lens'), 'editor.toggle_code_lens'),
    ] },
    { label: tr('Chẩn đoán'), icon: 'bug', items: [
      action(tr('Hiện lỗi trong dự án'), 'editor.diagnostics', 'bug'),
      action(tr('Lỗi tiếp theo'), 'editor.next_diagnostic', 'chevron'),
      action(tr('Lỗi trước đó'), 'editor.previous_diagnostic', 'back')
    ] }
  ]
  return (
    <div className="quick-actions" role="toolbar" aria-label={tr('Thao tác nhanh')}>
      {groups.map((group) => <PopoverMenu key={group.label} label={group.label} buttonClass="quick-action-button"
        trigger={<Icon name={group.icon} size={14} />} items={group.items} />)}
    </div>
  )
}
export function WorkbenchBar({ project }: { project?: { project_id: string; name: string } | null }) {
  const dark = useTheme() === 'dark'
  const themeId = useThemeId()
  const themeName = THEMES.find((t) => t.id === themeId)?.name ?? themeId
  const [branch, setBranch] = useState<string | null>(null)
  const projectId = project?.project_id

  useEffect(() => {
    setBranch(null)
    if (!projectId) return
    let alive = true
    // Đọc lại khi cửa sổ được focus: người dùng hay đổi nhánh ở terminal ngoài app.
    const load = () => void window.nexgraph.hook.branch(projectId).then((b) => alive && setBranch(b), () => {})
    load()
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
    }
  }, [projectId])

  return (
    <header className="workbench-bar">
      <div className="workbench-brand">
        <Logo size={16} />
        {project ? <span className="workbench-project" title={project.name}>{project.name}</span> : <span>NexGraph</span>}
        {branch && <span className="workbench-branch" title={tr('Nhánh {name}', { name: branch })}><Icon name="branch" size={13} />{branch}</span>}
      </div>
      <div className="workbench-actions">
        <NotificationCenter />
        <button type="button" className="theme-toggle" data-theme-id={themeId} aria-label={tr('Giao diện: {name}', { name: themeName })} title={tr('Chọn chủ đề màu · ⌘K ⌘T')} aria-haspopup="dialog" onClick={openThemePicker}>
          <Icon name={dark ? 'moon' : 'sun'} size={14} />
          <span>{themeName}</span>
        </button>
      </div>
      <ThemePickerHost />
    </header>
  )
}
