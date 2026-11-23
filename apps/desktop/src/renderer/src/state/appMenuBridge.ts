import { runCommand } from './commands'
import { getEditorPrefs, setEditorPrefs } from './editorPrefs'

/**
 * Menu File/Edit/View là menu hệ thống do main dựng, nhưng chỉ renderer biết màn hình
 * đang mở và lệnh nào đang có handler. Vì vậy main chỉ gửi id lệnh, renderer chạy ở đây.
 */
export function installAppMenuBridge(): () => void {
  const menu = window.nexgraph?.menu
  if (!menu) return () => {}
  return menu.onAction(({ id }) => {
    if (id === 'app-menu:auto-save') {
      setEditorPrefs({ autoSave: getEditorPrefs().autoSave === 'off' ? 'afterDelay' : 'off' })
      return
    }
    runCommand(id)
  })
}
