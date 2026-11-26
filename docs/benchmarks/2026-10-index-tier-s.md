# Đo lập chỉ mục, tầng S (kế hoạch con 2)

Ngày đo: 2026-10-27. Công cụ: `tools/bench/bench_index.py <thư-mục> --repeat 2`. Số liệu chỉ là **một lần chạy trên một máy**, chưa lặp nhiều lần, chưa có Windows.

## Máy và cấu hình

| | |
|---|---|
| Máy | Apple M3 Pro, 18 GB RAM, macOS (Darwin 24.6), ổ SSD |
| Python | 3.12.16 (uv), `tree-sitter` 0.25.2, `tree-sitter-dart` 0.1.0, SQLite 3.53.1 |
| Chế độ | Lập chỉ mục đầy đủ (chưa có cache theo mã băm), parse tuần tự một tiến trình, đồ thị ghi ở thư mục tạm |
| Đo | Thời gian trong tiến trình engine; **không** gồm giao diện Electron, khởi động engine hay vẽ đồ thị |

## Kết quả

Corpus: một project Flutter cá nhân và một bộ mã mẫu công khai (đa ngôn ngữ), ghim commit khi đo.

| Project | Tệp | Nút | Cạnh | Giai đoạn 1 | Giai đoạn 2 | Tổng | RAM đỉnh | `graph.db` | Mở lại (chỉ đọc + thống kê) |
|---|---|---|---|---|---|---|---|---|---|
| Project Flutter cá nhân | 98 | 649 | 1.478 | 0,29 s | 0,04 s | 0,33 s | 72 MB | 1,0 MB | 1 ms |
| App mẫu công khai (1 app) | 150 | 797 | 1.796 | 0,24 s | 0,03 s | 0,27 s | 73 MB | 0,9 MB | 1 ms |
| toàn bộ bộ mã mẫu công khai (đa ngôn ngữ: 419 Dart, 5 TS, 3 JS, 1 Python) | 428 | 4.320 | 6.781 | 1,16 s | 0,12 s | 1,28 s | 140 MB | 3,8 MB | 2 ms |

Lần chạy thứ hai ngay sau đó cho thời gian tương đương (0,31 s, 0,19 s, 1,18 s), tức chưa có lợi ích cache vì chưa làm cache.

## So với mục tiêu tầng S (spec §6.1)

| Mục tiêu | Kết quả | Nhận xét |
|---|---|---|
| Lập chỉ mục lần đầu < 60 s với ≤ 1.000 tệp | 1,28 s với 428 tệp | Đạt với khoảng dư rất lớn **ở phần engine**. Chưa đo project gần 1.000 tệp, chưa đo qua giao diện |
| Mở lại < 3 s | 2 ms ở mức CSDL | Chưa đo mở lại end-to-end trong ứng dụng (khởi động engine ~vài giây theo bản đóng gói, vẽ đồ thị) |

Không đo tầng L (5.000–15.000 tệp); để tuần 8.

## Nhận xét

- Thời gian nằm gần như hết ở giai đoạn 1 (parse Tree-sitter, ghi SQLite); giai đoạn 2 chiếm khoảng 10%.
- **Tham chiếu chưa phân giải rất nhiều** (3.568 / 1.937 / 10.248): phần lớn là lời gọi API Flutter/Dart và gói ngoài (`Text`, `Scaffold`, `package:flutter/...`), đúng nguyên tắc không đoán. Cần phân tích theo nhóm trước khi nói về độ chính xác; việc này thuộc chương đánh giá (nhãn tay), chưa làm.
- Tệp TypeScript/JavaScript/Python đi qua bộ chuyển đổi đa ngôn ngữ nên chỉ có đồ thị chung (xem kế hoạch con 2). Bộ trích xuất in cảnh báo "yielded no symbols" cho vài tệp `.spec.ts` rỗng; không ảnh hưởng kết quả.
- RAM đỉnh 140 MB ở 428 tệp là của cả tiến trình đo (gồm bộ trích xuất đa ngôn ngữ và các grammar nạp sẵn), không phải mức tăng theo kích thước project.
