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
  large: {
    scanning: 'Đang kiểm tra kích thước dự án…',
    message: (files: number, threshold: number) =>
      `Dự án có ${files.toLocaleString('vi-VN')} tệp mã, vượt ngưỡng ${threshold.toLocaleString('vi-VN')}. Lập chỉ mục toàn bộ có thể mất nhiều thời gian và bộ nhớ.`,
    hint: 'Chọn một thư mục con để lập chỉ mục, hoặc lập chỉ mục toàn bộ:',
    files: (n: number) => `${n.toLocaleString('vi-VN')} tệp`,
    all: 'Lập chỉ mục toàn bộ',
    cancel: 'Hủy',
    subdir: (path: string) => `Thư mục con: ${path}`
  },
  workspace: {
    archTab: 'Kiến trúc',
    graphTab: 'Graph'
  },
  arch: {
    root: 'Dự án',
    breadcrumb: 'Đường dẫn khối',
    legendArrow: 'Mũi tên = quan hệ có thật trong code',
    legendCount: 'Số trên mũi tên = số bằng chứng',
    relations: 'Quan hệ giữa các khối',
    empty: 'Chưa có dữ liệu, hãy lập chỉ mục',
    evidence: 'Bằng chứng',
    close: 'Đóng',
    loading: 'Đang tải…',
    noEvidence: 'Không có bằng chứng',
    files: (n: number) => `${n} tệp`
  },
  activity: {
    search: 'Tìm kiếm',
    changes: 'Thay đổi'
  },
  code: {
    close: 'Đóng',
    missing: 'Tệp không còn tồn tại hoặc chưa được lập chỉ mục',
    outside: 'Tệp nằm ngoài thư mục project',
    failed: 'Không đọc được mã nguồn',
    stale: 'Tệp đã thay đổi so với lần lập chỉ mục',
    capped: 'Chỉ hiện tối đa 2.000 dòng',
    open: 'Mở mã',
    viewNode: 'Xem nút'
  },
  changes: {
    title: 'Thay đổi',
    reload: 'Làm mới',
    loading: 'Đang tải…',
    none: 'Chưa có thay đổi',
    truncated: 'Danh sách đã bị cắt bớt',
    baseGit: (sha: string) => `So với HEAD ${sha}`,
    baseIndex: 'Không có Git: so với lần lập chỉ mục trước',
    changedFiles: 'Đã thay đổi',
    changedNodes: 'Hàm và lớp đã đổi',
    impacted: 'Vùng ảnh hưởng',
    tests: 'Test liên quan',
    gaps: 'Chưa có test',
    noneImpacted: 'Không có nút nào bị ảnh hưởng',
    noneTests: 'Không tìm thấy test liên quan',
    noneGaps: 'Mọi hàm đã đổi đều có test',
    hops: (n: number) => `${n} bước`,
    openCode: 'Mở mã',
    tag: { changed: 'đã đổi', impacted: 'ảnh hưởng', test: 'test', gap: 'chưa có test' }
  },
  search: {
    label: 'Tìm kiếm',
    placeholder: 'Tìm hàm, lớp, tệp…',
    empty: 'Không có kết quả'
  },
  graph: {
    backToRoot: 'Về gốc',
    nothingSelected: 'Chọn một nút để xem chi tiết',
    truncated: 'Đã cắt bớt, thu hẹp bằng cách chọn nút khác',
    isTest: 'Mã kiểm thử'
  }
}
