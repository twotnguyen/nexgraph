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
    graphTab: 'Graph',
    treeTab: 'Cây',
    reportTab: 'Báo cáo',
    export: 'Xuất…'
  },
  report: {
    title: 'Báo cáo đồ thị',
    loading: 'Đang phân tích…',
    exportMd: 'Xuất Markdown',
    truncated: 'Dự án lớn: báo cáo tính trên 5.000 node quan trọng nhất.',
    godNodes: 'Node trung tâm',
    godNodesHint: 'Nhiều liên kết nhất (không tính tệp và test). Bấm để xem trên graph.',
    colName: 'Tên',
    colKind: 'Loại',
    colFile: 'Vị trí',
    colDegree: 'Liên kết',
    colSize: 'Số node',
    colCohesion: 'Độ gắn kết',
    communities: (n: number) => `Cộng đồng (${n})`,
    surprising: 'Kết nối bất ngờ',
    questions: 'Câu hỏi gợi ý',
    questionsHint: 'Bấm để hỏi graph với câu này.',
    benchmark: 'Mức giảm token',
    benchmarkText: (corpus: string, graph: string, ratio: string) =>
      `Đọc toàn bộ mã: ~${corpus} token. Hỏi qua graph: ~${graph} token mỗi câu. Giảm ${ratio} lần.`
  },
  tree: {
    label: 'Cây dự án',
    loading: 'Đang tải…',
    more: '… còn nữa, dùng Tìm kiếm',
    expand: 'Mở',
    collapse: 'Thu gọn',
    openCode: 'Mở mã'
  },
  export: {
    title: (name: string) => `Xuất đồ thị: ${name}`,
    close: 'Đóng',
    scope: 'Phạm vi',
    scopeAll: 'Toàn bộ dự án',
    scopeNode: (id: string) => `Quanh node đang chọn (${id})`,
    scopeCommunity: (id: string) => `Cộng đồng ${id}`,
    format: 'Định dạng',
    formats: {
      html: ['HTML tương tác', 'Mở bằng trình duyệt, kéo thả và tìm được'],
      callflow_html: ['HTML luồng gọi', 'Sơ đồ luồng gọi hàm theo kiến trúc'],
      obsidian: ['Obsidian vault', 'Mỗi node một ghi chú, liên kết [[…]]'],
      wiki: ['Wiki Markdown', 'Mỗi cộng đồng một trang, có mục lục'],
      svg: ['Ảnh SVG', 'Ảnh vector toàn đồ thị'],
      graphml: ['GraphML', 'Mở bằng Gephi, yEd'],
      cypher: ['Cypher', 'Tệp lệnh nạp vào Neo4j'],
      json: ['JSON đồ thị', 'Định dạng node-link, dùng cho công cụ khác'],
      markdown: ['Báo cáo Markdown', 'Node trung tâm, cộng đồng, câu hỏi gợi ý'],
      png: ['Ảnh PNG vùng đang xem', 'Chụp đúng phần đang hiện trên màn hình'],
      neo4j: ['Đẩy lên Neo4j', 'Ghi thẳng vào server Neo4j đang chạy'],
      falkordb: ['Đẩy lên FalkorDB', 'Ghi thẳng vào server FalkorDB đang chạy']
    } as Record<string, [string, string]>,
    uri: 'URI',
    user: 'Người dùng',
    password: 'Mật khẩu',
    passwordHint: 'Mật khẩu chỉ dùng cho lần đẩy này, không được lưu.',
    run: 'Chọn thư mục và xuất',
    png: 'Lưu ảnh PNG',
    push: 'Đẩy lên server',
    running: 'Đang xuất…',
    saved: 'Đã lưu:',
    reveal: 'Mở thư mục',
    truncated: 'Dự án lớn: chỉ xuất 5.000 node quan trọng nhất.',
    pushed: (nodes: number, edges: number) => `Đã đẩy ${nodes.toLocaleString('vi-VN')} node, ${edges.toLocaleString('vi-VN')} cạnh.`
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
    empty: 'Không có kết quả',
    modeSymbol: 'Tìm symbol',
    modeAsk: 'Hỏi graph',
    askLabel: 'Câu hỏi cho graph',
    askPlaceholder: 'Ví dụ: luồng đăng nhập đi qua đâu?',
    askHint: 'Enter để hỏi. Trả về vùng graph liên quan, không gọi AI.',
    asking: 'Đang tìm…',
    seeds: 'Điểm bắt đầu',
    askNodes: (n: number, e: number) => `${n} node, ${e} cạnh liên quan`,
    showOnGraph: 'Xem trên graph',
    askTruncated: 'Đã cắt theo ngân sách 2.000 token'
  },
  nodeMenu: {
    findPath: 'Tìm đường tới…',
    impact: 'Vùng ảnh hưởng nếu sửa',
    export: 'Xuất vùng này…'
  },
  path: {
    picking: (label: string) => `Tìm đường từ ${label}: Bấm node đích hoặc tìm trong ô Tìm kiếm · Esc để huỷ`,
    pickingLabel: 'Chế độ chọn đích',
    cancel: 'Huỷ',
    noLink: 'Không tìm thấy liên kết trực tiếp trong graph',
    found: (hops: number) => `Đường đi ${hops} bước`,
    clear: 'Bỏ tô'
  },
  impact: {
    title: (label: string) => `Ảnh hưởng nếu sửa ${label}`,
    back: 'Về thay đổi chưa commit'
  },
  explain: {
    title: 'Giải thích',
    loading: 'Đang tải…',
    none: 'Không có liên kết',
    out: (type: string, n: number) => `${type} → (${n})`,
    in: (type: string, n: number) => `← ${type} (${n})`
  },
  graph: {
    backToRoot: 'Về gốc',
    nothingSelected: 'Chọn một nút để xem chi tiết',
    truncated: 'Đã cắt bớt, thu hẹp bằng cách chọn nút khác',
    isTest: 'Mã kiểm thử'
  }
}
