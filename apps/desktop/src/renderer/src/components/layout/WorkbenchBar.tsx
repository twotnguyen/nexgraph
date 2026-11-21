import { Icon, Logo } from '../common/icons'
import { THEMES, setTheme, useTheme, useThemeId } from '../../state/useTheme'

export function WorkbenchBar() {
  const dark = useTheme() === 'dark'
  const themeId = useThemeId()
  return (
    <header className="workbench-bar">
      <div className="workbench-brand"><Logo size={19} /> <span>NexGraph</span></div>
      <label className="theme-toggle" title="Giao diện">
        <Icon name={dark ? 'moon' : 'sun'} size={16} />
        <select aria-label="Giao diện" value={themeId} onChange={(e) => setTheme(e.target.value)}>
          <optgroup label="Sáng">{THEMES.filter((t) => t.appearance === 'light').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
          <optgroup label="Tối">{THEMES.filter((t) => t.appearance === 'dark').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
        </select>
      </label>
    </header>
  )
}
