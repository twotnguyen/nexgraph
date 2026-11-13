# Kết quả kiểm tự động và chốt nền H0

**Ngày thực hiện:** 2026-11-13  
**Môi trường:** macOS 15.7 (Darwin 24.6.0 arm64, Apple Silicon)  
**Commit gốc:** `32f38c6` trên nhánh `main`

---

## 1. Test tự động

- **Engine (Python 3.12, uv, pytest):**
  - `uv run pytest tests -q`
  - Kết quả: **387 passed, 4 warnings** trong 21.23 s.
- **Desktop (Electron 44, React 19, Vitest):**
  - `pnpm --filter @nexgraph/desktop test`
  - Kết quả: **181 passed** (27 test files) trong 2.91 s.
  - `pnpm --filter @nexgraph/desktop typecheck`
  - Kết quả: Hoàn thành không có lỗi TypeCheck (`tsc --noEmit`).
- **Đóng gói (PyInstaller + Electron Builder):**
  - PyInstaller build: `engine/dist/nexgraph-engine` (227 MB uncompressed).
  - Electron Builder: `apps/desktop/dist/mac-arm64/NexGraph.app` (567 MB uncompressed).
  - Smoke test: `node scripts/smoke-packaged.mjs` → **SMOKE OK nodes=2**.

---

## 2. CI và Windows

- **Trạng thái GitHub Actions của commit `32f38c6` (Run ID: `43363591920`):**
  - `desktop (macos-latest)`: **Success** (1m1s)
  - `engine (macos-latest)`: **Success** (1m53s)
  - `desktop (windows-latest)`: **Success** (1m43s)
  - `engine (windows-latest)`: **Failed** (9m37s) với 3 test:
    1. `test_concurrent_refresh_second_is_skipped`: Timeout chờ event luồng trong 5s trên runner Windows tải cao.
    2. `test_no_git_flow_and_reindex_clears_changes`: Lock DB chưa kịp nhả sau khi index job báo done dẫn tới refresh bị skip.
    3. `test_recluster_route`: HTTP 409 Conflict do lock chưa kịp nhả khi job index báo hoàn tất.
  - `package`: Bị huỷ do job engine Windows không đạt.
- **Khắc phục đã thực hiện:**
  - Sửa `jobs.py`: Đảm bảo `conn.close()` và `lock.release()` thực thi xong trước khi bắn sự kiện hoàn tất (`done`/`cancelled`).
  - Nới lỏng thời gian chờ `wait(15)` trong `test_api_changes.py` để tránh timeout do runner Windows chậm.
  - Các test liên quan đã chạy lại cục bộ và pass 100%.

### Việc cho P3 trên máy Windows thật
- Tải file thực thi / gói cài đặt từ GitHub Actions artifact hoặc build trực tiếp bằng `pnpm package`.
- Mở và chạy các bước kiểm tra chức năng F1–F10 trên môi trường Windows native với đường dẫn có dấu tiếng Việt (`D:\Đồ án\demo`).
- Ghi nhận lỗi đặc thù hệ điều hành (nếu có liên quan đến đường dẫn backslash `\` hoặc handle file SQLite).

---

## 3. Số liệu dự án F1–F10 — chưa có bằng chứng kiểm tay

Đính chính sau rà soát: các số dưới đây là kết quả engine trên bản sao `ecommerce-backend-nestjs` tại `/tmp/Đồ án/nestjs demo`, không chứng minh đã thao tác trên cửa sổ Electron. Các nhận xét giao diện trước đây chưa có ảnh hay biên bản thao tác; không dùng để đóng nghiệm thu.

- **Mở và index:**
  - Phát hiện 268 tệp (266 TypeScript, 2 JavaScript).
  - Tạo 1.190 nút (279 class, 116 directory, 268 file, 20 function, 506 method, 1 repository).
  - Tạo 2.122 cạnh (75 CALLS, 384 CONTAINS, 805 DEFINES, 858 IMPORTS).
  - Thời gian index: ~2.85 s.
  - Ghi nhận cảnh báo các file `.spec.ts` không sinh symbol do vendor extractor chỉ trích xuất callable (được xử lý ở H1).
- **Chưa kiểm chứng trên Electron tại H0:** hiển thị Tổng quan, gom cụm kiến trúc, cây thư mục, popover bằng chứng và thao tác xuất dữ liệu. Các chức năng có implementation/test không đồng nghĩa đã kiểm tay.
- **Số nền cho tầng L (`hermes-agent`):**
  - Dữ liệu từ `graph-fix.db`: 17.260 tệp, 215.015 nút, 599.653 cạnh.
  - Thời gian tải truy vấn kiểm chứng đạt ngưỡng kỳ vọng cho bộ dữ liệu lớn.
