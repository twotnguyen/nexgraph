# NexGraph — Phụ thuộc hàm, chuẩn hóa, từ điển dữ liệu, ràng buộc toàn vẹn (bản nháp)

> **Cập nhật 2026-11-24:** tài liệu này mô tả lược đồ lúc thiết kế (Sprint 2, 24/10/2026). Mã hiện ở lược đồ đồ thị **v8**, CSDL app **v3**, CSDL graph chung **v1** (`engine/src/nexgraph_engine/schema/db.py:8-10`); SQL thiết kế đã cập nhật theo ở `design/database/`.

> Bản nháp cho báo cáo tuần 2, chưa duyệt. Cập nhật 2026-10-24. Nền: `2026-10-24-nexgraph-csdl-design.md` (thực thể), `2026-10-24-nexgraph-csdl-tan-tu.md` (tân từ, bản số).
> Thứ tự theo giáo trình: phụ thuộc hàm và chuẩn hóa (§1–§2) cho ra lược đồ cuối; từ điển dữ liệu (§3) và ràng buộc toàn vẹn (§4) viết trên lược đồ cuối.
> Không đưa tên repo khác vào báo cáo nộp.

## 1. Phụ thuộc hàm, khóa và dạng chuẩn

Phụ thuộc hàm (PTH) rút từ tân từ, không rút từ dữ liệu mẫu. Ký hiệu `R+` là toàn bộ thuộc tính của quan hệ. Mỗi quan hệ được kiểm tra: (1) dạng chuẩn 1: thuộc tính nguyên tử; (2) mọi định thức của PTH không tầm thường là siêu khóa thì đạt BCNF.

### 1.1 CSDL đồ thị

| Quan hệ | Khóa dự tuyển | Tập PTH F | Kết luận |
|---|---|---|---|
| DU_AN | ma_du_an | ma_du_an → R+ | BCNF |
| LAN_LAP_CHI_MUC | ma_lan | ma_lan → R+ | BCNF |
| TEP | ma_tep; duong_dan_tuong_doi | ma_tep → R+; duong_dan_tuong_doi → R+ | BCNF |
| LOI_PHAN_TICH | ma_loi; (ma_tep, loai) | ma_loi → R+; (ma_tep, loai) → ma_loi, chi_tiet | BCNF (cả hai định thức đều là khóa) |
| KHOI_KIEN_TRUC | ma_khoi | ma_khoi → R+ | BCNF (sau hiệu chỉnh 1) |
| NUT | ma_nut; id_nut | ma_nut → R+; id_nut → R+ | BCNF (sau hiệu chỉnh 2, 3) |
| CANH | ma_canh; (ma_nut_nguon, ma_nut_dich, loai_canh, dong_bang_chung, cot_bang_chung) | ma_canh → R+; khóa tự nhiên → R+ | BCNF (xem §1.5) |
| THAM_CHIEU_CHUA_PHAN_GIAI | ma_tc; (ma_nut_nguon, ten_tham_chieu, loai_tham_chieu, dong, cot) | ma_tc → R+; khóa tự nhiên → R+ | BCNF (sau hiệu chỉnh 4) |

### 1.2 CSDL cá nhân

| Quan hệ | Khóa dự tuyển | Tập PTH F | Kết luận |
|---|---|---|---|
| DU_AN_DA_MO | ma_du_an; duong_dan_tuyet_doi | ma_du_an → R+; duong_dan_tuyet_doi → R+ | BCNF |
| KET_NOI_AI | ma_ket_noi | ma_ket_noi → R+ | BCNF |
| DONG_Y_GUI_DU_LIEU | (ma_du_an, ma_ket_noi) | (ma_du_an, ma_ket_noi) → dong_y_luc | BCNF |
| PHIEN_CHAT | ma_phien | ma_phien → R+ | BCNF |
| TIN_NHAN | ma_tin; (ma_phien, thu_tu) | ma_tin → R+; (ma_phien, thu_tu) → R+ | BCNF |
| TRICH_DAN | ma_trich_dan | ma_trich_dan → R+ | BCNF (sau hiệu chỉnh 5) |
| DOAN_MA_DA_GUI | ma_doan | ma_doan → R+ | BCNF |

### 1.3 Các hiệu chỉnh do chuẩn hóa

Bản thiết kế đầu (trong `2026-10-24-nexgraph-csdl-design.md`) có 5 chỗ vi phạm dạng chuẩn 3 hoặc BCNF, nay đã sửa. Đây là nội dung "quy trình chuẩn hóa" của báo cáo.

