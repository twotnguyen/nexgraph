import { Icon, Logo } from '../common/icons'
import { setTheme, useTheme } from '../../state/useTheme'

export function WorkbenchBar() {
  const theme = useTheme()
  const dark = theme === 'dark'
  const target = dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'
  return (
    <header className="workbench-bar">
      <div className="workbench-brand"><Logo size={19} /> <span>NexGraph</span></div>
      <button type="button" className="theme-toggle" title={target} aria-label={target} onClick={() => setTheme(dark ? 'light' : 'dark')}>
        <Icon name={dark ? 'moon' : 'sun'} size={16} />
        <span>{dark ? 'Tối' : 'Sáng'}</span>
      </button>
    </header>
  )
}
