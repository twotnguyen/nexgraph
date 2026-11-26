# Graphify (vendored)

| | |
|---|---|
| Nguồn | https://github.com/Graphify-Labs/graphify |
| Commit | `16127eb30892f997d758efdd894e5e04264edbbb` (tag `v0.9.120`) |
| Phiên bản | 0.9.120 — **đóng băng đến hết bảo vệ đồ án (ADR 0026)** |
| Ngày commit | 2026-11-25 |
| Giấy phép | Apache-2.0 (`LICENSE`); phần đóng góp trước 2026-07-22 còn theo MIT (`LICENSE-MIT`); xem `NOTICE` |
| Trạng thái khi nhập | Chép thư mục `graphify/` và `tests/` từ tag `v0.9.120` ngày 2026-11-26 (ADR 0026). Trước đó: `c60eea0` (0.9.112, nhập 2026-11-20, W1, ADR 0018); `86c57be` (0.9.92, nhập 2026-10-27) |
| File đã sửa | `graphify/extract.py`: dòng `AST cache:` in ra stderr thay vì stdout (stdout của engine là kênh giao thức) |

Mã nằm ở `engine/src/graphify/` (chép nguyên thư mục `graphify/` của upstream, bỏ `__pycache__`). Test gốc nằm ở `tests/` bên cạnh file này, chép nguyên thư mục `tests/` của upstream.

**Không đồng bộ upstream.** Upstream đổi rất nhanh; theo upstream sẽ phá kế hoạch (ADR 0001). Từ ADR 0026 bản này **đóng băng** ở 0.9.120: chỉ backport bản vá bảo mật (GitHub Security Advisories của repo upstream), mỗi tệp backport đánh dấu như mục dưới và ghi vào bảng trên.

## Quy ước khi sửa

File nào trong `engine/src/graphify/` bị sửa phải có dòng đầu tiên:

```python
# Modified by NexGraph contributors, 2026
```

(Apache-2.0 §4b). Cập nhật bảng "Trạng thái khi nhập" thành danh sách file đã sửa khi có thay đổi đầu tiên.

## Chạy test gốc

```bash
cd engine/third_party/graphify
PYTHONPATH=. uv run --project ../.. pytest tests -q -p conftest_known
```

Test hỏng sẵn ở upstream trong môi trường này (thiếu extras tuỳ chọn, cần mạng) ghi trong `KNOWN_FAILURES.txt`.
