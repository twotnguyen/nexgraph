# Đo tìm kiếm và bản đồ kiến trúc (kế hoạch con 3)

Ngày đo: 2026-10-27. Công cụ: `engine/scripts/bench_search_arch.py` (thêm `--synthetic N` để sinh dự án giả). Số liệu là **một lần chạy trên một máy**, chưa lặp nhiều lần, **chưa có Windows**.

## Máy và cấu hình

| | |
|---|---|
| Máy | Apple M3 Pro, 18 GB RAM, macOS (Darwin 24.6), SSD |
| Phần mềm | Python 3.12.16, `tree-sitter-dart` 0.1.0, SQLite 3.53.1, `networkx` 3.7 (Louvain, `seed=42`) |
| Chế độ | Lập chỉ mục đầy đủ (chưa có cache), parse tuần tự, đồ thị ghi ở thư mục tạm |
| Đo | Thời gian trong tiến trình engine; không gồm khởi động engine, giao diện, vẽ đồ thị |
| Tìm kiếm | 10 truy vấn cố định + 10 nhãn lấy ngẫu nhiên từ dữ liệu, mỗi truy vấn 5 lần, `limit=30` |
| Kiến trúc | Đi hết cây khối đến độ sâu 6 (tối đa 400 màn), lấy mẫu 3 mũi tên mỗi màn để đối chiếu bằng chứng |

## Kết quả

| Project | Tệp | Nút | Cạnh | Cộng đồng | Lập chỉ mục (gồm FTS5 + cộng đồng) | Tìm kiếm p50 / p95 | Màn gốc kiến trúc | Màn chậm nhất | Số màn đã duyệt | Khối tối đa/màn | `graph.db` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Project Flutter cá nhân | 98 | 649 | 1.478 | 7 | 0,39 s | 0,1 / 0,8 ms | 1,3 ms (2 khối, 1 mũi tên) | 1,4 ms | 16 | 12 | 1,0 MB |
| App mẫu công khai (1 app) | 150 | 797 | 1.796 | 8 | 0,24 s | 0,2 / 0,5 ms | 1,8 ms (2 khối, 0 mũi tên) | 1,9 ms | 97 | 9 | 1,0 MB |
| toàn bộ bộ mã mẫu công khai (đa ngôn ngữ) | 428 | 4.320 | 6.781 | 23 | 1,29 s | 0,3 / 1,4 ms | 3,7 ms (12 khối, 5 mũi tên) | 4,5 ms | 235 | 12 | 4,4 MB |
| **dự án giả 6.000 tệp** (dữ liệu sinh, không phải project thật) | 6.000 | 24.122 | 31.215 | 65 | 2,06 s | 0,4 / 1,1 ms | 25,6 ms (12 khối, 60 mũi tên) | 40,3 ms | 227 | 12 | 11,4 MB |

Quét sơ bộ (`scan_project`): 0,01 s (98 tệp), 0,15 s (428 tệp), 0,03 s (6.000 tệp giả); dự án giả bật `large = true`.

## Các bất biến đã kiểm (toàn bộ các màn đã duyệt)

| Bất biến | Kết quả |
|---|---|
| Số khối mỗi màn ≤ 12 (`MAX_BLOCKS`) | Đạt ở cả 4 dự án (tối đa 12) |
| Tổng `size` các khối = số tệp trong phạm vi | 0 lệch trên mọi màn |
| `count` của mũi tên = số mục bằng chứng (mẫu 3 mũi tên/màn: 23, 64, 151, 590 mũi tên) | 0 lệch |
| Cạnh `IMPORTS`/`CALLS` liên tệp bị mất khi gộp ở màn gốc | 0 (ví dụ bộ mã mẫu công khai: 1.439 cạnh liên tệp = 14 liên khối đếm đủ trên mũi tên + 1.425 trong cùng khối) |

## So với mục tiêu tầng S (spec §6.1)

| Mục tiêu | Kết quả | Nhận xét |
|---|---|---|
| Lập chỉ mục lần đầu < 60 s với ≤ 1.000 tệp | 1,29 s với 428 tệp | Đạt ở phần engine. FTS5 và cộng đồng làm tăng khoảng 0,0–0,1 s so với số của kế hoạch con 2 (1,28 s) |
| Mở lại < 3 s | 1–7 ms ở mức CSDL | Chưa đo end-to-end trong ứng dụng |

Không đo tầng L thật (5.000–15.000 tệp); số 6.000 tệp ở trên là dữ liệu sinh với tệp rất nhỏ nên chỉ cho biết cận dưới.

## Nhận xét và giới hạn

- Tìm kiếm FTS5 dưới 2 ms ở mọi cỡ đã đo, nên không cần chỉ mục thêm.
- `compass_app` ở gốc có hai khối (`app`, `server`) và **không có mũi tên nào**: hai gói không import nhau. Đúng nguyên tắc "không có cạnh thật thì không vẽ", nhưng màn gốc của một dự án nhiều gói độc lập sẽ trông "rỗng"; đi sâu mới có thông tin.
- **Khối `group` lồng nhau:** dự án giả có 120 thư mục con nên phải bấm "Khác" bốn lần (`more:more:more:more:…`) để tới thư mục cuối. Chấp nhận được cho v0, nhưng nên gộp cân bằng hơn nếu dự án thật có hàng trăm thư mục cùng cấp.
- **Phát hiện cộng đồng chỉ có ý nghĩa khi tệp thật sự import/gọi nhau.** Dữ liệu giả có cấu trúc import ngẫu nhiên nên tên cụm ("Cụm quanh f015.dart") không phản ánh nghiệp vụ; đánh giá chất lượng cụm trên project thật thuộc chương đánh giá.
- Tên cụm "Cụm quanh <tệp>" là tên mẫu, không phải mô tả; mô tả do AI để kế hoạch con 5.
- RAM và thời gian của giao diện (vẽ 2.000 nút, ELK) chưa đo trong tài liệu này.
