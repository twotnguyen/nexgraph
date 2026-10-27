# Mockup giao diện NexGraph

Mockup HTML tĩnh, bấm thử được, không framework. Mở `index.html` bằng trình duyệt (cần mạng để tải font Be Vietnam Pro và JetBrains Mono từ Google Fonts; không có mạng thì dùng font hệ thống).

| Tệp | Màn hình |
|---|---|
| `projects.html` | Dự án |
| `indexing.html` | Đang lập chỉ mục |
| `workspace.html` | Không gian làm việc |
| `settings.html` | Cài đặt |

`workspace.html` nhận trạng thái qua hash URL:

| Tham số | Giá trị | Mặc định |
|---|---|---|
| `view` | `arch` · `graph` · `flutter` · `code` | `arch` |
| `side` | `explorer` · `search` · `changes` · `tour` | `explorer` |
| `chat` | `0` ẩn khung chat | hiện |
| `insp` | `0` ẩn inspector ở thẻ Graph | hiện |

Dữ liệu giả: app Flutter `bookstore_app` (128 tệp Dart, 412 nút, 1.036 cạnh). Design token nằm ở `shared.css`. Quy tắc thiết kế: spec §5.9.

## Quyết định

Bố cục, hành vi và token đã chốt với người dùng (P1) trong tuần 1 và đã đưa vào báo cáo tuần 1:

- Bố cục kiểu VS Code: activity bar (Explorer, Search, Changes, Tour), vùng giữa có thẻ Kiến trúc / Graph / Flutter / tệp mã, chat AI ở cột phải, thu gọn bằng `Ctrl/Cmd+L`, inspector nổi khi chọn nút.
- Mũi tên kiến trúc chỉ vẽ khi có cạnh thật; chip trích dẫn dạng `path:start–end`, trích dẫn không hợp lệ bị gạch và gắn nhãn "chưa xác minh".
- Màu chỉ mang ý nghĩa (xem bảng token trong `docs/project/giao-dien.md` của workspace đồ án).

**Trạng thái duyệt:** P1 đã duyệt. **Chưa có xác nhận của P2 và P3.** Khi nhóm đi lại kịch bản demo (spec §1.2, bước 1–4) trên mockup, ghi dòng `Đã duyệt: <ngày>, P1/P2/P3` bên dưới và liệt kê thay đổi được chốt.

Đã duyệt: _chưa đủ ba người_
