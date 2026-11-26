# Logo NexGraph

> Khẩu hiệu: *"Connecting Code. Revealing Knowledge."* (Kết nối mã nguồn. Khám phá tri thức.)

## 1. Ý tưởng (bản 2026-11-21)

Bốn **nút đồ thị** dạng vòng rỗng nối bằng ba **cạnh** thành chữ **N** (NexGraph, Nexus). Chấm trắng trên cạnh chéo là **nút Nexus**: nơi các quan hệ gặp nhau. Màu chạy theo thứ tự duyệt đồ thị: teal → xanh lam → tím → hồng. Cạnh dừng ở mép vòng nút nên dấu hiệu đặt được trên nền tối lẫn nền sáng.

Bản trước (đến v0.1.2) có bảy nút, hai nút vệ tinh, đường đứt nét và quầng sáng dày. Ở cỡ 16–32 px nó bị nhoè. Bản này bỏ chi tiết thừa, giữ một hình đọc được ở mọi cỡ.

## 2. Màu

| Thành phần | Hex | Gần với token |
|---|---|---|
| Nền biểu tượng (dọc, trên → dưới) | `#2a3480` → `#161c4a` → `#0c1030` | `--night` |
| Nút trái-dưới | `#1fc7b6` | `--teal` |
| Nút trái-trên | `#4a6cff` | `--blue` |
| Nút phải-dưới | `#c04df2` | `--violet` |
| Nút phải-trên | `#ff4fa3` | `--magenta` |
| Nút Nexus | `#ffffff` | |

Các màu sáng hơn token giao diện một bậc để nổi trên nền chàm.

## 3. Tệp

Mọi tệp `nexgraph-app-icon`, `nexgraph-mark`, `nexgraph-logo-dark`, `nexgraph-logo-light` (SVG và PNG) sinh từ **một** script: `scripts/logo/build_logo.py` ở gốc workspace. Sửa hình thì sửa script rồi chạy lại, không sửa tay SVG. Chữ trong bản phối ngang đã đổi thành đường vẽ từ font Be Vietnam Pro, nên SVG không cần font cài trên máy.

| Tệp | Cỡ | Dùng cho |
|---|---|---|
| `nexgraph-app-icon.svg` / `.png` | 1024×1024 | Biểu tượng app. Script chép PNG vào `apps/desktop/build/icon.png` cho electron-builder (`.icns`, `.ico`). |
| `nexgraph-mark.svg` / `.png` | 500×552, nền trong suốt | Favicon, avatar repo, slide, watermark |
| `nexgraph-logo-dark.svg` / `.png` | 840×220 (PNG 2×) | README, slide nền tối |
| `nexgraph-logo-light.svg` / `.png` | 840×220 (PNG 2×) | Bìa báo cáo Word/PDF, tài liệu in |

Logo nhỏ trong app (thanh trên cùng, tên dự án) là component `Logo` ở `apps/desktop/src/renderer/src/shared/ui/icons.tsx`: cùng hình, vẽ trên lưới 24 px.

Ảnh `nexgraph-3d-icon`, `-prism-`, `-hypercube-`, `-minimal-`, `-dag-logo` (`.png`, `.webp`) là các bản khám phá cũ do mô hình sinh ảnh tạo theo ý tưởng trước. Chúng không còn là logo chính thức.
