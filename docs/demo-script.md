# Kịch bản demo NexGraph (≤ 5 phút)

Dự án demo: bản sao `ecommerce-backend-nestjs` (TypeScript, 268 tệp), lập chỉ mục sẵn trước khi vào phòng. Bản sao có `git init` + một commit để thẻ Thay đổi chạy theo HEAD. Máy demo: macOS. Chuẩn bị 10 phút trước: mở app, kiểm tra **Cài đặt → Tài khoản AI** bằng API key hoặc nhà cung cấp tuỳ chỉnh, chọn model, kiểm tra kết nối, tắt thông báo hệ thống. Không dùng OAuth làm đường demo chính.

| # | Bước (spec §1.2) | Thao tác cụ thể | Mục tiêu | Dự phòng |
|---|---|---|---|---|
| 1 | Mở app, chọn thư mục | Màn **Dự án** → `Mở thư mục…` → chọn bản sao NestJS. Dự án đã lập chỉ mục nên vào thẳng **Tổng quan**: đọc số tệp · node · cạnh. | 0:30 | Dự án không có trong danh sách "Dự án gần đây" → mở lại thư mục; nếu hỏi lập chỉ mục, bấm `Dựng graph` (≈ 1 s với tầng S, đã đo 0,98 s). |
| 2 | Bản đồ kiến trúc | Thẻ **Kiến trúc** → `Xem`: màn gốc có các khối `src`, `test` và hai tệp cấu hình; bấm `src` rồi `apps` để đi xuống các module; bấm một mũi tên xem bằng chứng. Quay lại, mở thẻ **Bản đồ** để cho thấy toàn cảnh. | 1:00 | Bản đồ không hiện (WebGL lỗi) → app báo `onUnsupported` và dùng thẻ Kiến trúc; chỉ nói về Kiến trúc. |
| 3 | Hỏi "luồng đăng nhập chạy thế nào?" | Mở thẻ **Luồng** → chọn `signIn` → Phát qua các cạnh thật. Mở **Agent** (Ctrl/Cmd+L), giữ chế độ **Hỏi**, đồng ý gửi mã rồi hỏi. Bấm chip trích dẫn: tệp mở trong Monaco đúng dòng; bấm Tô luồng để xem đường đi trên graph. | 1:30 | AI mất mạng: dùng thẻ Luồng, không suy diễn mũi tên. Khi kiểm thử có thể chạy `node apps/desktop/scripts/fake-llm.mjs` rồi thêm provider tuỳ chỉnh với URL `/v1`; phải nói rõ đó là LLM giả, không coi là kết quả AI thật. |
| 4 | Sửa trong NexGraph, có duyệt | Mở `src/common/utils/string-util/string-util.service.ts` từ Cây, sửa một dòng không đổi hành vi và Cmd/Ctrl+S. Sang Agent → **Sửa**, đọc cảnh báo không có sandbox; nhờ sửa một hàm nhỏ. Đọc diff và vùng ảnh hưởng agent trình bày, bấm **Duyệt**. Tệp mở tự nạp lại nếu sạch; **Thay đổi** hiện vùng ảnh hưởng + test liên quan. Yêu cầu sửa lần nữa, bấm **Từ chối** và xác nhận tệp không đổi. | 1:00 | Agent lỗi: chỉ sửa tay trong Monaco. Thay đổi chưa hiện → Làm mới; không ghi đè thẻ đang sửa khi có thanh xung đột. Trước mỗi lần demo dùng bản sao sạch; không hoàn tác tự động trên dự án thật. |
| 5 | Slide số liệu đánh giá | Chuyển sang slide: bảng độ đúng, hiệu năng, agent có/không MCP (số từ `2026-12-danh-gia.md`). | 0:30 | Slide PDF xuất sẵn trong máy. |

Tổng mục tiêu: 4:30, còn 0:30 dư.

## Phương án khi hội đồng yêu cầu dự án khác
Lập chỉ mục trực tiếp một dự án nhỏ (tầng S, < 60 s): bấm `Mở thư mục…` chọn dự án, theo dõi thanh tiến độ hai giai đoạn rồi đi lại bước 2–4. Dự án có ngôn ngữ ngoài ưu tiên → app chạy ở mức "graph chung" và có thông báo mức hỗ trợ.

## Kết quả kiểm (ghi sau khi chạy)
Xem mục "Kịch bản demo" trong `docs/benchmarks/2026-12-danh-gia.md`: những gì đã chạy bằng engine thật, những gì **chưa** chạy trên cửa sổ Electron.

### Kiểm bản editor + agent

- [ ] Chạy đủ năm bước trên bản đóng gói macOS lần 1, ghi thời gian và ảnh.
- [ ] Lần 2: thử cả Duyệt/Từ chối, kiểm tệp trên đĩa.
- [ ] Lần 3: tắt mạng ở lượt Hỏi, dùng phương án dự phòng; kiểm nội dung chưa lưu còn nguyên khi đổi thẻ.
- [ ] Kiểm riêng provider thật/OAuth khi có tài khoản; LLM giả chỉ chứng minh luồng tích hợp.
