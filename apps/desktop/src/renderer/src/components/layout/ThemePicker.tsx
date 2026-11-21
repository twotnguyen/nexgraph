import { useMemo, useRef, useState } from 'react'
import { Icon } from '../common/icons'
import { THEMES, currentThemeId, previewTheme, setTheme, useThemesVersion } from '../../state/useTheme'
import { runCommand, useCommand } from '../../state/commands'
import { Highlight, Picker } from './Picker'

export const openThemePicker = (): void => void runCommand('theme_selector.toggle')

// Như Wu: theme tối trước, rồi theo tên. Tính lúc mở vì extension có thể thêm theme sau khi app chạy.
const ordered = () => [...THEMES].sort((a, b) => (a.appearance === b.appearance ? 0 : a.appearance === 'dark' ? -1 : 1) || a.name.localeCompare(b.name, 'vi'))
type Theme = (typeof THEMES)[number]
const themeKey = (theme: Theme) => theme.id
const themeName = (theme: Theme) => theme.name

/** Gắn một lần ở thanh tiêu đề: mở bằng lệnh theme_selector.toggle (mặc định ⌘K rồi ⌘T). */
export function ThemePickerHost() {
  const [open, setOpen] = useState(false)
  useCommand('theme_selector.toggle', () => setOpen((v) => !v))
  return open ? <ThemePicker onClose={() => setOpen(false)} /> : null
}

/** Bảng chọn theme kiểu Wu: rê hoặc dùng phím mũi tên để xem trước, Enter lưu, Esc trả lại theme cũ. */
export function ThemePicker({ onClose }: { onClose: () => void }) {
  const original = useRef(currentThemeId())
  const version = useThemesVersion()
  const items = useMemo(ordered, [version])
  return (
    <Picker label="Chọn theme" placeholder="Chọn theme…" className="theme-picker" items={items} itemKey={themeKey} itemText={themeName}
      initialKey={original.current} empty="Không có theme khớp" itemData={(theme) => ({ 'data-theme-id': theme.id })}
      onActive={(theme) => previewTheme(theme.id)}
      onCancel={() => { previewTheme(original.current); onClose() }}
      onPick={(theme) => { setTheme(theme.id); onClose() }}
      renderItem={(theme, positions) => <>
        <span><Highlight text={theme.name} positions={positions} /></span>
        <small>{theme.appearance === 'dark' ? 'Tối' : 'Sáng'}</small>
        {theme.id === original.current && <Icon name="check" size={14} />}
      </>} />
  )
}
