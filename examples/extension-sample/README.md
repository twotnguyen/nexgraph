# Extension mẫu của NexGraph

Cài: Cài đặt › Extension › **Cài từ thư mục…**, chọn thư mục này. NexGraph kiểm `extension.json` rồi chép thư mục vào thư mục dữ liệu của app.

`extension.json` gồm:

- `id`: chữ thường, số, gạch nối (2–41 ký tự); `name`, `version`, `description`.
- `contributes.themes[]`: `id`, `name`, `appearance` (`light` hoặc `dark`), `colors` là các biến màu của NexGraph (`--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-border` bắt buộc; thêm `--blue`, `--syntax-keyword`…) với giá trị mã hex.
- `contributes.commands[]`: `id`, `title`, `action` là một trong hai:
  - `{ "type": "insertText", "text": "…" }`: chèn văn bản tại con trỏ của tệp đang mở.
  - `{ "type": "runCommands", "commands": ["explorer.toggle", …] }`: chạy lần lượt các lệnh có sẵn của app (mã lệnh xem ở Cài đặt › Phím tắt).

Extension không chạy mã trong app. Lệnh hiện trong bảng lệnh (⌘⇧P) và gán phím được ở trang Phím tắt; theme hiện trong hộp chọn theme (⌘K ⌘T).