| # | Quan hệ | PTH vi phạm | Cách sửa |
|---|---|---|---|
| 0 | NUT | ma_nut → ma_tep → ngon_ngu (ngôn ngữ của nút do tệp chứa nó quyết định): phụ thuộc bắc cầu, vi phạm dạng chuẩn 3 | Đưa `ngon_ngu` về TEP (đã thực hiện từ bước đầu) |
| 1 | KHOI_KIEN_TRUC | ma_khoi_cha → cap (cấp của khối con luôn bằng cấp của khối cha cộng một); và nếu khối gồm cả loại thư mục, thì ma_tep → ma_khoi trong NUT (mọi nút cùng tệp cùng thư mục) | Bỏ `cap` (tính bằng truy vấn đệ quy khi cần). Bỏ `loai`: quan hệ chỉ lưu **khối cộng đồng** do thuật toán gom cụm sinh ra; khối theo thư mục hoặc module suy ra từ đường dẫn tệp khi hiển thị, không lưu |
| 2 | NUT | ten_day_du → tu_khoa_tach (từ khóa tách chữ hoa chữ thường suy ra từ tên) | Bỏ cột. Bảng tìm kiếm toàn văn `nut_fts` (FTS5, không thuộc mô hình quan hệ) do bộ lập chỉ mục nạp từ khóa đã tách khi ghi |
| 3 | THAM_CHIEU_CHUA_PHAN_GIAI | ten_tham_chieu → duoi_ten (đoạn sau dấu chấm cuối) | Bỏ cột; tra cứu bằng chỉ mục biểu thức trên `substr(...)` |
| 4 | TRICH_DAN | (duong_dan_tuong_doi, dong_bat_dau, dong_ket_thuc) → id_nut qua đồ thị của dự án; giá trị thay đổi mỗi lần lập chỉ mục lại nên sẽ cũ | Bỏ `id_nut`; ánh xạ trích dẫn sang nút khi hiển thị (spec §5.8). Quan hệ này nhờ vậy không còn tham chiếu sang CSDL đồ thị |
| 5 | LOI_PHAN_TICH | Thêm khóa dự tuyển (ma_tep, loai): mỗi loại lỗi tối đa một lần cho một tệp (nhiều khoảng dòng gộp trong `chi_tiet`) | Thêm ràng buộc duy nhất |

### 1.4 Phụ thuộc hàm đã cân nhắc nhưng không đưa vào

| Phụ thuộc | Lý do không tách quan hệ |
|---|---|
| TEP: ma_bam → kich_thuoc (cùng nội dung thì cùng kích thước) | Không có trong tân từ. Tách `NOI_DUNG(ma_bam, kich_thuoc)` chỉ thêm một phép nối ở mọi truy vấn mà không tránh được dư thừa nào đáng kể |
| NUT: ten_day_du → nhan (nhãn là đoạn cuối của tên đầy đủ) | Chỉ đúng với nút lấy từ cú pháp. Nhãn của nút `route`, `document`, `concept` lấy từ nội dung, nên nhãn là thuộc tính độc lập |
| CANH: diem_tin_cay → muc_tin_cay (mức là hàm của điểm) | Ngưỡng chia mức do bộ phân tích quy định và có thể đổi theo phiên bản; hai cột được ghi độc lập để cạnh cũ không bị đổi nghĩa |
| CANH: loai_con → loai_canh (quan hệ gốc ánh xạ sang loại chuẩn) | **Chưa kết luận.** Nếu bộ phân tích C#/TypeScript có `loai_con` ánh xạ duy nhất sang `loai_canh` thì tách `LOAI_CANH_GOC(loai_con, loai_canh)`. Kiểm khi cài bộ phân tích (kế hoạch con 2) |
| KET_NOI_AI: muc_keychain là hàm của ma_ket_noi (tên mục khóa tạo theo quy tắc) | Thuộc tính phụ thuộc khóa nên không vi phạm BCNF; vẫn lưu để khỏi gắn mã chương trình với quy tắc đặt tên |

### 1.5 Lưu ý về dạng chuẩn 1

- `id_nut` và `duong_dan_tuong_doi` là chuỗi có cấu trúc nhưng được dùng như một định danh nguyên tử, không bao giờ tách để truy vấn.
- `chi_tiet` (khoảng dòng gặp lỗi) và `thong_bao_loi` là văn bản mô tả cho người đọc, không là danh sách để truy vấn từng phần tử.
- `id_nut` duy nhất có thể bị vi phạm bởi hàm nạp chồng (overload) của C# và TypeScript vì định danh theo spec không chứa chữ ký. **Cần quyết định ở kế hoạch con 2**: thêm hậu tố chữ ký vào `id_nut`, hoặc đổi quy tắc định danh.
- Khóa tự nhiên của CANH chứa cột có thể rỗng (dòng, cột bằng chứng). SQLite coi hai giá trị rỗng là khác nhau trong ràng buộc duy nhất, nên cài đặt dùng chỉ mục duy nhất trên biểu thức `IFNULL(dong_bang_chung,-1)`, `IFNULL(cot_bang_chung,-1)`.
- Các hiệu chỉnh ở §1.3 chỉ bỏ thuộc tính suy ra được hoặc thu hẹp phạm vi của một quan hệ, không phân rã quan hệ nên không có nguy cơ mất thông tin khi nối.

### 1.6 Lược đồ quan hệ cuối (sau chuẩn hóa)

Chỉ ghi thay đổi so với tân từ; các quan hệ còn lại giữ nguyên.

- KHOI_KIEN_TRUC(<u>ma_khoi</u>, ten, ma_khoi_cha, do_gan_ket, mo_ta, nguon_mo_ta) — chỉ lưu khối cộng đồng.
- NUT(<u>ma_nut</u>, id_nut, loai_nut, nhan, ten_day_du, dong_bat_dau, dong_ket_thuc, la_kiem_thu, nguon_goc, chu_ky, tai_lieu, ma_tep, ma_khoi).
- THAM_CHIEU_CHUA_PHAN_GIAI(<u>ma_tc</u>, ma_nut_nguon, ten_tham_chieu, loai_tham_chieu, dong, cot, trang_thai).
- TRICH_DAN(<u>ma_trich_dan</u>, ma_tin, duong_dan_tuong_doi, dong_bat_dau, dong_ket_thuc, trang_thai).
- LOI_PHAN_TICH(<u>ma_loi</u>, ma_tep, loai, chi_tiet) với khóa dự tuyển (ma_tep, loai).

