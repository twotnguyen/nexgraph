# Spike sigma cho thẻ Bản đồ (H3, Task 3)

**Ngày:** 2026-11-13 · **Máy:** MacBook Apple Silicon, macOS 15.7, Chromium (Chrome) có WebGL.
**Dữ liệu:** `build_map` thật trên CSDL hermes-agent (17.260 tệp, 215.015 nút): `detail=400` → 400 nút / 3.239 cạnh; `detail=1500` → 1.500 nút / 5.000 cạnh (cắt).

## Cách đo
Trang HTML tối giản (vite build, sigma 3.0.3 + graphology 0.26 + ForceAtlas2 0.10) nạp JSON của `/map`, dựng đồ thị với vị trí khởi tạo trên vòng tròn theo cụm, chạy ForceAtlas2, tạo Sigma, đo tới hai `requestAnimationFrame` đầu, rồi 60 khung kéo/phóng camera. Chạy trong Chrome thật qua DevTools (cùng Chromium với Electron), **không chạy trong Electron**.

| detail | vòng FA2 | bố cục | khung đầu | từ nạp dữ liệu tới khung đầu | khung kéo/phóng (trung vị / p95) |
|---|---|---|---|---|---|
| 400 | 100 | 67 ms | 588 ms (gồm khởi tạo WebGL) | 670 ms | 16,6 / 16,9 ms |
| 1.500 | 100 | 579 ms | 27 ms | 618 ms | 16,7 / 18,5 ms |
| 1.500 | 60 | 353 ms | 23 ms | 387 ms | 16,7 / 16,9 ms |

## Quyết định
- Khung đầu < 5 s (< 1 s), kéo/phóng 60 fps cả ở 1.500 nút → **dùng sigma**, `detail=400` mặc định, `FA2_ITERATIONS = 100`. Không cần phương án lùi React Flow.
- sigma ghim `^3` (kế hoạch ghi `^3`): bản 4.x có API khác (cấu hình nằm trong `settings`, kiểu dáng khai báo), không dùng.
- sigma đọc `WebGL2RenderingContext` ngay khi import nên `SigmaView` nạp nó bằng `import()` động: jsdom và máy không có WebGL rơi vào nhánh `onUnsupported` (câu `noWebgl`) thay vì làm sập cả màn hình; sigma nằm ở chunk riêng 161 kB.

## Chưa kiểm
- Chạy trong cửa sổ Electron thật và bản đóng gói `file://` (build renderer thành công, chunk sigma được tạo; chưa mở được).
- Máy Windows / không có GPU.
