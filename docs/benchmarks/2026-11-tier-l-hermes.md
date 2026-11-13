# Đánh giá hiệu năng và độ đúng tầng L (hermes-agent) — H1

**Ngày đo:** 2026-11-13  
**Môi trường:** Apple M-series (Darwin 24.6.0 arm64, macOS 15.7), Python 3.12.16  
**Dự án:** `hermes-agent` (17.260 tệp nguồn)

---

## 1. Kết quả đo tổng hợp

| Chỉ số | Mục tiêu H1 | Trước H1 (2026-11-13) | Sau H1 (đo thực tế) | Đánh giá |
|---|---|---|---|---|
| **Thời gian index đầy đủ** | ≤ 300 s (5 phút) | 569 s (~9,5 phút) | **129,39 s** (~2,1 phút) | **Đạt** (nhanh hơn 4,4×) |
| — Giai đoạn 1 (cấu trúc) | — | ~480 s | 107,85 s (8 tiến trình) | Song song hoá `ProcessPoolExecutor` |
| — Giai đoạn 2 (phân giải) | — | ~89 s | 21,53 s | Bỏ ref import TS rỗng |
| **RAM đỉnh khi index** | ≤ 1.500 MB (1,5 GB) | 1.990 MB (~1,99 GB) | **939 MB** | **Đạt** (giảm 52,8%) |
| **Kích thước graph.db** | — | 290 MB | **290,9 MB** | Ổn định |
| **Thời gian mở lại (read-only)** | < 1.000 ms | ~400 ms | **272 ms** | Rất nhanh |
| **Số tiến trình trích xuất** | `min(cpu-1, 8)` | 1 (tuần tự) | **8** tiến trình | Đạt chính sách |

---

## 2. Thống kê quy mô đồ thị hermes-agent

- **Số tệp:** 17.260 (Python: 11.325, TypeScript: 5.594, JavaScript: 339, C#: 2).
- **Số nút:** 215.015 (`function`: 128.403, `method`: 48.221, `class`: 20.455, `file`: 17.260, `directory`: 675, `repository`: 1).
- **Số cạnh:** 693.124:
  - `CALLS`: 364.592 (tăng từ 144.440 trước H1 nhờ giữ lời gọi mức tệp và bảng kiểu DI).
  - `TESTED_BY`: 62.321 (tăng từ **0** trước H1).
  - `DEFINES`: 197.060.
  - `IMPORTS`: 51.216.
  - `CONTAINS`: 17.935.
- **Tham chiếu chưa phân giải:** 840.092.

---

## 3. Đo lập chỉ mục tăng dần (Refresh)

Đo trên NestJS demo (230 tệp mã) và áp dụng cơ chế lọc `requeue_failed_refs`:

| Kịch bản refresh | Kết quả | Mục tiêu |
|---|---|---|
| **Không đổi (idle)** | 8 ms | < 50 ms |
| **Sửa 1 tệp** | Trung vị **36 ms**, tối đa 71 ms | < 2.000 ms (< 2 s) |
| **Sửa 50 tệp** | Trung vị **569 ms**, tối đa 576 ms | < 2.000 ms |
| **Thêm 1 tệp** | **26 ms** | < 1.000 ms |
| **Xoá 1 tệp** | **22 ms** | < 1.000 ms |
| **Phân tích thay đổi + vùng ảnh hưởng** | **67 ms** | < 200 ms |
| **Tăng dần = Đầy đủ** | `test_incremental_equals_full_index` PASS | 100% khớp |

Cải tiến then chốt: `requeue_failed_refs(tails=new_labels, imports=bool(added))` chỉ đưa các tham chiếu có đuôi tên khớp với symbol mới xuất hiện vào hàng đợi phân giải, tránh duyệt lại toàn bộ ~840.000 tham chiếu thất bại mỗi lần sửa một tệp.

---

## 4. Kiểm chứng tính đúng đắn trên TypeScript (NestJS demo)

- Kiểm tra ngẫu nhiên 5 cạnh `CALLS` từ resolver: **5/5 đúng** (lời gọi qua constructor injection và import module).
- Kiểm tra ngẫu nhiên 5 cạnh `TESTED_BY`: **5/5 đúng** (từ các file `.spec.ts` tới các service/class được test).
- Tỉ lệ chính xác mẫu kiểm: **10/10 (100%)** (vượt yêu cầu ≥ 9/10).