Hệ quả cần chấp nhận: mô tả do AI viết cho khối chỉ lưu với khối cộng đồng; khối thư mục và module dùng mô tả sinh từ mẫu (spec §5.7 nói AI đặt tên và viết mô tả khối, cần xác nhận lại phạm vi).

## 2. Quy ước kiểu dữ liệu

SQLite chỉ có 5 lớp lưu trữ nên kiểu logic của môn học được ánh xạ như sau; độ rộng được giữ trong từ điển và cài bằng `CHECK(length(cột) <= n)` vì SQLite không tự kiểm.

| Kiểu logic | Lớp lưu trữ SQLite | Lý do chọn |
|---|---|---|
| INT, BIGINT, SMALLINT | INTEGER (64 bit) | Một lớp duy nhất; khóa số nguyên là bí danh của `rowid` nên tra cứu nhanh nhất |
| BOOLEAN | INTEGER, `CHECK (cột IN (0,1))` | SQLite không có kiểu logic |
| DATETIME | INTEGER (mili giây từ 1970-01-01 UTC) | Sắp xếp và so sánh trực tiếp, không phụ thuộc múi giờ; ứng dụng đổi sang giờ địa phương khi hiển thị |
| FLOAT | REAL | Điểm số trong đoạn [0,1] |
| CHAR(n), VARCHAR(n) | TEXT | Chuỗi chỉ gồm ký tự ASCII (mã băm, giá trị liệt kê, mã định danh) |
| NVARCHAR(n) | TEXT (UTF-8) | Chuỗi có thể chứa tiếng Việt hoặc ký tự bất kỳ (tên, đường dẫn) |
| TEXT | TEXT | Văn bản dài, không giới hạn trước |

Khóa chính số nguyên tự tăng dùng cho mọi quan hệ trừ DU_AN và DU_AN_DA_MO. Mã dự án là UUID (CHAR(36)) vì được chia sẻ giữa hai CSDL và phải duy nhất khi thư mục `.nexgraph/` được sao chép sang máy khác.

## 3. Từ điển dữ liệu

Cột "Rỗng" ghi `x` nếu cho phép NULL.

### 3.1 CSDL đồ thị

**DU_AN**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_du_an | CHAR(36) | | UUID dạng có gạch ngang đúng 36 ký tự; ngẫu nhiên để không đụng khi chia sẻ |
| ten | NVARCHAR(255) | | Tên thư mục dự án; 255 là giới hạn tên thành phần đường dẫn của hệ điều hành; có thể có tiếng Việt |
| co_git | BOOLEAN | | Chọn chế độ so sánh thay đổi (Git hay lần lập chỉ mục trước) |
| phien_ban_schema | SMALLINT | | Số nguyên nhỏ ≥ 1, tăng khi cấu trúc đổi (cũng ghi ở `PRAGMA user_version`) |
| tao_luc | DATETIME | | Thời điểm tạo cơ sở dữ liệu |

**LAN_LAP_CHI_MUC**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_lan | INT | | Số thứ tự tự tăng |
| ma_du_an | CHAR(36) | | Khóa ngoại tới DU_AN |
| loai | VARCHAR(10) | | `day_du` hoặc `tang_dan` (dài nhất 7) |
| trang_thai | VARCHAR(10) | | `cho`, `cau_truc`, `phan_giai`, `hoan_tat`, `loi`, `huy` (dài nhất 9) |
| bat_dau_luc | DATETIME | | Mili giây từ 1970, số lớn hơn 32 bit nên lưu 64 bit |
| ket_thuc_luc | DATETIME | x | Rỗng khi lần lập chỉ mục chưa dừng |
| so_tep_xu_ly | INT | | Đếm đến vài chục nghìn tệp (tầng L khoảng 15.000) |
| so_tep_tong | INT | | Như trên |
| commit_sha | VARCHAR(64) | x | Mã commit Git: 40 ký tự (SHA-1), 64 nếu kho dùng SHA-256 |
| thong_bao_loi | TEXT | x | Thông điệp lỗi có độ dài không biết trước |

**TEP**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_tep | INT | | Khóa số nguyên tự tăng |
| duong_dan_tuong_doi | NVARCHAR(1024) | | Đường dẫn tương đối, dùng `/`; 1024 đủ cho đường dẫn dự án thông thường; có thể chứa tiếng Việt |
| ngon_ngu | VARCHAR(20) | | Tên ngôn ngữ (`dart`, `typescript`, `csharp`…), dài nhất khoảng 12 |
| kich_thuoc | BIGINT | | Byte; tệp lớn hơn 2 GiB vượt INT 32 bit |
| mtime | BIGINT | | Thời điểm sửa (mili giây epoch), dùng cùng kích thước để lọc nhanh tệp đổi |
| ma_bam | CHAR(64) | | SHA-256 dạng thập lục phân đúng 64 ký tự |
| la_kiem_thu | BOOLEAN | | Tệp thuộc thư mục hoặc theo tên kiểm thử |
| la_tep_sinh_tu_dong | BOOLEAN | | Tệp sinh tự động (`*.g.dart`…), bị loại khỏi xếp hạng |
| ma_lan | INT | | Lần xử lý gần nhất |

