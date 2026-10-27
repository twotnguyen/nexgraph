# Graphify (vendored)

| | |
|---|---|
| Nguồn | https://github.com/Graphify-Labs/graphify |
| Commit | `86c57be8204673c2a1b9849a3292a7dd3ab373d8` |
| Phiên bản | 0.9.92 |
| Ngày commit | 2026-10-16 |
| Giấy phép | Apache-2.0 (`LICENSE`); phần đóng góp trước 2026-07-22 còn theo MIT (`LICENSE-MIT`); xem `NOTICE` |
| Trạng thái khi nhập | Chưa sửa đổi |

Mã nằm ở `engine/src/graphify/` (chép nguyên thư mục `graphify/` của upstream, bỏ `__pycache__`). Test gốc nằm ở `tests/` bên cạnh file này, chép nguyên thư mục `tests/` của upstream.

**Không đồng bộ upstream.** Upstream đổi rất nhanh; theo upstream sẽ phá kế hoạch (ADR 0001).

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
