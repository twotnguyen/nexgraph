import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { isMenuLocale, menuLabels, type MenuLocale } from './app-menu-labels'
import { getMenuLocale, setMenuLocale } from './app-menu-locale'

/**
 * Menu hệ thống (thanh menu của macOS/Windows) thay cho menu mặc định Electron.
 *
 * Mỗi mục của NexGraph gửi một id lệnh sang renderer; renderer là nơi duy nhất biết màn hình
 * đang mở nên tự quyết định chạy lệnh nào. Các mục chuẩn dùng `role` của Electron để giữ
 * accelerator của hệ điều hành — thiếu role Edit là ⌘C/⌘V/⌘Z/⌘A chết trong Monaco, ô chat,
 * terminal và mọi ô nhập (review #49: Critical).
 */
export type MenuBuildOptions = {
  locale: MenuLocale
  /** Bản đóng gói không được lộ Tải lại/Công cụ nhà phát triển. */
  isPackaged: boolean
  platform: NodeJS.Platform
  send: (id: string) => void
  appName?: string
}

/** Nhãn menu đang dùng; renderer gửi qua IPC `app-menu:set-locale` khi người dùng đổi ngôn ngữ. */
export { getMenuLocale }

export function buildAppMenu({ locale: lang, isPackaged, platform, send, appName }: MenuBuildOptions): MenuItemConstructorOptions[] {
  const t = menuLabels[lang]
  const name = appName ?? 'NexGraph'
  const command = (label: string, id: string, extra: MenuItemConstructorOptions = {}): MenuItemConstructorOptions => ({
    label, click: () => send(id), ...extra
  })
  const separator = (): MenuItemConstructorOptions => ({ type: 'separator' })

  const template: MenuItemConstructorOptions[] = []

  // macOS: menu đầu tiên phải là menu ứng dụng (About/Hide/Quit ⌘Q); thiếu nó là mất ⌘Q.
  if (platform === 'darwin') {
    template.push({
      label: name,
      submenu: [
        { role: 'about', label: t.app.about },
        separator(),
        { role: 'hide', label: t.app.hide },
        { role: 'hideOthers', label: t.app.hideOthers },
        { role: 'unhide', label: t.app.showAll },
        separator(),
        { role: 'quit', label: t.app.quit }
      ]
    })
  }

  template.push({
    label: lang === 'en' ? 'File' : 'Tệp',
    submenu: [
      command(t.file.newWindow, 'window.new'),
      separator(),
      command(t.file.openFile, 'file.open'),
      command(t.file.openFolder, 'folder.open'),
      separator(),
      command(t.file.saveAs, 'file.save_as'),
      command(t.file.saveAll, 'file.save_all'),
      command(t.file.share, 'collab.share'),
      command(t.file.autoSave, 'app-menu:auto-save'),
      separator(),
      {
        label: t.file.preferences,
        submenu: [
          command(t.file.settings, 'settings.open'),
          command(t.file.keyboardShortcuts, 'keymap.open'),
          command(t.file.selectTheme, 'theme_selector.toggle')
        ]
      },
      separator(),
      command(t.file.revertFile, 'file.revert'),
      command(t.file.closeEditor, 'editor.close_f4'),
      command(t.file.closeFolder, 'folder.close'),
      command(t.file.closeWindow, 'window.close')
    ]
  })

  template.push({
    label: lang === 'en' ? 'Edit' : 'Sửa',
    submenu: [
      // Role soạn thảo: nguồn của ⌘Z/⌘C/⌘V/⌘X/⌘A trong Monaco, terminal, ô chat và mọi input.
      { role: 'undo', label: t.edit.undo },
      { role: 'redo', label: t.edit.redo },
      separator(),
      { role: 'cut', label: t.edit.cut },
      { role: 'copy', label: t.edit.copy },
      { role: 'paste', label: t.edit.paste },
      ...(platform === 'darwin' ? [{ role: 'pasteAndMatchStyle' as const, label: t.edit.pasteMatch }] : []),
      { role: 'delete', label: t.edit.delete },
      { role: 'selectAll', label: t.edit.selectAll },
      separator(),
      command(t.edit.findFile, 'file_finder.toggle'),
      command(t.edit.replaceInFiles, 'project_search.toggle'),
      command(t.edit.findSymbolInFile, 'editor.document_symbols'),
      command(t.edit.findSymbolInWorkspace, 'editor.workspace_symbols'),
      separator(),
      command(t.edit.goToLine, 'editor.goto_line'),
      command(t.edit.codeActions, 'editor.code_actions'),
      command(t.edit.formatDocument, 'editor.format'),
      command(t.edit.renameSymbol, 'editor.rename'),
      command(t.edit.toggleComment, 'editor.toggle_comment'),
      separator(),
      command(t.edit.duplicateLine, 'editor.duplicate_line'),
      command(t.edit.moveLineUp, 'editor.move_line_up'),
      command(t.edit.moveLineDown, 'editor.move_line_down'),
      separator(),
      {
        label: t.edit.bookmarks,
        submenu: [
          command(t.edit.toggleBookmark, 'editor.toggle_bookmark'),
          command(t.edit.nextBookmark, 'editor.next_bookmark'),
          command(t.edit.previousBookmark, 'editor.previous_bookmark'),
          command(t.edit.viewBookmarks, 'editor.view_bookmarks')
        ]
      },
      separator(),
      command(t.edit.selectLanguage, 'editor.select_language'),
      command(t.edit.selectIndentation, 'editor.indentation_selector'),
      command(t.edit.selectLineEnding, 'editor.select_line_ending'),
      command(t.edit.toggleReadOnly, 'editor.toggle_read_only')
    ]
  })

  template.push({
    label: lang === 'en' ? 'View' : 'Xem',
    submenu: [
      command(t.view.explorer, 'explorer.toggle'),
      command(t.view.searchInGraph, 'graph_search.toggle'),
      command(t.view.changesImpact, 'changes.toggle'),
      command(t.view.git, 'git_panel.toggle'),
      command(t.view.debug, 'debug.toggle'),
      separator(),
      command(t.view.architecture, 'view.arch'),
      command(t.view.map, 'view.map'),
      command(t.view.flows, 'view.flows'),
      command(t.view.graph, 'view.graph'),
      command(t.view.tree, 'view.tree'),
      command(t.view.report, 'view.report'),
      separator(),
      command(t.view.toggleLeftPanel, 'dock.left'),
      command(t.view.toggleRightPanel, 'dock.right'),
      command(t.view.toggleTerminal, 'dock.bottom'),
      command(t.view.toggleAllPanels, 'dock.all'),
      command(t.view.zoomPane, 'view.zoom_pane'),
      command(t.view.centeredLayout, 'view.centered_layout'),
      separator(),
      { role: 'resetZoom', label: t.view.actualSize },
      { role: 'zoomIn', label: t.view.zoomIn },
      { role: 'zoomOut', label: t.view.zoomOut },
      { role: 'togglefullscreen', label: t.view.fullScreen },
      // Như dev-hooks #37: chỉ bản chạy từ mã nguồn mới có Tải lại / DevTools.
      ...(isPackaged ? [] : [separator(), { role: 'reload' as const, label: t.view.reload }, { role: 'toggleDevTools' as const, label: t.view.toggleDevTools }])
    ]
  })

  template.push({
    label: lang === 'en' ? 'Window' : 'Cửa sổ',
    submenu: [
      { role: 'minimize', label: t.window.minimize },
      // Không dùng role 'close' ở đây: role đó giành ⌘W, trong khi ⌘W của NexGraph là đóng thẻ.
      command(t.window.close, 'window.close'),
      ...(platform === 'darwin' ? [{ role: 'front' as const, label: t.window.front }] : [])
    ]
  })

  template.push({
    label: lang === 'en' ? 'Help' : 'Trợ giúp',
    submenu: [{ role: 'about', label: t.help.about }]
  })

  return template
}

function send(id: string, getWindow: () => BrowserWindow | null): void {
  const win = BrowserWindow.getFocusedWindow() ?? getWindow()
  win?.webContents.send('app-menu:action', { id })
}

/** Dựng lại thanh menu (gọi lúc khởi động và mỗi lần đổi ngôn ngữ UI). */
export function installAppMenu(getWindow: () => BrowserWindow | null, nextLocale: MenuLocale = getMenuLocale()): void {
  setMenuLocale(nextLocale)
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenu({
    locale: nextLocale,
    isPackaged: app.isPackaged,
    platform: process.platform,
    appName: app.getName(),
    send: (id) => send(id, getWindow)
  })))
}

/** Đổi ngôn ngữ menu; trả false khi mã ngôn ngữ không hợp lệ (IPC kiểm trước khi gọi). */
export function setAppMenuLocale(value: unknown, getWindow: () => BrowserWindow | null): boolean {
  if (!isMenuLocale(value)) return false
  installAppMenu(getWindow, value)
  return true
}