**LOI_PHAN_TICH**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_loi | INT | | Khóa số nguyên |
| ma_tep | INT | | Khóa ngoại tới TEP |
| loai | VARCHAR(20) | | `parse_partial`, `parse_unusable`, `read`, `extract`, `oversized` (dài nhất 14) |
| chi_tiet | TEXT | x | Danh sách khoảng dòng hoặc lý do bỏ qua, độ dài thay đổi |

**KHOI_KIEN_TRUC**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_khoi | INT | | Khóa số nguyên |
| ten | NVARCHAR(200) | | Tên khối; AI có thể đặt tên tiếng Việt |
| ma_khoi_cha | INT | x | Khối cha; rỗng ở khối gốc |
| do_gan_ket | FLOAT | x | Điểm [0,1] của thuật toán gom cụm |
| mo_ta | TEXT | x | Mô tả sinh từ mẫu hoặc do AI viết |
| nguon_mo_ta | VARCHAR(10) | x | `mau` hoặc `ai`; rỗng khi chưa có mô tả |

**NUT**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_nut | INT | | Khóa số nguyên (bảng lớn nhất nên cần 64 bit) |
| id_nut | NVARCHAR(2048) | | `{đường dẫn}::{tên đầy đủ}#{loại}`: 1024 cho đường dẫn cộng phần còn lại |
| loai_nut | VARCHAR(12) | | 17 giá trị, dài nhất `repository` (10) |
| nhan | NVARCHAR(255) | | Nhãn hiển thị trên đồ thị |
| ten_day_du | NVARCHAR(1024) | | Tên đầy đủ có phân cấp (`LoginScreen.build`) |
| dong_bat_dau | INT | x | Rỗng với `repository`, `directory`, `package`, `file`, `module`, `document`, `concept` |
| dong_ket_thuc | INT | x | Như trên |
| la_kiem_thu | BOOLEAN | | Nút kiểm thử (có thể là hàm hỗ trợ trong tệp kiểm thử) |
| nguon_goc | VARCHAR(8) | | `ast`, `resolver`, `llm` (dài nhất 8) |
| chu_ky | NVARCHAR(2000) | x | Chữ ký hàm, cắt ở 2000 ký tự |
| tai_lieu | TEXT | x | Chú thích tài liệu; độ dài thay đổi |
| ma_tep | INT | x | Rỗng với `repository`, `directory` |
| ma_khoi | INT | x | Khối cộng đồng chứa nút; rỗng trước khi gom cụm xong |

**CANH**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_canh | BIGINT | | Cạnh nhiều hơn nút, cần 64 bit |
| ma_nut_nguon | INT | | Khóa ngoại tới NUT |
| ma_nut_dich | INT | | Khóa ngoại tới NUT |
| loai_canh | VARCHAR(20) | | 14 giá trị, dài nhất `SEMANTIC_RELATED` (16) |
| loai_con | VARCHAR(50) | x | Tên quan hệ gốc của bộ phân tích |
| muc_tin_cay | VARCHAR(10) | | `EXTRACTED`, `INFERRED`, `AMBIGUOUS` (dài nhất 9) |
| diem_tin_cay | FLOAT | | Điểm trong [0,1] |
| nguon_goc | VARCHAR(8) | | `ast`, `resolver`, `llm` |
| dong_bang_chung | INT | x | Dòng trong tệp của nút nguồn |
| cot_bang_chung | INT | x | Cột; phân biệt hai lời gọi cùng dòng |

**THAM_CHIEU_CHUA_PHAN_GIAI**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_tc | BIGINT | | Mỗi lời gọi chưa phân giải một dòng nên rất nhiều |
| ma_nut_nguon | INT | | Khóa ngoại tới NUT |
| ten_tham_chieu | NVARCHAR(500) | | Tên như viết trong mã (`Navigator.push`) |
| loai_tham_chieu | VARCHAR(20) | | Một trong 14 loại cạnh dự định tạo |
| dong | INT | | Vị trí trong tệp của nút nguồn |
| cot | INT | | Vị trí |
| trang_thai | VARCHAR(10) | | `cho` hoặc `that_bai` |

### 3.2 CSDL cá nhân

**DU_AN_DA_MO**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_du_an | CHAR(36) | | Trùng mã trong CSDL đồ thị |
| duong_dan_tuyet_doi | NVARCHAR(2048) | | Đường dẫn tuyệt đối; dài hơn đường dẫn tương đối vì tính từ gốc ổ đĩa |
| ten | NVARCHAR(255) | | Tên hiển thị |
| noi_luu | VARCHAR(12) | | `trong_du_an` hoặc `thu_muc_app` (cùng 11) |
| mo_lan_cuoi | DATETIME | | Sắp xếp danh sách |

**KET_NOI_AI**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_ket_noi | INT | | Khóa số nguyên |
| loai | VARCHAR(8) | | `acp` hoặc `api_key` |
| ten_hien_thi | NVARCHAR(100) | | Tên người dùng đặt |
| ten_agent | VARCHAR(50) | x | Chỉ với `acp` |
| base_url | VARCHAR(2048) | x | Chỉ với `api_key`; 2048 là giới hạn phổ biến của địa chỉ URL |
| ten_model | VARCHAR(100) | x | Chỉ với `api_key` |
| muc_keychain | VARCHAR(100) | x | Tên mục trong kho khóa hệ điều hành; **khóa API không lưu ở đây** |
| la_mac_dinh | BOOLEAN | | Tối đa một kết nối là mặc định |

