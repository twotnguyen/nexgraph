// Chuỗi giao diện (mặc định tiếng Việt, spec §5.9). i18n đầy đủ Việt/Anh ở kế hoạch con 6.
export const vi = {
  appTagline: 'Kết nối mã nguồn. Khám phá tri thức.',
  projects: {
    title: 'Dự án',
    open: 'Mở thư mục…',
    recent: 'Dự án gần đây',
    noRecent: 'Chưa có dự án nào. Hãy mở một thư mục mã nguồn.',
    engineWaiting: 'Engine chưa sẵn sàng, vui lòng đợi…',
    openFailed: 'Không mở được thư mục này'
  },
  indexing: {
    title: (name: string) => `Đang lập chỉ mục: ${name}`,
    preparing: 'Đang chuẩn bị…',
    phase1: 'Đọc cấu trúc',
    phase2: 'Nối quan hệ',
    phase2Hint: 'Chạy nền, đồ thị cập nhật dần',
    cancel: 'Hủy',
    explore: 'Bắt đầu khám phá',
    cancelled: 'Đã hủy lập chỉ mục',
    done: 'Hoàn tất',
    error: (message: string) => `Lỗi: ${message}`
  },
  workspace: {
    graphTab: 'Graph'
  },
  graph: {
    backToRoot: 'Về gốc',
    nothingSelected: 'Chọn một nút để xem chi tiết',
    truncated: 'Đã cắt bớt, thu hẹp bằng cách chọn nút khác',
    isTest: 'Mã kiểm thử'
  }
}
