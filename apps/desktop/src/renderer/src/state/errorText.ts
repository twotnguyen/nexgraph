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
  ai_not_configured: 'Chưa cấu hình trợ lý AI',
  session_not_found: 'Hội thoại không thuộc tài khoản và dự án đang chọn',
  unapproved_task: 'Chỉ chạy được task khai trong .vscode/tasks.json hoặc .nexgraph/tasks.json của dự án.'
}

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
  // Chỉ thay bằng câu theo mã khi UI đang English và câu cụ thể chưa có bản Anh: người dùng
  // tiếng Việt vẫn thấy đúng câu chi tiết của main, không bị hạ xuống câu chung.
  const code = errorCode(e)
  if (code && codeErrors[code] && getLocale() === 'en') return msg(codeErrors[code])
  return msg(text)
}

/** Câu lỗi để hiển thị: lỗi IPC qua contextBridge là object có `message` nhưng không `instanceof Error` ở renderer. */
export const errorText = (e: unknown): string => msgText(errorMsg(e))
