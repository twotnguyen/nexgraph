# NexGraph

Ứng dụng desktop (macOS + Windows) biến một thư mục mã nguồn thành đồ thị tri thức để khám phá kiến trúc, tìm kiếm, xem vùng ảnh hưởng khi sửa code; có trình soạn thảo tích hợp (F13) và trợ lý AI với hai chế độ Hỏi (chỉ đọc) và Sửa (mỗi thao tác ghi/chạy lệnh phải được người dùng duyệt) (F14). Đồ án chuyên ngành HUTECH, HK1 2026–2027.

> Kết nối mã nguồn. Khám phá tri thức.

**Trạng thái nghiệm thu (2026-11-17):** `main` tại commit `61cc7af` (repo GitHub `twotnguyen/nexgraph`, **private**), đã đẩy kèm các sửa sau review. **488 test engine + 424 test desktop đạt**, typecheck sạch; đã bấm thử trên cửa sổ Electron thật với engine thật và LLM giả. **CI xanh cả sáu job** (engine/desktop/package × macOS/Windows, run `44014209525`), gồm smoke test bản đóng gói trên cả hai hệ điều hành. Đây là bằng chứng build/chạy tự động trên Windows, **chưa phải nghiệm thu Windows trên máy thật của nhóm**. Chưa thử nhà cung cấp AI thật và chưa chạy đủ ba lượt demo.

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
