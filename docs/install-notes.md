# Ghi chú cài đặt bản chưa ký số

Bản cài của NexGraph **chưa ký số**, nên macOS (Gatekeeper) và Windows (SmartScreen) sẽ cảnh báo. Bảng dưới ghi những gì đã kiểm tra thật và những gì chưa.

| Nền tảng | Đã kiểm tra | Kết quả |
|---|---|---|
| macOS 15 (Darwin 24.6), Apple Silicon, build cục bộ 2026-10-27 | Build `.dmg` và `NexGraph.app` bằng `pnpm --filter @nexgraph/desktop run package`; chạy `scripts/smoke-packaged.mjs` trên `.app` đã giải nén | `SMOKE OK nodes=2`; không còn tiến trình engine sau khi thoát; đường dẫn dữ liệu có dấu tiếng Việt (`Đồ án/data`) chạy được. `NexGraph-0.1.0-arm64.dmg` nặng **155 MB** (mục tiêu < 300 MB) |
| macOS: cài từ `.dmg` tải về từ CI, vượt Gatekeeper | **Chưa** | Chưa có CI chạy (chưa có remote GitHub); chưa thử mở app đã tải qua trình duyệt |
| Windows 10/11 (cài `.exe` NSIS, SmartScreen) | **Chưa** | Chưa có máy Windows trong phiên này. Việc của P3: tải `.exe` từ artifact CI, cài, ghi kết quả vào bảng này |
| Windows: kiểm thử `taskkill /T /F` diệt cả cây tiến trình | **Chưa** | Chỉ được kiểm bằng giá trị giả ở macOS |

## Cách vượt cảnh báo (theo tài liệu của từng hệ điều hành, chưa thử trên máy của nhóm)

- **macOS:** chuột phải vào `NexGraph.app`, chọn **Open**, rồi **Open** lần nữa. Nếu app tải qua trình duyệt bị chặn, có thể gỡ thuộc tính cách ly: `xattr -dr com.apple.quarantine /Applications/NexGraph.app`.
- **Windows:** ở cảnh báo SmartScreen chọn **More info**, rồi **Run anyway**.

## Việc còn lại để đóng Task 4

1. Tạo remote GitHub `nexgraph` (công khai), đẩy `main` và mở một PR để CI (`.github/workflows/ci.yml`) chạy trên macOS và Windows. Workflow chưa từng chạy.
2. P3 cài `.exe` trên Windows thật; P1 cài `.dmg` từ artifact CI; cập nhật bảng trên.
3. Bỏ `continue-on-error` của job `graphify-upstream` khi baseline `KNOWN_FAILURES.txt` đã khớp trên Linux.

## Kế hoạch con 2: kiểm tra trên Windows (chưa làm)

Việc của P3 (kế hoạch con 2, Task 13 Step 4): chạy `uv run pytest` trong `engine/` và `pnpm --filter @nexgraph/desktop test`; mở `engine/tests/fixtures/bookstore_app` ở đường dẫn có dấu tiếng Việt và khoảng trắng, lập chỉ mục xong, mở thẻ Graph. Ghi kết quả vào bảng ở đầu tệp. Hai test dùng symlink (`test_symlink_*`) và một test quyền chỉ đọc tự bỏ qua trên Windows. Chưa có kết quả.
