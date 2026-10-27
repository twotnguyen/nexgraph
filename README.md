# NexGraph

Ứng dụng desktop (macOS + Windows) biến một thư mục mã nguồn thành đồ thị tri thức để khám phá kiến trúc, tìm kiếm, xem vùng ảnh hưởng khi sửa code và hỏi đáp với trợ lý AI chỉ đọc. Đồ án chuyên ngành HUTECH, HK1 2026–2027.

> Kết nối mã nguồn. Khám phá tri thức.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `engine/` | Engine phân tích bằng Python 3.12 (FastAPI, SQLite, mã bên thứ ba đã vendor, xem `NOTICE`) |
| `apps/desktop/` | Ứng dụng Electron + React + TypeScript (chưa tạo) |
| `docs/` | Spec, kế hoạch, SRS, báo cáo spike |

Thiết kế: `docs/superpowers/specs/2026-10-18-nexgraph-desktop-design.md`. Kế hoạch: `docs/superpowers/plans/`.

## Chạy engine (dev)

```bash
cd engine
uv sync
NEXGRAPH_TOKEN=$(python3 -c "print('k'*40)") uv run nexgraph-engine serve --data-dir /tmp/ng --port 0
```

Engine in một dòng JSON `{"event":"ready","port":...,"pid":...}` rồi nghe tại `127.0.0.1`. Mọi route `/v1/*` cần `Authorization: Bearer <token>`.

## Giấy phép

Apache-2.0. Xem `LICENSE` và `NOTICE`.
