# NexGraph

NexGraph là ứng dụng desktop cho Windows và macOS dùng để lập chỉ mục thư mục mã nguồn cục bộ, khám phá kiến trúc, tìm ký hiệu và xem vùng ảnh hưởng khi sửa mã. Đề tài ưu tiên **TypeScript/JavaScript và Python**. Đồ thị dẫn đến vị trí mã nguồn, hỗ trợ truy vết luồng thực thi và cung cấp ngữ cảnh cho trợ lý AI qua MCP.

Ứng dụng có trình soạn thảo tích hợp và hai chế độ trợ lý. **Hỏi** chỉ đọc. **Sửa** cho xem diff và yêu cầu duyệt từng đề xuất tạo, sửa hoặc ghi đè tệp. Cả hai chế độ từ chối lời gọi công cụ chạy lệnh shell. Các chức năng đồ thị cục bộ hoạt động khi chưa cấu hình AI.

## Bắt đầu

Cần Git, Node.js 22.19.0 trở lên (khuyến nghị Node.js 24), pnpm `11.24.0` và uv trong `PATH`. Với checkout mới, chạy từ thư mục gốc repo.

```sh
git clone https://github.com/twotnguyen/nexgraph.git
cd nexgraph
pnpm run setup:dev
pnpm dev
```

Nếu đã clone repo, sau khi nhóm hợp nhất thay đổi, chạy `git pull --ff-only` từ nhánh `main`, rồi chạy lại `pnpm run setup:dev` và `pnpm dev`. Kho riêng tư cần tài khoản GitHub có quyền đọc.

Mở thư mục mã nguồn trong cửa sổ NexGraph. Dự án nhỏ được quét và lập chỉ mục tự động. Khi hoàn tất, bấm **Bắt đầu khám phá**. Cây tệp nằm bên trái, các thẻ mã nguồn và sơ đồ ở giữa, trợ lý AI ở bên phải. Mở dự án gần đây đã có chỉ mục sẽ vào thẳng không gian làm việc. Nút **← Tổng quan** mở thống kê, tùy chọn lập chỉ mục, Git hook và tích hợp MCP.

- [Bản bàn giao Electron/Monaco 0.1.0, cách cài và ảnh giao diện](docs/release/README.md)
- [Cài đặt và chạy từ mã nguồn trên Windows/macOS](docs/install-notes.md)
- [Demo nhanh với mẫu Python và kịch bản bảo vệ trên NestJS](docs/demo-script.md)
- [Danh sách kiểm trên Windows](docs/windows-checklist.md)

**NexGraph 0.1.0 Electron/Monaco** là bản dùng để bàn giao và bảo vệ. Bộ cài có engine đi kèm. Lệnh `pnpm dev` khởi động cùng giao diện và chạy engine từ mã nguồn. Tích hợp **Code-OSS** là bản thử nghiệm, dùng chung engine và có quy trình build riêng. [Quy trình build Code-OSS](apps/shell/README.md)

## Đặc tả và trạng thái

- [Đặc tả hiện hành](docs/srs/SRS.md) ghi phạm vi và tiêu chí nghiệm thu.
- [Ma trận truy vết F1–F15](docs/srs/traceability.md) liên kết yêu cầu với use case, thao tác, kiểm thử và bằng chứng.
- [Kiến trúc và luồng xử lý](docs/srs/architecture.md), [ERD và lưu trữ hiện hành](docs/srs/data-model.md).
- Các tài liệu trong [`docs/superpowers/`](docs/superpowers/) ghi lại lịch sử thiết kế và kế hoạch theo tuần.

CI chạy setup từ checkout sạch rồi kiểm trên Windows và macOS. Job đóng gói mở ứng dụng từ chính bộ cài sẽ tải lên, lập chỉ mục dự án mẫu bằng engine đi kèm và kiểm đọc, ghi tệp cùng trợ lý giả lập. Biên bản nghiệm thu ghi riêng lần cài và chạy trên máy đích. [Workflow](.github/workflows/ci.yml) · [Biên bản thử editor và agent](docs/benchmarks/2026-11-15-editor-agent.md)

## Cấu trúc repo

| Đường dẫn | Vai trò |
|---|---|
| [`engine/`](engine/) | Python 3.12, FastAPI, SQLite, lập chỉ mục, truy vấn đồ thị và MCP |
| [`apps/desktop/`](apps/desktop/) | Electron, React, Monaco, editor và trợ lý AI |
| [`apps/extension/`](apps/extension/) | Adapter Code-OSS, webview đồ thị và tích hợp editor của workbench |
| [`apps/shell/`](apps/shell/) | Cấu hình, patch và quy trình build Code-OSS theo commit ghim |
| [`docs/`](docs/) | Đặc tả, use case, sơ đồ, tài liệu chạy và biên bản kiểm thử |

## Giấy phép

Apache-2.0. Xem [LICENSE](LICENSE), [NOTICE](NOTICE) và [thông tin mã bên thứ ba](THIRD_PARTY_LICENSES.md).
