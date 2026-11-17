# NexGraph

NexGraph là ứng dụng desktop cho Windows và macOS dùng để lập chỉ mục thư mục mã nguồn cục bộ, khám phá kiến trúc, tìm ký hiệu và xem vùng ảnh hưởng khi sửa mã. Đề tài ưu tiên **TypeScript/JavaScript và Python**. Đồ thị dẫn đến vị trí mã nguồn, hỗ trợ truy vết luồng thực thi và cung cấp ngữ cảnh cho trợ lý AI qua MCP.

Ứng dụng có trình soạn thảo tích hợp và hai chế độ trợ lý. **Hỏi** chỉ đọc. **Sửa** yêu cầu người dùng duyệt từng thao tác ghi tệp hoặc chạy lệnh. Các chức năng đồ thị cục bộ hoạt động khi chưa cấu hình AI.

## Bắt đầu

- [Cài đặt và chạy từ mã nguồn trên Windows/macOS](docs/install-notes.md)
- [Demo nhanh với mẫu Python và kịch bản bảo vệ trên NestJS](docs/demo-script.md)
- [Danh sách kiểm trên Windows](docs/windows-checklist.md)

Lệnh `pnpm dev` khởi động bản **Electron/Monaco** và tự chạy engine Python. Bản **Code-OSS** có quy trình build riêng và dùng editor của workbench. Hai bản dùng chung engine. Phiên bản bàn giao chính sẽ được xác nhận khi chốt quy trình phát hành. [Quy trình build Code-OSS](apps/shell/README.md)

## Đặc tả và trạng thái

- [Đặc tả hiện hành](docs/srs/SRS.md) ghi phạm vi và tiêu chí nghiệm thu.
- [Ma trận truy vết F1–F15](docs/srs/traceability.md) liên kết yêu cầu với use case, thao tác, kiểm thử và bằng chứng.
- [Kiến trúc và luồng xử lý](docs/srs/architecture.md), [ERD và lưu trữ hiện hành](docs/srs/data-model.md).
- Các tài liệu trong [`docs/superpowers/`](docs/superpowers/) ghi lại lịch sử thiết kế và kế hoạch theo tuần.

Tại `6687fc9`, sáu job engine, desktop và đóng gói trên Windows/macOS đã qua cho đường chạy Electron. Nhóm cũng đã thử editor và agent trên bản Electron với engine thật và mô hình AI giả lập. Biên bản nghiệm thu cần ghi riêng kết quả trên máy thật, nhà cung cấp AI thật và đúng bản cài được chọn để bàn giao. [CI tại `6687fc9`](https://github.com/twotnguyen/nexgraph/actions/runs/44065280698) · [Workflow hiện tại](.github/workflows/ci.yml) · [Biên bản thử editor và agent](docs/benchmarks/2026-11-15-editor-agent.md)

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
