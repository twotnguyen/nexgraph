# Graphify (vendored)

| | |
|---|---|
| Nguồn | https://github.com/Graphify-Labs/graphify |
| Commit | `c60eea01cf87dcfb33787808cd534cc7afc5ffff` (1 commit sau tag `v0.9.112`, chỉ nâng phụ thuộc) |
| Phiên bản | 0.9.112 |
| Ngày commit | 2026-11-18 |
| Giấy phép | Apache-2.0 (`LICENSE`); phần đóng góp trước 2026-07-22 còn theo MIT (`LICENSE-MIT`); xem `NOTICE` |
| Trạng thái khi nhập | Chép từ bản clone nghiên cứu `~/Documents/CODE/nexgraph/graphify` ngày 2026-11-20 (W1, ADR 0018). Trước đó: `86c57be`, 0.9.92, nhập 2026-10-27 |
| File đã sửa | `graphify/extract.py`: dòng `AST cache:` in ra stderr thay vì stdout (stdout của engine là kênh giao thức) |

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
