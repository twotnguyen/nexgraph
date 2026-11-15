# Danh sách kiểm Windows (giao cho P3)

Mỗi dòng ghi **ĐẠT** hoặc **LỖI + mô tả nguyên văn** (chụp màn hình, chép thông báo lỗi). Lỗi tái hiện được → báo lại để viết test và sửa; không tái hiện → ghi vào "Hạn chế đã biết".

Máy: Windows 10/11, tên CPU/RAM ………, có/không GPU rời ………

## A. Cài đặt
- [ ] Tải artifact `.exe` (job `package`, `windows-latest`) từ trang Actions của `twotnguyen/nexgraph` (cần quyền kho riêng tư).
- [ ] Chạy trình cài. Có cảnh báo **Windows SmartScreen** ("Windows protected your PC") vì bản chưa ký: bấm `More info → Run anyway`. Ghi lại nội dung.
- [ ] Mở app lần đầu: thấy màn **Dự án**, không báo lỗi engine.
- [ ] Dung lượng bộ cài ……… MB (ngưỡng editor + agent < 400 MB; ghi thực đo, không dùng kích thước `.app` giải nén).

## B. Kịch bản demo (`docs/demo-script.md`)
- [ ] Bước 1: mở thư mục bản sao NestJS (chép sang `C:\Users\<tên>\Đồ án\nestjs demo`).
- [ ] Bước 2: thẻ Kiến trúc và thẻ Bản đồ.
- [ ] Bước 3: thẻ Luồng (`signIn`), Agent chế độ Hỏi, chip mở đúng dòng trong Monaco.
- [ ] Bước 4: sửa `string-util.service.ts` ngay trong NexGraph, Ctrl+S, thẻ Thay đổi cập nhật.
- [ ] Tổng thời gian ……… phút.

## C. Năm kịch bản lỗi (spec §6.3)
- [ ] 1. Chưa cấu hình AI: mọi thẻ dùng được, chat hiện hướng dẫn.
- [ ] 2. Mở dự án lớn chưa lập chỉ mục: hiện hộp thoại dự án lớn, chọn thư mục con được.
- [ ] 3. Mở một dự án Go/Java nhỏ: lập chỉ mục được ở mức chung.
- [ ] 4. Tắt mạng (tắt Wi-Fi): dự án đã lập chỉ mục vẫn mở; chat báo `ai_unreachable`.
- [ ] 5. Thư mục không có `.git`: thẻ Thay đổi hiện ghi chú "Không có Git: so với lần lập chỉ mục trước".

## D. Riêng Windows
- [ ] Thẻ **Bản đồ** (WebGL) trên máy không có GPU rời: hiện đồ thị hoặc báo không hỗ trợ (không trắng màn hình).
- [ ] Đường dẫn có dấu tiếng Việt và khoảng trắng (`C:\Users\...\Đồ án\nestjs demo`): lập chỉ mục, mở code từ chip trích dẫn, thẻ Thay đổi.
- [ ] **Git hook** (Tổng quan → "Cập nhật sau mỗi commit"): cài Git for Windows; bật hook; `git commit` một thay đổi trong dự án; trong vài giây thẻ Thay đổi/Tổng quan hết "Graph cũ". Gỡ hook; tệp `.git/hooks/post-commit` mất khối nexgraph.
- [ ] **Tích hợp trợ lý AI**: ghi `.mcp.json`; mở lại bằng Claude Code (nếu có) và gọi `graph_stats`.
- [ ] Đóng app: không còn tiến trình `nexgraph-engine.exe` mồ côi trong Task Manager.


## E. Editor + agent tích hợp (F13–F15)

- [ ] Mở tệp CRLF có BOM, sửa và Ctrl+S; byte xuống dòng/BOM giữ nguyên.
- [ ] Thẻ chưa lưu còn nguyên khi đổi thẻ; đóng thẻ/thoát app hỏi trước khi bỏ nội dung.
- [ ] Sửa cùng tệp từ bên ngoài: thẻ sạch nạp lại; thẻ bẩn hiện Nạp lại / Giữ bản của tôi, không tự ghi đè.
- [ ] API key, custom provider, chọn model và Kiểm tra kết nối; ô key không hiện lại khoá đã lưu.
- [ ] Hỏi có streaming, Dừng, chip trích dẫn và Tô luồng.
- [ ] Chuyển Sửa thấy cảnh báo không có sandbox; Duyệt diff làm đổi tệp, Từ chối không đổi.
- [ ] Đang chờ duyệt: bấm Dừng / đổi Hỏi / tải lại cửa sổ → từ chối ngay, lượt sau vẫn dùng được.
- [ ] `bash`: spike chưa kiểm Windows; ghi shell đang có, duyệt một lệnh vô hại (`echo NexGraph`). Thiếu shell hoặc chạy lỗi phải ghi nguyên văn, không coi là đã hỗ trợ.
- [ ] OAuth: thử nhà cung cấp được phép, ghi kết quả và khả năng huỷ; không dùng tài khoản thật khi chưa đọc cảnh báo hạn chế tài khoản.
- [ ] Codex MCP + skill: xem trước, áp dụng trong dự án, nội dung cấu hình cũ giữ nguyên.
- [ ] Chạy `pnpm --filter @nexgraph/desktop smoke:packaged` → có `SMOKE OK ... fs=OK agent=OK`.
- [ ] Trạng thái hiện tại: **chưa kiểm trên Windows**, P3 ghi máy/ngày và kết quả trước nghiệm thu.
## F. Ghi chú thêm
………
