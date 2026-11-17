# apps/shell — lớp phủ NexGraph lên nền Code-OSS

NexGraph chạy trên nền Code-OSS (MIT). Repo này **không** giữ một bản fork đầy đủ; thư mục này chỉ chứa phần nhóm thay đổi so với nền:

| Tệp | Nội dung |
|---|---|
| `upstream.json` | Commit nền được ghim và phiên bản Node/pnpm nền yêu cầu |
| `product.overrides.json` | Các khoá `product.json` bị đổi: tên, id, thư mục dữ liệu, kho extension Open VSX |
| `patches/` | Bản vá vào lõi: font giao diện, danh sách extension không đóng gói |
| `overlay/` | Tệp chép đè: icon, logo nền vùng editor trống, font Be Vietnam Pro |
| `build.mjs` | Lấy nền → áp bản vá → chép đè → gắn extension (`apps/extension`) và engine → build |

## Dùng

Cần Node đúng phiên bản trong `upstream.json` và pnpm. Trên Windows cần thêm Visual Studio Build Tools (C++).

```sh
node apps/shell/build.mjs --dev    # biên dịch để chạy thử
node apps/shell/build.mjs          # đóng gói app (kết quả ở apps/shell/VSCode-<hệ điều hành>-<kiến trúc>/)
```

Thêm `--src <đường dẫn>` để lấy nền từ một bản clone có sẵn thay vì tải từ mạng.

Bản đóng gói chỉ có engine kèm theo khi đã chạy PyInstaller (`engine/dist/nexgraph-engine`). Lúc chạy thử chưa có engine đóng gói, đặt `NEXGRAPH_REPO_ROOT` trỏ tới gốc repo để extension chạy engine bằng `uv`.

## Nâng phiên bản nền

Đổi `commit` trong `upstream.json`, xoá `.upstream/`, chạy lại `build.mjs`. Bản vá nào không áp được thì sửa bản vá đó.
