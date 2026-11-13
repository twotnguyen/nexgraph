# Kịch bản demo NexGraph (≤ 5 phút)

Dự án demo: bản sao `ecommerce-backend-nestjs` (TypeScript, 268 tệp), lập chỉ mục sẵn trước khi vào phòng. Bản sao có `git init` + một commit để thẻ Thay đổi chạy theo HEAD. Máy demo: macOS. Chuẩn bị 10 phút trước: mở app, kiểm tra `Cài đặt → AI` (xem phương án dự phòng bước 3), tắt thông báo hệ thống.

| # | Bước (spec §1.2) | Thao tác cụ thể | Mục tiêu | Dự phòng |
|---|---|---|---|---|
| 1 | Mở app, chọn thư mục | Màn **Dự án** → `Mở thư mục…` → chọn bản sao NestJS. Dự án đã lập chỉ mục nên vào thẳng **Tổng quan**: đọc số tệp · node · cạnh. | 0:30 | Dự án không có trong danh sách "Dự án gần đây" → mở lại thư mục; nếu hỏi lập chỉ mục, bấm `Dựng graph` (≈ 1 s với tầng S, đã đo 0,98 s). |
| 2 | Bản đồ kiến trúc | Thẻ **Kiến trúc** → `Xem`: màn gốc có các khối `src`, `test` và hai tệp cấu hình; bấm `src` rồi `apps` để đi xuống các module; bấm một mũi tên xem bằng chứng. Quay lại, mở thẻ **Bản đồ** để cho thấy toàn cảnh. | 1:00 | Bản đồ không hiện (WebGL lỗi) → app báo `onUnsupported` và dùng thẻ Kiến trúc; chỉ nói về Kiến trúc. |
| 3 | Hỏi "luồng đăng nhập chạy thế nào?" | Mở thẻ **Luồng** → chọn luồng `signIn` (`Post('sign-in')`, 8 bước, 4 tệp) → `Phát`: đi qua `AuthController.signIn` → `AuthService.signIn` → `UsersService.getUser` → `StringUtilService.compare` → `getUserRoleType` / `getUserPermissions` / `createToken`; mỗi bước mở đúng dòng. Sau đó mở **Trợ lý AI** (Ctrl/Cmd+L), gõ câu hỏi, bấm chip trích dẫn để mở code, bấm `Tô luồng trên graph`. | 1:30 | AI lỗi hoặc mất mạng: bỏ phần chat, chỉ dùng thẻ **Luồng** (không cần AI, đủ cho bước này). Có sự cố key: chạy `node apps/desktop/scripts/fake-llm.mjs` và trỏ Cài đặt tới `http://127.0.0.1:<cổng>` (đã kiểm trong `ai-e2e.test.ts`). |
| 4 | Sửa hàm trong editor ngoài | Mở `src/common/utils/string-util/string-util.service.ts`, sửa thân `compare` (dòng 14–16), lưu. Thẻ **Thay đổi** → `Làm mới`: hiện `StringUtilService` và `StringUtilService.compare`; **Vùng ảnh hưởng** gồm `AuthService.signIn`, `AuthController.signIn` và các module Nest import `StringUtilModule`; **Test liên quan** (engine thật, 3/3 lần): `order.service.spec.ts`, `users.service.spec.ts`, `string-util.service.spec.ts`. | 1:00 | Thẻ Thay đổi trống → bấm `Làm mới`; vẫn trống → kiểm `git status` trong bản sao (phải có thay đổi chưa commit). |
| 5 | Slide số liệu đánh giá | Chuyển sang slide: bảng độ đúng, hiệu năng, agent có/không MCP (số từ `2026-12-danh-gia.md`). | 0:30 | Slide PDF xuất sẵn trong máy. |

Tổng mục tiêu: 4:30, còn 0:30 dư.

## Phương án khi hội đồng yêu cầu dự án khác
Lập chỉ mục trực tiếp một dự án nhỏ (tầng S, < 60 s): bấm `Mở thư mục…` chọn dự án, theo dõi thanh tiến độ hai giai đoạn rồi đi lại bước 2–4. Dự án có ngôn ngữ ngoài ưu tiên → app chạy ở mức "graph chung" và có thông báo mức hỗ trợ.

## Kết quả kiểm (ghi sau khi chạy)
Xem mục "Kịch bản demo" trong `docs/benchmarks/2026-12-danh-gia.md`: những gì đã chạy bằng engine thật, những gì **chưa** chạy trên cửa sổ Electron.
