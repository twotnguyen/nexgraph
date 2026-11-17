# NexGraph

Ứng dụng desktop (macOS + Windows) biến một thư mục mã nguồn thành đồ thị tri thức để khám phá kiến trúc, tìm kiếm, xem vùng ảnh hưởng khi sửa code; có trình soạn thảo tích hợp (F13) và trợ lý AI với hai chế độ Hỏi (chỉ đọc) và Sửa (mỗi thao tác ghi/chạy lệnh phải được người dùng duyệt) (F14). Đồ án chuyên ngành HUTECH, HK1 2026–2027.

> Kết nối mã nguồn. Khám phá tri thức.

**Trạng thái nghiệm thu (2026-11-17):** gốc là `main` commit `0f4dd6f` (repo GitHub `twotnguyen/nexgraph`, **private**), hiện có thêm các sửa sau review **chưa commit/push**. Đã chạy lại: **488 test engine + 424 test desktop đạt**, typecheck sạch; bản DMG macOS đóng gói và smoke test đạt; đã bấm thử trên cửa sổ Electron thật với engine thật và LLM giả. **Chạy được trên macOS; Windows chưa nghiệm thu** (chưa chạy bản cài thật). CI từ xa tại `0f4dd6f` vẫn **ĐỎ** (3 assertion portability của job `desktop (windows-latest)`: `accounts.test.ts:152`, `integrations.test.ts:69,90`) — đã sửa trong working tree, cần push để xác nhận cả sáu job xanh. Chưa thử nhà cung cấp AI thật và chưa chạy đủ ba lượt demo.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `engine/` | Engine phân tích bằng Python 3.12 (FastAPI, SQLite, mã bên thứ ba đã vendor, xem `NOTICE`) |
| `apps/desktop/` | Ứng dụng Electron + React + TypeScript: F13 trình soạn thảo (Monaco), F14 agent Hỏi/Sửa có duyệt, F15 gói tích hợp Codex + skill |
| `docs/` | Spec, kế hoạch, SRS, báo cáo spike |

Thiết kế và kế hoạch trong `docs/superpowers/` là **bản lưu trữ 18/10/2026**; nguồn sự thật hiện hành (có F13–F15) nằm ở workspace cha, xem banner đầu mỗi file.

## Chạy engine (dev)

```bash
cd engine
uv sync
NEXGRAPH_TOKEN=$(python3 -c "print('k'*40)") uv run nexgraph-engine serve --data-dir /tmp/ng --port 0
```

Engine in một dòng JSON `{"event":"ready","port":...,"pid":...}` rồi nghe tại `127.0.0.1`. Mọi route `/v1/*` cần `Authorization: Bearer <token>`.

## Giấy phép

Apache-2.0; repository GitHub ở chế độ private. Xem `LICENSE`, `NOTICE` và `THIRD_PARTY_LICENSES.md`. Các bản sao spec/kế hoạch trong `docs/superpowers/` là bản lưu trữ; nguồn sự thật hiện hành nằm ở workspace cha (xem banner đầu mỗi file).
