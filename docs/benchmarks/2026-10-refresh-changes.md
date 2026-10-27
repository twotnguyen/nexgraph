# Đo lập chỉ mục tăng dần và đọc thay đổi (kế hoạch con 4)

Ngày đo: 2026-10-27. Công cụ: `engine/scripts/bench_refresh.py` (chép project sang thư mục tạm, `git init` + commit, rồi sửa; thư mục gốc không bị đụng). Số liệu là **một lần chạy trên một máy**, chưa lặp nhiều lần, **chưa có Windows**.

## Máy và cấu hình

| | |
|---|---|
| Máy | Apple M3 Pro, 18 GB RAM, macOS (Darwin 24.6), SSD |
| Phần mềm | Python 3.12.16, `tree-sitter-dart` 0.1.0, SQLite 3.53.1, git 2.51.0 |
| Đo | Thời gian trong tiến trình engine (`refresh_project`, `read_changes` + `analyze`); **không** gồm khoảng gộp sự kiện của bộ theo dõi (500 ms, tối đa 3 s), HTTP, nạp lại và vẽ giao diện |
| Sửa 1 / 50 tệp | Thêm một hàm mới cuối tệp Dart (đổi tập nút nên kích hoạt phân giải lại và trích xuất lại các tệp phụ thuộc: trường hợp xấu hơn sửa thân hàm); 3 lần mỗi mức, lấy trung vị và tối đa |

## Kết quả

| Project | Tệp | Lập chỉ mục đầy đủ | Refresh không đổi | Sửa 1 tệp (trung vị / tối đa) | Sửa 50 tệp | Thêm 1 tệp | Xoá 1 tệp | Đọc thay đổi + vùng ảnh hưởng* | Mở lại |
|---|---|---|---|---|---|---|---|---|---|
| `flutter-music-app` | 98 | 0,33 s | 2 ms | 35 / 43 ms | 206 / 261 ms | 33 ms | 34 ms | 65 ms | 1 ms |
| toàn bộ `flutter-samples` (đa ngôn ngữ) | 428 | 1,46 s | 88 ms | 176 / 182 ms | 277 / 287 ms | 173 ms | 199 ms | 140 ms | 2 ms |
| **dự án giả 6.000 tệp** (dữ liệu sinh, không phải project thật) | 6.000 | 2,23 s | 40 ms | 160 / 177 ms | 189 / 204 ms | 180 ms | 189 ms | 93 ms | 6 ms |

\* Đo sau khi đã sửa 150 tệp chưa commit (đủ để có hàng trăm nút đổi), nên lớn hơn trường hợp thật khi chỉ sửa một hàm; số cột này chỉ cho biết cỡ.

## So với mục tiêu (spec §6.1, tầng L)

| Mục tiêu | Kết quả | Nhận xét |
|---|---|---|
| Cập nhật sau khi lưu tệp < 2 s | Phần engine ≤ 0,3 s ở cả ba project, kể cả 6.000 tệp giả | **Chưa đo đầu cuối.** Cộng khoảng gộp sự kiện 0,5 s (tối đa 3 s khi sửa liên tục), truy vấn `/changes` và vẽ lại, dự kiến khoảng 1 s nhưng chưa có số thật. Cam kết kiểm ở tuần 8 |
| Mở lại < 3 s | 1–6 ms mở CSDL | Chưa gồm khởi động engine và vẽ giao diện |
| Refresh khi không đổi ≤ 0,5 s ở 6.000 tệp | 40 ms | Không có nút thắt; chưa cần truyền danh sách tệp từ bộ theo dõi |

## Nhận xét

- Chi phí chính của một lần refresh có thay đổi là nạp lại toàn bộ nút cho bộ phân giải (tỉ lệ với số nút, 24.000 nút ≈ 0,15 s), không phải trích xuất. Sửa 50 tệp chỉ tốn thêm vài chục mili giây so với sửa 1 tệp ở project lớn.
- Với project nhỏ, sửa 50 tệp chậm hơn rõ (206 ms ở 98 tệp) vì gần như mọi tệp phụ thuộc nhau nên bị trích xuất lại (tập "phụ thuộc" ở `index/refresh.py`).
- Số tệp đổi làm đọc thay đổi chậm hơn một chút (mỗi nút đổi gọi `tests_for` riêng); giới hạn `MAX_CHANGED_NODES = 2000` chặn trường hợp xấu.
