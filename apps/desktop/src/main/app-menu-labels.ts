/**
 * Nhãn menu hệ thống (File/Edit/View/Window/Help) cho main process.
 *
 * Main không import được `src/renderer/src/strings.ts` (chuỗi renderer đọc localStorage và
 * chỉ dùng trong renderer), nên bảng nhãn menu sống ở đây. Ngôn ngữ lấy từ lựa chọn UI của
 * người dùng qua IPC `app-menu:set-locale`; đổi ngôn ngữ là dựng lại menu (xem appMenu.ts).
 */
export type MenuLocale = 'vi' | 'en'

export const isMenuLocale = (value: unknown): value is MenuLocale => value === 'vi' || value === 'en'

type Labels = {
  app: { about: string; hide: string; hideOthers: string; showAll: string; quit: string }
  file: {
    newWindow: string; openFile: string; openFolder: string; openRecent: string
    saveAs: string; saveAll: string; share: string; autoSave: string
    preferences: string; settings: string; keyboardShortcuts: string; selectTheme: string
    revertFile: string; closeEditor: string; closeFolder: string; closeWindow: string
  }
  edit: {
    undo: string; redo: string; cut: string; copy: string; paste: string; pasteMatch: string
    delete: string; selectAll: string
    findFile: string; replaceInFiles: string; findSymbolInFile: string; findSymbolInWorkspace: string
    goToLine: string; codeActions: string; formatDocument: string; renameSymbol: string; toggleComment: string
    duplicateLine: string; moveLineUp: string; moveLineDown: string
    bookmarks: string; toggleBookmark: string; nextBookmark: string; previousBookmark: string; viewBookmarks: string
    selectLanguage: string; selectIndentation: string; selectLineEnding: string; toggleReadOnly: string
  }
  view: {
    explorer: string; searchInGraph: string; changesImpact: string; git: string; debug: string
    architecture: string; map: string; flows: string; graph: string; tree: string; report: string
    toggleLeftPanel: string; toggleRightPanel: string; toggleTerminal: string; toggleAllPanels: string
    zoomPane: string; centeredLayout: string
    reload: string; toggleDevTools: string; actualSize: string; zoomIn: string; zoomOut: string; fullScreen: string
  }
  window: { minimize: string; zoom: string; close: string; front: string }
  help: { about: string }
}

const VI: Labels = {
  app: { about: 'Giới thiệu NexGraph', hide: 'Ẩn NexGraph', hideOthers: 'Ẩn các ứng dụng khác', showAll: 'Hiện tất cả', quit: 'Thoát NexGraph' },
  file: {
    newWindow: 'Cửa sổ mới',
    openFile: 'Mở tệp…',
    openFolder: 'Mở thư mục…',
    openRecent: 'Mở gần đây',
    saveAs: 'Lưu thành…',
    saveAll: 'Lưu tất cả',
    share: 'Chia sẻ',
    autoSave: 'Tự lưu',
    preferences: 'Tuỳ chọn',
    settings: 'Cài đặt',
    keyboardShortcuts: 'Phím tắt',
    selectTheme: 'Chọn chủ đề màu',
    revertFile: 'Hoàn tác tệp',
    closeEditor: 'Đóng editor',
    closeFolder: 'Đóng thư mục',
    closeWindow: 'Đóng cửa sổ'
  },
  edit: {
    undo: 'Hoàn tác',
    redo: 'Làm lại',
    cut: 'Cắt',
    copy: 'Sao chép',
    paste: 'Dán',
    pasteMatch: 'Dán và khớp kiểu',
    delete: 'Xoá',
    selectAll: 'Chọn tất cả',
    findFile: 'Tìm và mở tệp…',
    replaceInFiles: 'Tìm và thay trong tệp…',
    findSymbolInFile: 'Tìm ký hiệu trong tệp',
    findSymbolInWorkspace: 'Tìm ký hiệu trong dự án',
    goToLine: 'Đi đến dòng…',
    codeActions: 'Thao tác mã',
    formatDocument: 'Định dạng tệp',
    renameSymbol: 'Đổi tên ký hiệu',
    toggleComment: 'Bật/tắt chú thích',
    duplicateLine: 'Nhân đôi dòng',
    moveLineUp: 'Di chuyển dòng lên',
    moveLineDown: 'Di chuyển dòng xuống',
    bookmarks: 'Dấu trang',
    toggleBookmark: 'Bật/tắt dấu trang dòng',
    nextBookmark: 'Dấu trang tiếp theo',
    previousBookmark: 'Dấu trang trước đó',
    viewBookmarks: 'Xem danh sách dấu trang',
    selectLanguage: 'Chọn ngôn ngữ',
    selectIndentation: 'Chọn kiểu thụt lề',
    selectLineEnding: 'Chọn kết thúc dòng',
    toggleReadOnly: 'Bật/tắt chế độ chỉ đọc'
  },
  view: {
    explorer: 'Cây tệp',
    searchInGraph: 'Tìm trong đồ thị',
    changesImpact: 'Thay đổi và vùng ảnh hưởng',
    git: 'Git',
    debug: 'Gỡ lỗi',
    architecture: 'Kiến trúc',
    map: 'Bản đồ',
    flows: 'Luồng',
    graph: 'Đồ thị',
    tree: 'Cây',
    report: 'Báo cáo',
    toggleLeftPanel: 'Bật/tắt bảng bên trái',
    toggleRightPanel: 'Bật/tắt bảng bên phải',
    toggleTerminal: 'Bật/tắt terminal',
    toggleAllPanels: 'Bật/tắt tất cả bảng',
    zoomPane: 'Phóng to khung',
    centeredLayout: 'Bố cục căn giữa',
    reload: 'Tải lại',
    toggleDevTools: 'Bật/tắt công cụ nhà phát triển',
    actualSize: 'Kích thước thực',
    zoomIn: 'Phóng to',
    zoomOut: 'Thu nhỏ',
    fullScreen: 'Bật/tắt toàn màn hình'
  },
  window: { minimize: 'Thu nhỏ', zoom: 'Phóng to cửa sổ', close: 'Đóng cửa sổ', front: 'Đưa tất cả lên trước' },
  help: { about: 'Giới thiệu NexGraph' }
}

