import { useEffect, useState } from 'react'
import { Icon, Logo } from '../common/icons'
import { THEMES, useTheme, useThemeId } from '../../state/useTheme'
import { ThemePickerHost, openThemePicker } from './ThemePicker'

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
        {branch && <span className="workbench-branch" title={`Nhánh ${branch}`}><Icon name="branch" size={13} />{branch}</span>}
      </div>
      <button type="button" className="theme-toggle" data-theme-id={themeId} aria-label={`Giao diện: ${themeName}`} title="Chọn theme · ⌘K ⌘T" aria-haspopup="dialog" onClick={openThemePicker}>
        <Icon name={dark ? 'moon' : 'sun'} size={14} />
        <span>{themeName}</span>
      </button>
      <ThemePickerHost />
    </header>
  )
}