**DONG_Y_GUI_DU_LIEU**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_du_an | CHAR(36) | | Khóa chính, khóa ngoại tới DU_AN_DA_MO |
| ma_ket_noi | INT | | Khóa chính, khóa ngoại tới KET_NOI_AI |
| dong_y_luc | DATETIME | | Thời điểm đồng ý |

**PHIEN_CHAT**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_phien | INT | | Khóa số nguyên |
| ma_du_an | CHAR(36) | | Khóa ngoại tới DU_AN_DA_MO |
| ma_ket_noi | INT | x | Rỗng nếu kết nối bị xóa (`ON DELETE SET NULL`) |
| tieu_de | NVARCHAR(200) | | Mặc định lấy từ câu hỏi đầu |
| tao_luc | DATETIME | | |
| cap_nhat_luc | DATETIME | | Sắp xếp danh sách phiên |

**TIN_NHAN**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_tin | INT | | Khóa số nguyên |
| ma_phien | INT | | Khóa ngoại tới PHIEN_CHAT |
| thu_tu | INT | | 1, 2, 3… trong phiên |
| vai_tro | VARCHAR(10) | | `nguoi_dung` (10) hoặc `tro_ly` |
| noi_dung | TEXT | | Độ dài không biết trước |
| tao_luc | DATETIME | | |

**TRICH_DAN**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_trich_dan | INT | | Khóa số nguyên |
| ma_tin | INT | | Khóa ngoại tới TIN_NHAN |
| duong_dan_tuong_doi | NVARCHAR(1024) | | Như TEP |
| dong_bat_dau | INT | | |
| dong_ket_thuc | INT | | |
| trang_thai | VARCHAR(15) | | `da_xac_minh` (11) hoặc `chua_xac_minh` (13) |

**DOAN_MA_DA_GUI**

| Thuộc tính | Kiểu (độ rộng) | Rỗng | Giải thích |
|---|---|---|---|
| ma_doan | INT | | Khóa số nguyên |
| ma_tin | INT | | Khóa ngoại tới TIN_NHAN |
| duong_dan_tuong_doi | NVARCHAR(1024) | | |
| dong_bat_dau | INT | | |
| dong_ket_thuc | INT | | |
| ma_bam | CHAR(64) | | SHA-256 nội dung lúc gửi |

## 4. Ràng buộc toàn vẹn

Trình bày theo giáo trình: bối cảnh, điều kiện, tầm ảnh hưởng (+ phải kiểm tra, − không cần). Điều kiện viết bằng ngôn ngữ tự nhiên kèm biểu thức; bảng tầm ảnh hưởng nằm ở §4.3.

### 4.1 CSDL đồ thị

