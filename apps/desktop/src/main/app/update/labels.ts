import type { MenuLocale } from '../app-menu-labels'

/** Chữ của hộp thoại cập nhật (hộp thoại hệ thống do main dựng, theo ngôn ngữ menu). */
export const updateLabels = {
  vi: {
    title: 'Cập nhật NexGraph',
    available: (next: string, current: string) => `Đã có NexGraph ${next}. Bạn đang dùng bản ${current}.`,
    winDetail: 'Bấm Cập nhật để tải bản mới trong nền. Tải xong, NexGraph hỏi khởi động lại để cài; tệp chưa lưu sẽ được hỏi trước khi đóng.',
    macDetail: 'Bấm Tải bản mới để tải tệp DMG. Mở tệp DMG rồi kéo NexGraph vào Applications để thay bản cũ, không cần gỡ cài đặt.',
    update: 'Cập nhật',
    download: 'Tải bản mới',
    notes: 'Xem thay đổi',
    later: 'Để sau',
    downloaded: (next: string) => `Đã tải xong NexGraph ${next}.`,
    downloadedDetail: 'Khởi động lại để cài bản mới. Nếu chọn Để sau, bản mới sẽ tự cài khi bạn thoát NexGraph.',
    restart: 'Khởi động lại',
    upToDate: (current: string) => `Bạn đang dùng bản mới nhất (${current}).`,
    failed: 'Không kiểm tra được bản cập nhật.',
    failedDetail: 'Kiểm tra kết nối mạng rồi thử lại.',
    unsupported: 'Bản đang chạy không tự cập nhật được.',
    unsupportedDetail: 'Chỉ bộ cài NexGraph trên Windows và macOS mới kiểm tra cập nhật.',
    ok: 'Đóng'
  },
  en: {
    title: 'NexGraph Update',
    available: (next: string, current: string) => `NexGraph ${next} is available. You are using ${current}.`,
    winDetail: 'Click Update to download the new version in the background. When it finishes, NexGraph asks to restart and install; you will be asked about unsaved files first.',
    macDetail: 'Click Download to get the DMG file. Open it and drag NexGraph into Applications to replace the old version; no need to uninstall.',
    update: 'Update',
    download: 'Download',
    notes: 'Release Notes',
    later: 'Later',
    downloaded: (next: string) => `NexGraph ${next} has been downloaded.`,
    downloadedDetail: 'Restart to install the new version. If you choose Later, it installs automatically when you quit NexGraph.',
    restart: 'Restart',
    upToDate: (current: string) => `You are using the latest version (${current}).`,
    failed: 'Could not check for updates.',
    failedDetail: 'Check your network connection and try again.',
    unsupported: 'This build cannot update itself.',
    unsupportedDetail: 'Only installed NexGraph builds on Windows and macOS check for updates.',
    ok: 'Close'
  }
} satisfies Record<MenuLocale, unknown>
