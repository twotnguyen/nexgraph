import { runCommand } from '../shared/lib/commands'
import { getEditorPrefs, setEditorPrefs } from '../shared/lib/editorPrefs'
import { notify } from '../shared/ui/NotificationCenter'
import { tr } from '../i18n/strings'

/**
 * Menu File/Edit/View là menu hệ thống do main dựng, nhưng chỉ renderer biết màn hình
 * đang mở và lệnh nào đang có handler. Vì vậy main chỉ gửi id lệnh, renderer chạy ở đây.
 */
export function installAppMenuBridge(): () => void {
  const menu = window.nexgraph?.menu
  if (!menu) return () => {}
  return menu.onAction(({ id }) => {
    if (id === 'app-menu:auto-save') {
      // Menu native không hiện dấu check, nên báo rõ trạng thái vừa bật/tắt.
      const on = getEditorPrefs().autoSave === 'off'
      setEditorPrefs({ autoSave: on ? 'afterDelay' : 'off' })
      notify(on ? tr('Đã bật tự lưu') : tr('Đã tắt tự lưu'))
      return
    }
    runCommand(id)
  })
}