**Một quan hệ — miền giá trị**
- RB1 (DU_AN): `co_git` ∈ {0,1}; `phien_ban_schema` ≥ 1.
- RB2 (LAN_LAP_CHI_MUC): `loai` ∈ {day_du, tang_dan}; `trang_thai` ∈ {cho, cau_truc, phan_giai, hoan_tat, loi, huy}.
- RB3 (TEP): `kich_thuoc` ≥ 0; `ma_bam` gồm đúng 64 ký tự thập lục phân; `duong_dan_tuong_doi` không bắt đầu bằng `/`, không chứa `\`.
- RB4 (LOI_PHAN_TICH): `loai` ∈ {parse_partial, parse_unusable, read, extract, oversized}.
- RB5 (KHOI_KIEN_TRUC): `do_gan_ket` rỗng hoặc ∈ [0,1]; `nguon_mo_ta` ∈ {mau, ai}.
- RB6 (NUT): `loai_nut` thuộc 17 giá trị NodeKind; `nguon_goc` ∈ {ast, resolver, llm}.
- RB7 (CANH): `loai_canh` thuộc 14 giá trị EdgeType; `muc_tin_cay` ∈ {EXTRACTED, INFERRED, AMBIGUOUS}; `diem_tin_cay` ∈ [0,1]; `nguon_goc` ∈ {ast, resolver, llm}.
- RB8 (THAM_CHIEU_CHUA_PHAN_GIAI): `loai_tham_chieu` thuộc EdgeType; `trang_thai` ∈ {cho, that_bai}; `dong` ≥ 1, `cot` ≥ 0.

**Một quan hệ — liên thuộc tính**
- RB9 (LAN_LAP_CHI_MUC): `so_tep_xu_ly` ≤ `so_tep_tong`; `ket_thuc_luc` rỗng hoặc ≥ `bat_dau_luc`; `trang_thai` ∈ {hoan_tat, loi, huy} khi và chỉ khi `ket_thuc_luc` có giá trị; `thong_bao_loi` có giá trị khi và chỉ khi `trang_thai` = loi.
- RB10 (NUT): nếu `loai_nut` ∈ {class, mixin, enum, extension, function, method, test, widget, screen, route} thì `dong_bat_dau` và `dong_ket_thuc` không rỗng, `dong_bat_dau` ≥ 1 và `dong_ket_thuc` ≥ `dong_bat_dau`.
- RB11 (NUT): `ma_tep` rỗng khi và chỉ khi `loai_nut` ∈ {repository, directory}; `loai_nut` = test thì `la_kiem_thu` = 1.
- RB12 (CANH): `cot_bang_chung` có giá trị thì `dong_bang_chung` có giá trị; nếu `loai_canh` ∈ {CALLS, IMPORTS, INHERITS, IMPLEMENTS, REFERENCES, USES_TYPE, COMPOSES, NAVIGATES_TO} thì `dong_bang_chung` không rỗng (mỗi mũi tên phải có bằng chứng).
- RB13 (KHOI_KIEN_TRUC): `mo_ta` có giá trị khi và chỉ khi `nguon_mo_ta` có giá trị.

**Một quan hệ — liên bộ**
- RB14 (TEP): `duong_dan_tuong_doi` duy nhất. RB15 (NUT): `id_nut` duy nhất (xem lưu ý hàm nạp chồng ở §1.5). RB16 (CANH): bộ (`ma_nut_nguon`, `ma_nut_dich`, `loai_canh`, `dong_bang_chung`, `cot_bang_chung`) duy nhất, rỗng được so như −1. RB17 (LOI_PHAN_TICH): (`ma_tep`, `loai`) duy nhất. RB18 (THAM_CHIEU_CHUA_PHAN_GIAI): (`ma_nut_nguon`, `ten_tham_chieu`, `loai_tham_chieu`, `dong`, `cot`) duy nhất.
- RB19 (LAN_LAP_CHI_MUC): tại một thời điểm tối đa một lần lập chỉ mục ở trạng thái cho, cau_truc hoặc phan_giai.
- RB20 (KHOI_KIEN_TRUC): `ma_khoi_cha` khác `ma_khoi` và dãy khối cha không quay lại chính nó (phân cấp là cây).
- RB23 (DU_AN): cơ sở dữ liệu chỉ chứa tối đa một bộ (mỗi cơ sở dữ liệu một dự án).

**Nhiều quan hệ — phụ thuộc tồn tại (khóa ngoại)**
- RB21: LAN_LAP_CHI_MUC[ma_du_an] ⊆ DU_AN[ma_du_an]; TEP[ma_lan] ⊆ LAN_LAP_CHI_MUC[ma_lan]; LOI_PHAN_TICH[ma_tep] ⊆ TEP[ma_tep]; NUT[ma_tep] ⊆ TEP[ma_tep] (khi không rỗng); NUT[ma_khoi] ⊆ KHOI_KIEN_TRUC[ma_khoi] (khi không rỗng); KHOI_KIEN_TRUC[ma_khoi_cha] ⊆ KHOI_KIEN_TRUC[ma_khoi]; CANH[ma_nut_nguon], CANH[ma_nut_dich] ⊆ NUT[ma_nut]; THAM_CHIEU_CHUA_PHAN_GIAI[ma_nut_nguon] ⊆ NUT[ma_nut].
- Hành vi khi xóa: xóa TEP thì xóa LOI_PHAN_TICH và NUT của tệp; xóa NUT thì xóa CANH (cả hai đầu) và THAM_CHIEU_CHUA_PHAN_GIAI của nút; xóa KHOI thì đặt `ma_khoi` của NUT và `ma_khoi_cha` của khối con về rỗng; xóa LAN_LAP_CHI_MUC bị cấm khi còn TEP tham chiếu.

**Nhiều quan hệ — liên thuộc tính, liên quan hệ**
- RB22 (CANH, NUT): nếu nút nguồn có `dong_bat_dau` và `dong_ket_thuc` thì `dong_bang_chung` nằm trong đoạn đó (lời gọi nằm trong thân hàm gọi nó).

**Chu trình:** đồ thị của lược đồ CSDL đồ thị không có chu trình từ 3 đỉnh quan hệ trở lên (CANH nối NUT bằng hai cung song song, không tính là chu trình), nên không phát sinh ràng buộc dạng chu trình.

### 4.2 CSDL cá nhân

- RB24 (DU_AN_DA_MO): `noi_luu` ∈ {trong_du_an, thu_muc_app}; `duong_dan_tuyet_doi` duy nhất và là đường dẫn tuyệt đối.
- RB25 (KET_NOI_AI): `loai` ∈ {acp, api_key}; nếu `loai` = acp thì `ten_agent` không rỗng; nếu `loai` = api_key thì `base_url`, `ten_model`, `muc_keychain` không rỗng.
- RB26 (KET_NOI_AI): tối đa một bộ có `la_mac_dinh` = 1.
- RB27 (PHIEN_CHAT): `cap_nhat_luc` ≥ `tao_luc`.
- RB28 (TIN_NHAN): `vai_tro` ∈ {nguoi_dung, tro_ly}; `thu_tu` ≥ 1; (`ma_phien`, `thu_tu`) duy nhất; thứ tự trong phiên liên tục từ 1 (khi thêm, trigger kiểm trước nên báo lỗi RB28 chứ không phải lỗi CHECK/UNIQUE).
- RB29 (TRICH_DAN): `trang_thai` ∈ {da_xac_minh, chua_xac_minh}; `dong_bat_dau` ≥ 1 và `dong_ket_thuc` ≥ `dong_bat_dau`. RB30 (DOAN_MA_DA_GUI): cùng điều kiện về dòng.
- RB31 (TRICH_DAN, TIN_NHAN): trích dẫn chỉ thuộc tin nhắn có `vai_tro` = tro_ly; RB32 (DOAN_MA_DA_GUI, TIN_NHAN): đoạn mã đã gửi chỉ thuộc tin nhắn có `vai_tro` = nguoi_dung.
- RB33 (khóa ngoại): PHIEN_CHAT[ma_du_an] ⊆ DU_AN_DA_MO[ma_du_an] (xóa dự án thì xóa phiên); PHIEN_CHAT[ma_ket_noi] ⊆ KET_NOI_AI[ma_ket_noi] (xóa kết nối thì đặt rỗng); TIN_NHAN[ma_phien] ⊆ PHIEN_CHAT[ma_phien]; TRICH_DAN[ma_tin], DOAN_MA_DA_GUI[ma_tin] ⊆ TIN_NHAN[ma_tin]; DONG_Y_GUI_DU_LIEU[ma_du_an] ⊆ DU_AN_DA_MO[ma_du_an], DONG_Y_GUI_DU_LIEU[ma_ket_noi] ⊆ KET_NOI_AI[ma_ket_noi] (xóa bên nào thì xóa bộ đồng ý theo).
- **RB34 — ràng buộc do chu trình** (DU_AN_DA_MO, PHIEN_CHAT, KET_NOI_AI, DONG_Y_GUI_DU_LIEU, cùng TIN_NHAN, DOAN_MA_DA_GUI): đồ thị lược đồ có chu trình DU_AN_DA_MO – PHIEN_CHAT – KET_NOI_AI – DONG_Y_GUI_DU_LIEU. Quy tắc nghiệp vụ: mã nguồn chỉ được gửi cho AI khi dự án đã đồng ý với đúng kết nối của phiên. Điều kiện, kiểm **tại thời điểm ghi** đoạn mã: phiên của tin nhắn tương ứng có `ma_ket_noi` không rỗng và (`ma_du_an`, `ma_ket_noi`) của phiên đó thuộc DONG_Y_GUI_DU_LIEU. Khi người dùng thu hồi đồng ý về sau, lịch sử các đoạn mã đã gửi vẫn được giữ nguyên; việc gửi tiếp bị chặn vì không còn bộ đồng ý tương ứng.
- RB35 (liên cơ sở dữ liệu): `DU_AN_DA_MO.ma_du_an` phải bằng mã trong `DU_AN` của CSDL đồ thị tại `noi_luu`. Hệ quản trị không kiểm được vì hai tệp riêng; ứng dụng kiểm khi mở dự án.

### 4.3 Bảng tầm ảnh hưởng

CSDL đồ thị (Thêm / Xóa / Sửa; ghi thuộc tính khi sửa):

| RB | Quan hệ | Thêm | Xóa | Sửa |
|---|---|---|---|---|
| RB1 | DU_AN | + | − | + [co_git, phien_ban_schema] |
| RB2 | LAN_LAP_CHI_MUC | + | − | + [loai, trang_thai] |
| RB3 | TEP | + | − | + [kich_thuoc, ma_bam, duong_dan_tuong_doi] |
| RB4 | LOI_PHAN_TICH | + | − | + [loai] |
| RB5, RB13 | KHOI_KIEN_TRUC | + | − | + [do_gan_ket, nguon_mo_ta, mo_ta] |
| RB6, RB10, RB11 | NUT | + | − | + [loai_nut, nguon_goc, dong_bat_dau, dong_ket_thuc, ma_tep, la_kiem_thu] |
| RB7, RB12 | CANH | + | − | + [loai_canh, muc_tin_cay, diem_tin_cay, nguon_goc, dong_bang_chung, cot_bang_chung] |
| RB8 | THAM_CHIEU_CHUA_PHAN_GIAI | + | − | + [loai_tham_chieu, trang_thai, dong, cot] |
| RB9 | LAN_LAP_CHI_MUC | + | − | + [so_tep_xu_ly, so_tep_tong, ket_thuc_luc, trang_thai, thong_bao_loi] |
| RB14 | TEP | + | − | + [duong_dan_tuong_doi] |
| RB15 | NUT | + | − | + [id_nut] |
| RB16 | CANH | + | − | + [ma_nut_nguon, ma_nut_dich, loai_canh, dong_bang_chung, cot_bang_chung] |
| RB17 | LOI_PHAN_TICH | + | − | + [ma_tep, loai] |
| RB18 | THAM_CHIEU_CHUA_PHAN_GIAI | + | − | + [ma_nut_nguon, ten_tham_chieu, loai_tham_chieu, dong, cot] |
| RB19 | LAN_LAP_CHI_MUC | + | − | + [trang_thai] |
| RB20 | KHOI_KIEN_TRUC | + | − | + [ma_khoi_cha] |
| RB21 | LAN_LAP_CHI_MUC, TEP, LOI_PHAN_TICH, NUT, KHOI_KIEN_TRUC, CANH, THAM_CHIEU_CHUA_PHAN_GIAI (bên con) | + | − | + [khóa ngoại] |
| RB21 | DU_AN, LAN_LAP_CHI_MUC, TEP, NUT, KHOI_KIEN_TRUC (bên cha) | − | + | + [khóa chính] |
| RB22 | CANH | + | − | + [dong_bang_chung, ma_nut_nguon] |
| RB22 | NUT | − | − | + [dong_bat_dau, dong_ket_thuc] |
| RB23 | DU_AN | + | − | − |

CSDL cá nhân:

| RB | Quan hệ | Thêm | Xóa | Sửa |
|---|---|---|---|---|
| RB24 | DU_AN_DA_MO | + | − | + [noi_luu, duong_dan_tuyet_doi] |
| RB25, RB26 | KET_NOI_AI | + | − | + [loai, ten_agent, base_url, ten_model, muc_keychain, la_mac_dinh] |
| RB27 | PHIEN_CHAT | + | − | + [tao_luc, cap_nhat_luc] |
| RB28 | TIN_NHAN | + | − | + [vai_tro, thu_tu, ma_phien] |
| RB29 | TRICH_DAN | + | − | + [trang_thai, dong_bat_dau, dong_ket_thuc] |
| RB30 | DOAN_MA_DA_GUI | + | − | + [dong_bat_dau, dong_ket_thuc] |
| RB31 | TRICH_DAN | + | − | + [ma_tin] |
| RB31 | TIN_NHAN | − | − | + [vai_tro] |
| RB32 | DOAN_MA_DA_GUI | + | − | + [ma_tin] |
| RB32 | TIN_NHAN | − | − | + [vai_tro] |
| RB33 | PHIEN_CHAT, TIN_NHAN, TRICH_DAN, DOAN_MA_DA_GUI, DONG_Y_GUI_DU_LIEU (bên con) | + | − | + [khóa ngoại] |
| RB33 | DU_AN_DA_MO, KET_NOI_AI, PHIEN_CHAT, TIN_NHAN (bên cha) | − | + | + [khóa chính] |
| RB34 | DOAN_MA_DA_GUI | + | − | + [ma_tin] |

## 5. Cài đặt và kiểm thử

Script: `design/database/graph.sql` (CSDL đồ thị), `design/database/app.sql` (CSDL cá nhân). Kiểm thử: `python3 -I design/database/kiem_thu.py`.

- Kết quả lần chạy 2026-10-24 (SQLite 3.50.4, Python 3.14): **101 ca, đạt 101**. Gồm ca dương (nạp dữ liệu mẫu app Flutter giả định `bookstore_app`, đa cạnh cùng dòng khác cột, xóa dây chuyền, khung nhìn, FTS5, chỉ mục biểu thức) và ca âm cho từng ràng buộc RB1–RB34; mỗi ca âm kiểm cả loại lỗi (CHECK, UNIQUE, FOREIGN KEY hoặc mã RB của trigger) nên không đạt nhầm vì ràng buộc khác.
- Kiểm tra độ nhạy: nới `diem_tin_cay` lên [0,2] và bỏ `ifnull` khỏi chỉ mục duy nhất của CANH thì đúng hai ca tương ứng báo lỗi.
- RB35 (mã dự án giữa hai CSDL) không cài trong SQL vì hệ quản trị không kiểm được qua hai tệp; ứng dụng kiểm khi mở dự án.
- Phải bật `PRAGMA foreign_keys = ON` ở mỗi kết nối, vì SQLite tắt mặc định và không lưu trong tệp.
- Dùng FTS5 `contentless_delete` cần SQLite từ 3.43. Bản SQLite đi kèm Python đóng gói trong bộ cài trên macOS và Windows **chưa kiểm**; kiểm ở kế hoạch con 1 khi dựng bản cài. Nếu thấp hơn, đổi `nut_fts` sang dạng external-content.
- Sửa so với tài liệu trước: RB23 cũ ("tệp không được ghi bởi lần lập chỉ mục đã hủy") bị bỏ vì chưa có trong tân từ và xung đột với việc hủy giữa chừng (tệp đã xử lý vẫn mang mã lần đó). RB23 nay là "một dự án mỗi cơ sở dữ liệu". RB34 kiểm lúc ghi, không kiểm lại khi thu hồi đồng ý.

## 6. Điều cần người dùng xem lại
1. Khối kiến trúc chỉ lưu cộng đồng (hiệu chỉnh 1): mô tả AI viết chỉ áp cho khối cộng đồng.
2. `id_nut` và hàm nạp chồng (§1.5): quyết định ở kế hoạch con 2.
3. `loai_con` → `loai_canh` (§1.4): chưa kết luận, kiểm khi cài bộ phân tích.

---

## Phụ lục: lược đồ phiên bản 2 (2026-10-27, kế hoạch con 4)

| Quan hệ | Khóa | Phụ thuộc hàm | Dạng chuẩn |
|---|---|---|---|
| KIEU_BIEN | (ma_nut, ten) | (ma_nut, ten) → kieu | BCNF |
| MOC_TEP | duong_dan_tuong_doi | duong_dan_tuong_doi → ma_bam | BCNF |
| LAN_LAP_CHI_MUC (thêm `thu_muc_con`) | ma_lan | ma_lan → thu_muc_con; không thêm phụ thuộc nào khác | BCNF (giữ nguyên) |

Ràng buộc mới: RB35 (KIEU_BIEN): `ten`, `kieu` dài 1–255; KIEU_BIEN[ma_nut] ⊆ NUT[ma_nut], xóa NUT thì xóa các bộ của nút. RB36 (MOC_TEP): `duong_dan_tuong_doi` giống RB3 (tương đối, dùng `/`, tối đa 1.024 ký tự); `ma_bam` gồm đúng 64 ký tự hex thường. RB37 (LAN_LAP_CHI_MUC): `thu_muc_con` rỗng hoặc dài 1–1.024 ký tự.

Nâng cấp từ v1: `migrate_1_to_2.sql` (một giao dịch) tạo hai bảng, thêm cột, đặt `du_an.phien_ban_schema = 2` và `PRAGMA user_version = 2`. Sơ đồ ERD ở báo cáo tuần 2 cần thêm hai thực thể này ở đợt báo cáo cuối.
