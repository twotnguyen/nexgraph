import { type Message, MsgError, msg, msgText } from './messages'
import { getLocale } from './locale'

/** Lỗi IPC tiếng Việt phổ biến: chỉ những câu có bản dịch mới đổi theo ngôn ngữ. */
const knownErrors: Record<string, true> = {
  'API key bị từ chối': true,
  'API key bị từ chối. Kiểm tra lại trong Cài đặt.': true,
  'Không tìm thấy mô hình ở nhà cung cấp. Kiểm tra tên mô hình trong Cài đặt.': true,
  'Nhà cung cấp AI từ chối yêu cầu.': true,
  'Nhà cung cấp AI tạm thời gặp lỗi.': true,
  'Ngữ cảnh vượt giới hạn mô hình — tăng context window hoặc rút gọn câu hỏi.': true,
  'Đã chạm hạn mức hoặc giới hạn tốc độ của nhà cung cấp. Kiểm tra hạn mức rồi thử lại.': true,
  'Không kết nối được tới nhà cung cấp AI': true,
  'Không kết nối được tới nhà cung cấp AI.': true,
  'Trợ lý AI gặp lỗi': true,
  'Đã dừng': true,
  'Nhà cung cấp AI đã thay đổi. Hãy kiểm tra đích nhận và gửi lại câu hỏi.': true,
  'Chưa chọn model hoặc model không còn': true,
  'Máy chủ nội bộ gặp lỗi. Vui lòng thử lại.': true,
  'Thay đổi tệp đã được ghi. Chưa cập nhật được đồ thị, hãy lập chỉ mục lại sau khi engine sẵn sàng.': true,
  'Thay đổi đã lưu. Chưa cập nhật được đồ thị; hãy lập chỉ mục lại khi engine sẵn sàng.': true,
  'Một số tệp chưa được lưu. Đóng cửa sổ sẽ mất các thay đổi.': true,
  'Đã huỷ đăng nhập': true,
  'Đang có đăng nhập khác đang chạy': true,
  'Đã xóa thông tin đăng nhập. Mở lại ứng dụng để đồng bộ danh sách tài khoản.': true,
  'Chưa hoàn tất đăng nhập ChatGPT. Hãy bắt đầu lại.': true,
  'Đăng nhập ChatGPT chưa được chấp thuận': true,
  'Đăng nhập ChatGPT quá thời gian chờ. Hãy bắt đầu lại.': true,
  'Không mở được callback ChatGPT': true,
  'Đường dẫn không hợp lệ': true,
  'Điểm dừng không hợp lệ': true,
  'Đường dẫn language server không hợp lệ': true,
  'Tệp cấu hình hiện có không phải JSON hợp lệ': true,
  'Ảnh đính kèm không hợp lệ, sai định dạng hoặc vượt 24 MiB. Chỉ hỗ trợ PNG, JPEG, GIF và WebP.': true,
  'Đang đồng bộ trạng thái editor. Hãy thử lại sau khi bản nháp được xác nhận.': true,
  'Đường dẫn đã thay đổi từ lúc xem trước duyệt': true,
  'Chế độ hiện tại chỉ cho phép đọc': true,
  'Không có tác vụ đang hoạt động': true,
  'Không còn tác vụ đang hoạt động': true,
  'Không còn bản duyệt khớp cho thao tác này; hãy chạy lại từ đầu': true,
  'Thiếu đường dẫn hợp lệ': true,
  'Các edit chồng nhau': true,
  'Edit không thay đổi nội dung': true,
  'Thiếu đường dẫn tệp': true,
  'Thiếu nội dung': true,
  'Thiếu edits': true,
  'Đường dẫn không khả dụng theo phạm vi truy cập của AI': true,
  'Tệp không phải văn bản UTF-8': true,
  'Không xác định được phạm vi truy cập tệp của AI': true,
  'Hãy chọn một tệp để đọc': true,
  'Tệp không khả dụng theo phạm vi truy cập của AI': true,
  'Hãy chọn một thư mục để liệt kê': true,
  'Hãy chọn một thư mục để tìm tệp': true,
  'Checkpoint không hợp lệ': true,
  'Lệnh trước chưa đối chiếu checkpoint, hãy kiểm lại phiên trước khi chạy tiếp': true,
  'Thiếu checkpoint trước khi chạy lệnh': true,
  'Checkpoint chưa xác nhận đã ghi, cần đối chiếu tệp bằng tay': true,
  'Tệp được tạo lại sau tác vụ': true,
  'Tệp đã được sửa sau tác vụ. Giữ nguyên thay đổi hiện tại.': true,
  'Chọn mô hình trước khi tạo hội thoại': true,
  'Chọn mô hình trước khi tách hội thoại': true,
  'Chọn mô hình trước khi mở hội thoại': true,
  'Chưa chọn mô hình': true,
  'Hội thoại không thuộc tài khoản và dự án đang chọn': true,
  'Trợ lý đang chạy tác vụ. Bấm Dừng trước khi đổi hội thoại hoặc quyền thực thi.': true,
  'Trợ lý đang trả lời': true,
  'Câu hỏi trống hoặc vượt 200.000 ký tự': true,
  'Không nạp được bộ công cụ an toàn của NexGraph': true,
  'Đã đạt giới hạn thời gian của tác vụ': true,
  'Đã đạt ngân sách token của tác vụ': true,
  'Đã đạt giới hạn số lượt gọi mô hình của tác vụ': true,
  'Chưa cho phép chạy mã của dự án': true,
  'Đang có một lệnh chạy trong tác vụ': true,
  'Đã đạt giới hạn 12 lệnh cho tác vụ': true,
  'Lệnh quá dài': true,
  'Lệnh tải hoặc gửi dữ liệu ra ngoài chưa được cấp quyền': true,
  'Tác vụ chỉ được dùng Git để đọc, không push hoặc thay đổi lịch sử': true,
  'Chỉ chạy script và công cụ đã có trong dự án, cài đặt hoặc phát hành cần thao tác riêng': true,
  'Dùng script package.json hoặc binary đã cài, npm exec có thể tải gói': true,
  'uv chỉ chạy với run --offline để dùng môi trường đã cài': true,
  'Lệnh phải có executable và mảng args hợp lệ': true,
  'cwd phải tương đối với dự án': true,
  'cwd phải là thư mục': true,
  'Thời gian chạy phải từ 100 ms đến 300000 ms': true,
  'Không tìm thấy JS entry cho lệnh Windows. Chọn executable hoặc script đã cài.': true,
  'Tham số công cụ không hợp lệ': true,
  'Công cụ không được phép dùng trong chế độ hiện tại': true,
  'Có quá nhiều công cụ đang chạy': true,
  'Chế độ hoặc hồ sơ trợ lý hiện tại không cho dùng công cụ này': true,
  'Không mở được cổng công cụ Gemini': true,
  'Kết nối Google đã thay đổi. Hãy kiểm tra và xác nhận lại trước khi gửi mã nguồn.': true,
  'Yêu cầu không được phép trong kết nối NexGraph': true,
  'Không hỗ trợ': true,
  'Engine chưa sẵn sàng.': true,
  'Engine không phản hồi kịp. Hãy thử lại.': true,
  'Không kết nối được engine.': true,
  'Không tìm thấy dự án': true,
  'Dự án không phải kho Git': true,
  'Thao tác Git không thành công': true,
  'Chỉ chạy được task khai trong .vscode/tasks.json hoặc .nexgraph/tasks.json của dự án.': true,
  'Task không do NexGraph cấp, hãy chọn lại trong danh sách tác vụ.': true,
  'Quyền thực thi không hợp lệ': true,
  'Ngân sách phải là số nguyên dương và thời gian phải nằm trong giới hạn bộ đếm của hệ thống': true,
  'Chế độ trợ lý không hợp lệ': true,
  'Đã đổi chế độ': true,
  'Không thể tách hội thoại': true,
  'Tệp đang có bản nháp chưa lưu trong trình soạn thảo. Lưu hoặc đóng bản nháp trước khi trợ lý sửa.': true,
  'Mã tác vụ không hợp lệ': true,
  'Tác vụ không thuộc hội thoại của tài khoản và dự án hiện tại': true,
  'Không tìm thấy hội thoại của tác vụ': true,
  'Không xác định được mô hình và khả năng nhận ảnh. Hãy chọn mô hình hỗ trợ ảnh.': true,
  'Chưa cấu hình trợ lý AI': true,
  'Chưa đồng ý gửi dữ liệu tới nhà cung cấp AI': true,
  'Mô hình đang chọn không hỗ trợ ảnh hoặc chưa xác định được khả năng nhận ảnh.': true,
  'Không khởi động được tác vụ': true,
  'Đã đóng dự án': true,
  'Đã đổi hội thoại': true,
}

