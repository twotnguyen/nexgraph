// Thư mục gốc của các dự án đã mở, dùng cho protocol `nxpage://`.
// Chỉ dự án mà renderer đã hỏi trạng thái trang mới được đăng ký → không phục vụ đường dẫn tuỳ ý.
export const pageRoots = new Map<string, string>()