const EN: Labels = {
  app: { about: 'About NexGraph', hide: 'Hide NexGraph', hideOthers: 'Hide Others', showAll: 'Show All', quit: 'Quit NexGraph' },
  file: {
    newWindow: 'New Window',
    openFile: 'Open File…',
    openFolder: 'Open Folder…',
    openRecent: 'Open Recent',
    saveAs: 'Save As…',
    saveAll: 'Save All',
    share: 'Share',
    autoSave: 'Auto Save',
    preferences: 'Preferences',
    settings: 'Settings',
    keyboardShortcuts: 'Keyboard Shortcuts',
    selectTheme: 'Select Theme',
    revertFile: 'Revert File',
    closeEditor: 'Close Editor',
    closeFolder: 'Close Folder',
    closeWindow: 'Close Window'
  },
  edit: {
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    pasteMatch: 'Paste and Match Style',
    delete: 'Delete',
    selectAll: 'Select All',
    findFile: 'Find and Open File…',
    replaceInFiles: 'Find and Replace in Files…',
    findSymbolInFile: 'Find Symbol in File',
    findSymbolInWorkspace: 'Find Symbol in Workspace',
    goToLine: 'Go to Line…',
    codeActions: 'Code Actions',
    formatDocument: 'Format Document',
    renameSymbol: 'Rename Symbol',
    toggleComment: 'Toggle Comment',
    duplicateLine: 'Duplicate Line',
    moveLineUp: 'Move Line Up',
    moveLineDown: 'Move Line Down',
    bookmarks: 'Bookmarks',
    toggleBookmark: 'Toggle Bookmark',
    nextBookmark: 'Next Bookmark',
    previousBookmark: 'Previous Bookmark',
    viewBookmarks: 'View Bookmarks',
    selectLanguage: 'Select Language',
    selectIndentation: 'Select Indentation',
    selectLineEnding: 'Select End of Line',
    toggleReadOnly: 'Toggle Read Only'
  },
  view: {
    explorer: 'Explorer',
    searchInGraph: 'Search in Graph',
    changesImpact: 'Changes & Impact',
    git: 'Git',
    debug: 'Debug',
    architecture: 'Architecture',
    map: 'Map',
    flows: 'Flows',
    graph: 'Graph',
    tree: 'Tree',
    report: 'Report',
    toggleLeftPanel: 'Toggle Left Panel',
    toggleRightPanel: 'Toggle Right Panel',
    toggleTerminal: 'Toggle Terminal',
    toggleAllPanels: 'Toggle All Panels',
    zoomPane: 'Zoom Pane',
    centeredLayout: 'Centered Layout',
    reload: 'Reload',
    toggleDevTools: 'Toggle Developer Tools',
    actualSize: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    fullScreen: 'Toggle Full Screen'
  },
  window: { minimize: 'Minimize', zoom: 'Zoom', close: 'Close Window', front: 'Bring All to Front' },
  help: { about: 'About NexGraph' }
}

export const menuLabels: Record<MenuLocale, Labels> = { vi: VI, en: EN }

/** Tiêu đề hộp thoại chọn tệp của menu File, theo ngôn ngữ UI. */
export const pickFileTitle: Record<MenuLocale, string> = {
  vi: 'Chọn tệp để mở',
  en: 'Choose a file to open'
}
