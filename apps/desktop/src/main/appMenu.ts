import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Menu hệ thống (nền trắng trên Windows) thay cho thanh menu custom trong renderer.
 * Mỗi mục gửi một id lệnh sang renderer; renderer là nơi duy nhất biết màn hình đang mở
 * nên tự quyết định chạy lệnh nào (giữ nguyên behavior như menu File/Edit/View trước đây).
 */
export function installAppMenu(getWindow: () => BrowserWindow | null): void {
  const send = (id: string): void => {
    const win = BrowserWindow.getFocusedWindow() ?? getWindow()
    win?.webContents.send('app-menu:action', { id })
  }
  const item = (label: string, id: string, extra: MenuItemConstructorOptions = {}): MenuItemConstructorOptions => ({
    label, click: () => send(id), ...extra
  })
  const separator = (): MenuItemConstructorOptions => ({ type: 'separator' })
  const unsupported = (label: string): MenuItemConstructorOptions => ({ label, enabled: false })

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        item('New Window', 'window.new'),
        unsupported('New Window with Profile'),
        separator(),
        item('Open File…', 'file.open'),
        item('Open Folder…', 'folder.open'),
        unsupported('Open Workspace from File…'),
        item('Open Recent…', 'file.open_recent'),
        separator(),
        unsupported('Add Folder to Workspace…'),
        unsupported('Save Workspace As…'),
        unsupported('Duplicate Workspace'),
        separator(),
        item('Save As…', 'file.save_as'),
        item('Save All', 'file.save_all'),
        item('Share', 'collab.share'),
        item('Auto Save', 'app-menu:auto-save'),
        separator(),
        { label: 'Preferences', submenu: [
          item('Settings', 'settings.open'),
          item('Keyboard Shortcuts', 'keymap.open'),
          item('Select Theme', 'theme_selector.toggle')
        ] },
        separator(),
        item('Revert File', 'file.revert'),
        item('Close Editor', 'editor.close_f4'),
        item('Close Folder', 'folder.close'),
        item('Close Window', 'window.close')
      ]
    },
    {
      label: 'Edit',
      submenu: [
        item('Find File', 'file_finder.toggle'),
        item('Replace in Files', 'project_search.toggle'),
        item('Find Symbol in File', 'editor.document_symbols'),
        item('Find Symbol in Workspace', 'editor.workspace_symbols'),
        separator(),
        item('Go to Line', 'editor.goto_line'),
        item('Code Actions', 'editor.code_actions'),
        item('Format Document', 'editor.format'),
        item('Rename Symbol', 'editor.rename'),
        item('Toggle Comment', 'editor.toggle_comment'),
        separator(),
        item('Duplicate Line', 'editor.duplicate_line'),
        item('Move Line Up', 'editor.move_line_up'),
        item('Move Line Down', 'editor.move_line_down'),
        separator(),
        { label: 'Bookmarks', submenu: [
          item('Toggle Bookmark', 'editor.toggle_bookmark'),
          item('Next Bookmark', 'editor.next_bookmark'),
          item('Previous Bookmark', 'editor.previous_bookmark'),
          item('View Bookmarks', 'editor.view_bookmarks')
        ] },
        separator(),
        item('Select Language', 'editor.select_language'),
        item('Select Indentation', 'editor.indentation_selector'),
        item('Select End of Line', 'editor.select_line_ending'),
        item('Toggle Read Only', 'editor.toggle_read_only')
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Explorer', 'explorer.toggle'),
        item('Search in Graph', 'graph_search.toggle'),
        item('Changes & Impact', 'changes.toggle'),
        item('Git', 'git_panel.toggle'),
        item('Debug', 'debug.toggle'),
        separator(),
        item('Architecture', 'view.arch'),
        item('Map', 'view.map'),
        item('Flows', 'view.flows'),
        item('Graph', 'view.graph'),
        item('Tree', 'view.tree'),
        item('Report', 'view.report'),
        separator(),
        item('Toggle Left Panel', 'dock.left'),
        item('Toggle Right Panel', 'dock.right'),
        item('Toggle Terminal', 'dock.bottom'),
        item('Toggle All Panels', 'dock.all'),
        item('Zoom Pane', 'view.zoom_pane'),
        item('Centered Layout', 'view.centered_layout')
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
