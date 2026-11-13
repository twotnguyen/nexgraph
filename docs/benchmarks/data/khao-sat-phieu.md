# Phiếu khảo sát NexGraph (một trang)

Dự án lạ: bản sao `ecommerce-backend-nestjs` ở commit `d11f4ef7d906ba514cf9e3c2234116ad49789ee7`, đã lập chỉ mục sẵn trong NexGraph. Nửa nhóm làm cả năm câu bằng NexGraph + trình soạn thảo, nửa nhóm chỉ dùng trình soạn thảo (VS Code, tìm kiếm văn bản được dùng). Tối đa **5 phút mỗi câu**, quá giờ ghi `dung=0`.

## Năm câu hỏi (đưa cho người làm)

1. Dự án có những khối chính nào, và module `orders` phụ thuộc những module nào khác trong `src/apps`?
2. Luồng đăng nhập (`POST /auth/sign-in`) đi qua những tệp nào, theo thứ tự gọi?
3. Phương thức `getUser` của `UsersService` được gọi từ những đâu (tệp và dòng, không tính tệp test)?
4. Nếu sửa `UsersService.getUser`, cần chạy những tệp test nào?
5. Tệp nào là điểm khởi động của ứng dụng?

## Bốn câu thang 1–5 (1 = rất không đồng ý, 5 = rất đồng ý), chỉ nhóm dùng NexGraph

- `de_dung`: NexGraph dễ dùng.
- `ban_do`: Bản đồ / Kiến trúc giúp tôi hiểu cấu trúc dự án.
- `luong`: Thẻ Luồng giúp tôi hiểu một tính năng chạy thế nào.
- `dung_lai`: Tôi sẽ dùng lại NexGraph khi đọc dự án lạ.

## Đáp án (chỉ người điều phối giữ)

Mỗi đáp án lấy bằng `grep` và đọc mã (không dùng NexGraph), trên bản sao ở commit trên.

1. **Khối chính:** các thư mục trong `src`: `apps` (các module nghiệp vụ), `common`, `catch-everything`, `events`, `testing`; `src/apps` chứa 20+ module (auth, users, orders, products…). **`orders` phụ thuộc** (import ở tệp không phải test): `promotions`, `order-promotions`, `order-items`, `order-addresses`, `payments`, `vendors` (chỉ `entities/vendor.entity`), `auth` (`auth.decorator`), cùng `src/common` (pagination-util, string-util, excel-util, user.decorator, parse-params-pagination.pipe, prisma-base.service). Đúng đủ: nêu ≥ 6/7 module nghiệp vụ và nhận ra `common`; một phần: nêu ≥ 4/7.
2. **Luồng đăng nhập:** `src/apps/auth/auth.controller.ts` (`signIn`, dòng 24) → `src/apps/auth/auth.service.ts` (`signIn`, 111) → `src/apps/users/users.service.ts` (`getUser`, 50) → `src/common/utils/string-util/string-util.service.ts` (`compare`, 14) → quay lại `auth.service.ts` (`getUserRoleType` 30, `getUserPermissions` 45, `createToken` 70); ngoài ra `UsersService.getUser` (`users.service.ts:55`) gọi `UsersService.getUserRoleType` (68). Đúng: đủ 4 tệp theo thứ tự controller → auth.service → users.service → string-util.
3. **Nơi gọi `UsersService.getUser`** (ngoài test): `src/apps/auth/auth.service.ts:99`, `src/apps/auth/auth.service.ts:113`, `src/apps/users/users.controller.ts:65`. (Tệp `*.spec.ts` có gọi `service.getUser` trong `users.service.spec.ts:82`: không tính theo đề.) Đúng đủ: 3/3.
4. **Test cần chạy khi sửa `UsersService.getUser`:** tối thiểu `src/apps/users/users.service.spec.ts` (có `describe('getUser')`). Các tệp test khác dùng `UsersService`: `role-permissions.service.spec.ts`, `user-system-roles.service.spec.ts`, `user-vendor-roles.service.spec.ts`, `vendors.service.spec.ts`. Đúng đủ: cả 5; một phần: có `users.service.spec.ts`.
5. **Điểm khởi động:** `src/main.ts` (hàm `bootstrap`).

Lưu ý cho người điều phối: đáp án 1 và 4 có phần chủ quan (định nghĩa "phụ thuộc", "cần chạy"); chấm theo mức đúng đủ / một phần ở trên và ghi `dung` = 1 / 0,5 / 0.

## Hướng dẫn người điều phối (5 dòng)

1. Không gợi ý, không chỉ chỗ bấm trong NexGraph ngoài lời giới thiệu 2 phút ban đầu (giống nhau cho mọi người).
2. Bấm giờ mỗi câu từ lúc đọc xong đề; dừng khi người làm nói "xong" hoặc hết 5 phút.
3. Ghi nguyên văn câu trả lời; chấm sau, không chấm tại chỗ.
4. Chia nhóm ngẫu nhiên (tung đồng xu); mỗi người làm cả năm câu một lần, cùng thứ tự câu.
5. Sau câu 5, nhóm NexGraph điền bốn câu thang đo; ghi vào `khao-sat-ket-qua.csv`.

**Cần:** 5–10 bạn cùng lớp, khoảng 30 phút mỗi người; một máy đã mở sẵn bản sao NestJS đã lập chỉ mục trong NexGraph và một máy chỉ có trình soạn thảo.

## Bảng kết quả (điền)

`khao-sat-ket-qua.csv`, mỗi dòng một câu của một người: `nguoi,nhom,cau,dung,giay,de_dung,ban_do,luong,dung_lai` (`nhom` = `nexgraph` hoặc `editor`; `dung` ∈ {0, 0.5, 1}; bốn cột thang đo chỉ điền ở nhóm `nexgraph`, dòng câu 5).
