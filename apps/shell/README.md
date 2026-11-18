# Bảo trì và chạy thử Code-OSS

Lớp phủ này dùng để phát triển và thử nghiệm tích hợp NexGraph với Code-OSS (MIT). Bản phát hành **NexGraph 0.1.0** dùng Electron độc lập cùng editor Monaco. Xem [hướng dẫn phát hành 0.1.0](../../docs/release/README.md) để lấy và kiểm bộ cài.

| Tệp | Nội dung |
| --- | --- |
| `upstream.json` | Commit Code-OSS được ghim và phiên bản Node/pnpm mà nền yêu cầu |
| `product.overrides.json` | Tên, ID, thư mục dữ liệu và kho extension Open VSX trong `product.json` |
| `patches/` | Bản vá giao diện và danh sách extension của nền |
| `overlay/` | Icon, hình nền vùng editor trống và font Be Vietnam Pro |
| `build.mjs` | Lấy nền, áp bản vá, chép overlay, gắn extension NexGraph và dựng ứng dụng |

## Dựng bản thử

Dùng đúng phiên bản Node trong `upstream.json` và pnpm theo từng workspace. Windows cần Visual Studio Build Tools với C++. Từ gốc repo, cài phụ thuộc NexGraph và chọn một lệnh dựng phù hợp.

```sh
pnpm install --frozen-lockfile
node apps/shell/build.mjs --dev
```

Sau khi build dev, đặt `NEXGRAPH_REPO_ROOT` trỏ tới gốc repo rồi chạy `apps/shell/.upstream/scripts/code.bat` (Windows) hoặc `apps/shell/.upstream/scripts/code.sh` (macOS) với thư mục dự án cần mở. Extension gọi engine qua `uv` khi không có engine đóng gói. Xem [chuẩn bị uv và Python 3.12](../../docs/install-notes.md#chạy-electron-từ-checkout-sạch).

Chạy `node apps/shell/build.mjs` để tạo thư mục ứng dụng thử trong `apps/shell/VSCode-<hệ điều hành>-<kiến trúc>/`. Để kèm engine, chạy bước PyInstaller trong [hướng dẫn dựng engine](../../docs/install-notes.md#đóng-gói-electron) để tạo `engine/dist/nexgraph-engine` trước. Dùng `--src <đường dẫn>` nếu muốn lấy commit ghim từ bản clone upstream đã có. Ghi bằng chứng build và smoke riêng theo từng hệ điều hành.

## Nâng phiên bản Code-OSS

Đổi `commit` trong `upstream.json`, xóa checkout dựng `apps/shell/.upstream/` và chạy lại `build.mjs`. Rà soát bản vá nào không còn áp được trên commit mới.