/**
 * Câu do main dựng kèm số liệu (không thể đặt khoá từ điển): đổi thành khoá + biến để dịch
 * lúc render như mọi `Msg` khác.
 */
const dynamicErrors: { re: RegExp; key: string }[] = [
  {
    re: /^Mô hình chỉ có (\d+) token ngữ cảnh, không đủ cho system prompt \+ công cụ — chọn mô hình lớn hơn\.$/,
    key: 'Mô hình chỉ có {n} token ngữ cảnh, không đủ cho system prompt + công cụ — chọn mô hình lớn hơn.'
  }
]

/**
 * Câu dự phòng theo **mã lỗi** của main/engine: câu cụ thể của main có thể chưa có bản Anh,
 * nhưng mã thì ổn định — renderer dịch câu chuẩn của mã (I18N-IPC). Câu cụ thể trong
 * `knownErrors` vẫn thắng vì nói rõ nguyên nhân hơn.
 */
export const codeErrors: Record<string, string> = {
  engine_unavailable: 'Engine chưa sẵn sàng.',
  forbidden_sender: 'Yêu cầu không đến từ cửa sổ NexGraph.',
  forbidden_owner: 'Chỉ cửa sổ đang chạy tác vụ được trả lời yêu cầu duyệt.',
  bad_locale: 'Ngôn ngữ không hợp lệ.',
  engine_timeout: 'Engine không phản hồi kịp. Hãy thử lại.',
  internal: 'Máy chủ nội bộ gặp lỗi. Vui lòng thử lại.',
  unknown_project: 'Không tìm thấy dự án',
  no_git: 'Dự án không phải kho Git',
  git_failed: 'Thao tác Git không thành công',
  conflict: 'Tệp đang có bản nháp chưa lưu trong trình soạn thảo. Lưu hoặc đóng bản nháp trước khi trợ lý sửa.',
  consent_required: 'Chưa đồng ý gửi dữ liệu tới nhà cung cấp AI',
  task_not_found: 'Không tìm thấy hội thoại của tác vụ',
  image_not_supported: 'Mô hình đang chọn không hỗ trợ ảnh hoặc chưa xác định được khả năng nhận ảnh.',
  agent_busy: 'Trợ lý đang trả lời',
  runtime_switch_blocked: 'Không đổi runtime khi trợ lý đang chạy hoặc đang chờ duyệt. Hãy dừng lượt hiện tại trước.',
  ai_not_configured: 'Chưa cấu hình trợ lý AI',
  session_not_found: 'Hội thoại không thuộc tài khoản và dự án đang chọn',
  unapproved_task: 'Chỉ chạy được task khai trong .vscode/tasks.json hoặc .nexgraph/tasks.json của dự án.',
  // Mã của engine (#48/#52): câu engine trả là tiếng Việt (CSDL đồ thị) hoặc tiếng Anh (nguồn URL),
  // nên renderer dịch theo mã cho cả hai chiều.
  graph_readonly: 'Không ghi được CSDL đồ thị: tệp đang chỉ đọc hoặc thiếu quyền ghi.',
  graph_busy: 'Đồ thị đang được cập nhật bởi tiến trình khác. Thử lại sau.',
  graph_unreadable: 'Không đọc được CSDL đồ thị của dự án.',
  schema_outdated: 'CSDL đồ thị cũ hơn ứng dụng. Mở lại dự án bằng ứng dụng để nâng cấp.',
  schema_version: 'Phiên bản CSDL đồ thị không được hỗ trợ.',
  method_not_allowed: 'Yêu cầu không được phép trong kết nối NexGraph',
  blocked_url_scheme: 'Nguồn URL dùng giao thức không được hỗ trợ.',
  blocked_url_credentials: 'URL nguồn không được chứa thông tin đăng nhập.',
  blocked_url_port: 'Cổng trong URL nguồn không hợp lệ.',
  blocked_url_host: 'URL nguồn thiếu tên máy chủ.',
  blocked_cloud_metadata: 'URL nguồn trỏ tới endpoint metadata của cloud nên bị chặn.',
  blocked_private_ip: 'URL nguồn trỏ tới địa chỉ IP riêng hoặc nội bộ nên bị chặn.',
  blocked_url: 'URL nguồn không hợp lệ hoặc bị chặn.',
  dns_failed: 'Không phân giải được tên máy chủ của URL nguồn.',
  bad_url: 'URL nguồn không hợp lệ.',
  // Mã lỗi chính của main (review #57 I3): câu chuẩn để UI English dịch được cả khi câu gốc
  // của main là tiếng Việt hoặc rỗng.
  adapter_exit: 'Debug adapter đã dừng.',
  adapter_timeout: 'Debug adapter không khởi động.',
  ai_cancelled: 'Đã dừng',
  ai_disabled: 'Chưa bật phân tích bằng AI cho dự án này.',
  ai_error: 'Trợ lý AI gặp lỗi',
  ai_failed: 'Mô hình không trả về thông điệp commit.',
  ai_provider_changed: 'Nhà cung cấp AI đã thay đổi. Hãy thử lại.',
  ai_unreachable: 'Không kết nối được tới nhà cung cấp AI.',
  auth_unavailable: 'Antigravity không cung cấp đăng nhập Google.',
  bad_checksum: 'Tệp tải về sai mã băm.',
  bad_param: 'Tham số không hợp lệ.',
  bad_peer: 'Máy chia sẻ trả lời không hợp lệ.',
  bad_task: 'Task không hợp lệ.',
  cancelled: 'Đã dừng yêu cầu Gemini.',
  connect_failed: 'Không nối được tới máy chia sẻ.',
  download_failed: 'Không tải được tệp cần thiết.',
  file_not_found: 'Không tìm thấy tệp hoặc thư mục.',
  filesystem_error: 'Không thể hoàn tất thao tác tệp: kiểm tra quyền truy cập và đường dẫn.',
  frame_too_large: 'Nội dung vượt giới hạn 8 MiB.',
  google_busy: 'Google đang cài đặt hoặc đăng nhập. Dừng thao tác trước khi tiếp tục.',
  google_not_installed: 'Cài Antigravity CLI trong cài đặt trước khi đăng nhập Google.',
  graph_unavailable: 'Đồ thị chưa sẵn sàng để dùng.',
  install_failed: 'Giải nén gói không thành công.',
  invalid_debug_config: 'Tệp cấu hình gỡ lỗi không phải JSON hợp lệ.',
  invalid_frame: 'Phản hồi Antigravity CLI vượt giới hạn hoặc không phải UTF-8.',
  invalid_id: 'Mã yêu cầu ACP không hợp lệ.',
  invalid_json: 'Antigravity CLI gửi dữ liệu không đúng giao thức.',
  invalid_message: 'Phản hồi ACP không hợp lệ.',
  invalid_response: 'Phản hồi ACP thiếu kết quả.',
  invalid_tasks: 'Tệp cấu hình tác vụ không hợp lệ.',
  invalid_timeout: 'Thời gian chờ Gemini không hợp lệ.',
  licenses_missing: 'Không đọc được tệp giấy phép mã nguồn mở đi kèm ứng dụng.',
  missing_task_context: 'Không có ngữ cảnh cho biến trong tác vụ.',
  model_unavailable: 'Antigravity chưa cung cấp danh sách model. Kiểm tra tài khoản và thử lại.',
  no_commit: 'Kho chưa có commit nào.',
  no_debug_config: 'Không tìm thấy cấu hình gỡ lỗi.',
  no_keychain: 'Kho khoá an toàn của hệ điều hành không khả dụng. Không thể sử dụng đăng nhập OAuth.',
  no_lan: 'Không tìm thấy địa chỉ LAN để chia sẻ.',
  no_python: 'Không tìm thấy Python 3 trên máy.',
  no_session: 'Không có phiên gỡ lỗi nào.',
  no_thread: 'Không tìm thấy luồng đang chạy.',
  not_committed: 'Tệp chưa có trong commit HEAD. Hãy commit trước khi tạo permalink.',
  notification_error: 'Không xử lý được cập nhật từ Antigravity CLI.',
  oauth_storage: 'Không mở được kho đăng nhập OAuth hoặc chưa di trú xong thông tin đăng nhập cũ.',
  outside_project: 'Đường dẫn nằm ngoài dự án và thư mục xuất.',
  process_closed: 'Antigravity CLI đã dừng. Kết nối lại để tiếp tục.',
  process_error: 'Không khởi động được Antigravity CLI. Kiểm tra bộ công cụ đã cài đặt.',
  process_stop_failed: 'Chưa xác nhận Antigravity CLI đã dừng.',
  protected_path: 'Đường dẫn được bảo vệ, không ghi được.',
  session_stop_failed: 'Chưa xác nhận mọi phiên Antigravity đã đóng. Thử ngắt kết nối lại.',
  stale_hunk: 'Tệp đã thay đổi. Hãy làm mới và thử lại.',
  tasks_read_failed: 'Không thể đọc tệp cấu hình tác vụ.',
  terminal_spawn: 'Không mở được chương trình trong terminal.',
  timeout: 'Tác vụ quá thời gian chờ.',
  too_large: 'Danh sách vượt giới hạn.',
  too_many_requests: 'Quá nhiều yêu cầu Gemini đang chờ.',
  transport_closed: 'Mất kết nối tới Antigravity CLI.',
  unsupported_cli: 'Antigravity không đúng phiên bản hoặc thiếu giao thức MCP HTTP được hỗ trợ.',
  unsupported_hook: 'Hook là liên kết tượng trưng, không ghi được.',
  unsupported_hook_path: 'core.hooksPath trỏ ra ngoài kho nên NexGraph không ghi vào đó.',
  unsupported_remote: 'Không tạo được permalink cho remote này.',
  worktree_dirty: 'Worktree còn thay đổi chưa commit hoặc tệp chưa theo dõi. Hãy commit, stash hoặc dọn rồi thử lại.',
}

