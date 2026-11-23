# Ghi chú phát hành NexGraph 0.2.0 (bản nháp)

> **Trạng thái:** nháp, chưa phát hành. Bản đang phát hành là **0.1.2**. Tệp này là nội dung dự kiến cho GitHub Release `v0.2.0`; chỉ dùng sau khi RC được nghiệm thu và Tình tạo tag. Nội dung tính năng lấy từ lịch sử commit `v0.1.2..main` (72 commit tính đến `f4d6e35`) và mã trên `main`; không chép body tự sinh của `gh release create --generate-notes`.

## Tóm tắt

0.2.0 gộp bộ công cụ phát triển kiểu Wu (F16, ADR 0020) vào bản Electron + Monaco: LSP, terminal, Git, gỡ lỗi DAP, cộng tác LAN và extension khai báo. Giao diện làm lại theo 5 vùng, có bảng lệnh, thanh trạng thái và chế độ tiếng Anh. Các luồng F1–F15 giữ nguyên hành vi.

## Tính năng mới

- **Editor và LSP (F16).** Gợi ý mã, hover, định nghĩa, tham chiếu, thứ bậc lời gọi, rename và code action cho TypeScript/JavaScript và Python; chẩn đoán hiện trong editor và panel Problems.
- **Terminal tích hợp (F16).** Nhiều phiên theo dự án, shell mặc định của máy (PowerShell/cmd trên Windows, `$SHELL` trên macOS), tác vụ nền có picker.
- **Git (F16).** Panel nhánh, thay đổi, lịch sử, diff theo hunk, stage/unstage, stash, worktree, xung đột theo khối, permalink tới dòng.
- **Gỡ lỗi DAP (F16).** Cấu hình chạy cho Node (js-debug) và Python (debugpy), breakpoint, stack, biến, bước tiếp, dừng; adapter tải về lần đầu.
- **Cộng tác LAN (F16).** Máy chia sẻ mở WebSocket trong mạng cục bộ và hiện địa chỉ `IP:cổng` cùng **mã mời 22 ký tự** (base64url); máy khác dán địa chỉ và mã mời để tham gia, tối đa 8 máy tham gia (không kể máy chia sẻ), không qua máy chủ ngoài.
- **Extension khai báo (F16).** Extension JSON khai báo theme, lệnh và snippet; không nạp mã Node tuỳ ý, không có marketplace.
- **Giao diện.** Shell 5 vùng có pane kéo/ thu gọn, thanh trạng thái 11 mục, bảng lệnh kiểu Wu, thông báo và dock, breadcrumb theo ký hiệu, multibuffer, bookmark.
- **Tiếng Anh.** Chuyển ngôn ngữ Việt/Anh trong Cài đặt; toàn bộ chuỗi giao diện có bản dịch (kiểm tự động 681/681 khoá).
- **Trợ lý AI.** Khung trợ lý mặc định bên phải và mở sẵn lần đầu vào workspace (giữ lựa chọn đã lưu), sửa lỗi xuất PNG dùng đúng thư mục xuất đã nhớ của dự án.

## Sửa lỗi

- Khung trợ lý mở đúng bên phải theo bố cục ba cột; trước đó một số hồ sơ mở bên trái.
- Xuất PNG ghi vào thư mục xuất đã lưu của dự án thay vì thư mục mặc định.
- Fixture tên tệp có tab/newline chạy lại được trên macOS/Linux.
- Smoke bộ cài cập nhật theo giao diện hiện tại; test Git và FS chạy được trên Windows.

## Giới hạn đã biết

- **Chưa ký số.** Bộ cài không có chứng chỉ nhà phát triển. macOS có thể báo "không xác minh được nhà phát triển" hoặc "bị hỏng"; Windows có SmartScreen, và máy bật Application Control/Code Integrity có thể chặn trình cài trước khi SmartScreen hiện ra. Cách mở ghi ở [README](README.md#mở-bộ-cài-chưa-ký-số).
- **Chỉ Apple silicon.** Không phát hành bản macOS Intel (x64) theo quyết định R2; Mac Intel ngoài phạm vi. Windows chỉ có x64, không có bản ARM.
- **LSP chỉ TS/JS và Python.** Ngôn ngữ khác có tô màu cú pháp nhưng không có gợi ý mã hay điều hướng ngữ nghĩa.
- **Terminal không phải sandbox.** Lệnh chạy với quyền tài khoản người dùng trong thư mục dự án.
- **Cộng tác LAN không có xác thực người dùng** ngoài mã mời 22 ký tự; chỉ dùng trong mạng tin cậy.
- **Extension chỉ khai báo** theme/lệnh/snippet, không có API mở rộng hay marketplace.
- **Codex TOML.** Khi `.codex/config.toml` đã có nội dung, phần cài đặt trả `invalid_config` thay vì merge (SPEC-09, chưa sửa trong 0.2.0).
- **Nhóm test opt-in không chạy ở CI:** 15 test gỡ lỗi DAP cần `NEXGRAPH_DEBUG_IT=1` và mạng để tải adapter; một test Antigravity cần Windows + `NEXGRAPH_ANTIGRAVITY_TEST_BINARY`. Xem [kế hoạch kiểm thử](test-plan.md).
- **Máy Windows của nhóm bị Code Integrity chặn bộ cài** (biên bản 18/11); luồng người dùng trên Windows được kiểm bằng bản build từ mã nguồn cho tới khi máy đó mở được bộ cài.

## Yêu cầu hệ thống

| Hạng mục | Yêu cầu |
|---|---|
| macOS | Apple silicon (arm64). Không hỗ trợ Mac Intel. |
| Windows | x64. Máy thử nghiệm: Windows 11 Home 25H2 (build 26200). |
| Ổ đĩa | Khoảng 650 MB sau khi cài (số của 0.1.0, cập nhật lại khi RC). |
| Mạng | Chỉ cần khi dùng AI qua nhà cung cấp, clone repo, tải adapter gỡ lỗi hoặc cài Antigravity CLI. Các tính năng đọc đồ thị chạy offline. |

## Cài đặt

Theo [README](README.md): tải đúng tệp trong artifact của lượt CI xanh, đối chiếu `.build.json` (byte, SHA-256, commit), rồi mở theo hướng dẫn cho bộ cài chưa ký.

## Ghi chú cho người bảo trì

- Body này thay cho body tự sinh của `gh release create … --generate-notes` (`.github/workflows/ci.yml:160`); khi tạo Release thật, dán nguyên văn (bỏ phần "Trạng thái" ở đầu) và gắn run id CI của commit merge.
- Nhãn còn thiếu so với 0.1.2 chỉ được thêm khi có bằng chứng nghiệm thu trong [biên bản](acceptance/).