/**
 * Mã mà engine trả **câu tiếng Anh của chính engine** (nguồn URL, #48/#52): UI tiếng Việt phải
 * dịch sang VI. Các mã khác có thể kèm câu thô của công cụ (`fatal: branch exists`) — giữ nguyên
 * còn hơn thay bằng câu chung.
 */
const englishEngineCodes = new Set([
  'blocked_url_scheme', 'blocked_url_credentials', 'blocked_url_port', 'blocked_url_host',
  'blocked_cloud_metadata', 'blocked_private_ip', 'blocked_url', 'dns_failed', 'bad_url'
])

/** Câu có dấu tiếng Việt: câu tiếng Anh của engine cần dịch sang VI, câu Việt thì giữ nguyên. */
const VIETNAMESE = /[ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬĐÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴàáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/

const errorCode = (e: unknown): string => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '')

const rawText = (e: unknown): string => e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)

/**
 * Lỗi dưới dạng `Message` để state giữ khoá và dịch lúc render (I1): lỗi do renderer ném
 * bằng `msgError` giữ nguyên khoá; câu Việt của main tra `knownErrors`/mẫu động thành khoá;
 * còn lại là câu động (engine) — `tr()` trả nguyên văn như trước.
 */
export function errorMsg(e: unknown): Message {
  if (e instanceof MsgError) return e.msg
  const text = rawText(e)
  if (knownErrors[text] === true) return msg(text)
  for (const rule of dynamicErrors) {
    const match = rule.re.exec(text)
    if (match) return msg(rule.key, { n: match[1] })
  }
  // Câu cụ thể của main thắng khi nó đã đúng ngôn ngữ UI. Chỉ thay bằng câu chuẩn của mã khi
  // câu lệch ngôn ngữ: UI English gặp câu Việt chưa có bản Anh, hoặc UI Việt gặp câu Anh của
  // engine (nguồn URL). Câu thô của công cụ (`fatal: …`, stderr) giữ nguyên — đổi thành câu
  // chung là nuốt mất nguyên nhân (review #57 I2). Câu rỗng dùng câu chung của mã.
  const code = errorCode(e)
  if (code && codeErrors[code]) {
    const vietnamese = VIETNAMESE.test(text)
    const empty = text.trim() === ''
    if (getLocale() === 'en' ? vietnamese || empty : englishEngineCodes.has(code) && (empty || !vietnamese)) return msg(codeErrors[code])
  }
  return msg(text)
}

/** Câu lỗi để hiển thị: lỗi IPC qua contextBridge là object có `message` nhưng không `instanceof Error` ở renderer. */
export const errorText = (e: unknown): string => msgText(errorMsg(e))
