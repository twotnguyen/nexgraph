# NexGraph — Thiết kế CSDL (bản nháp cho báo cáo tuần 2)

> **Cập nhật 2026-11-24:** tài liệu này mô tả lược đồ lúc thiết kế (Sprint 2, 24/10/2026). Mã hiện ở lược đồ đồ thị **v8**, CSDL app **v3**, CSDL graph chung **v1** (`engine/src/nexgraph_engine/schema/db.py:8-10`); SQL thiết kế đã cập nhật theo ở `design/database/`.

> Trạng thái: **bản nháp chờ người dùng duyệt**, chưa phải quyết định. Cập nhật 2026-10-24.
> Phục vụ báo cáo tuần 2 (phân tích chức năng UML + thiết kế CSDL theo môn PTTK CSDL). Nơi lưu dữ liệu: spec §5.10, ADR 0005.

## 1. Nguyên tắc thiết kế

Các điểm thiết kế chính:

| Điểm thiết kế | Quyết định cho NexGraph |
|---|---|
| Phạm vi một CSDL | Mỗi project một file → **không có cột `project` ở các bảng đồ thị**, gọn hơn và dễ đạt dạng chuẩn |
| Đầu mút của cạnh | Khóa ngoại số tới NÚT với `ON DELETE CASCADE`. Tham chiếu chưa phân giải tách sang bảng riêng, không để cạnh treo |
| Định danh duy nhất của cạnh | Thêm cột `cot_bang_chung` và ràng buộc duy nhất `(nguồn, đích, loại, dòng, cột)` với giá trị rỗng so như −1; spec chỉ có `evidence {file, line}` nên cần bổ sung cột để hai lời gọi cùng dòng không bị gộp |
| Đường dẫn trong khóa | Chỉ đường dẫn tương đối (đúng id của spec); không lưu đường dẫn gốc trong CSDL đồ thị, để index mang đi được |
| Ghi chú độ phủ | Bảng LỖI PHÂN TÍCH riêng (một tệp có nhiều lỗi → không để mảng trong một cột, giữ dạng chuẩn 1) |
| Tham chiếu chưa phân giải | Bảng riêng với trạng thái `cho/that_bai`, xóa theo nút nguồn; dùng cho lập chỉ mục hai giai đoạn |
| Tìm kiếm | Bảng ảo FTS5 và một cột từ khóa đã tách camelCase (camelCase thường bị coi là một từ) |
| Dữ liệu suy ra | **Không lưu** vùng ảnh hưởng, rủi ro, bước tham quan (tính khi cần, spec §5.6, §5.9). Chỉ lưu kết quả cụm hóa vì tốn thời gian tính |
| Phiên bản schema | `PRAGMA user_version` + cột trong DỰ ÁN; không dùng bảng khóa–giá trị |
| Chat | Khung 1–n–n (dự án → hội thoại → tin nhắn) và `thu_tu`; thay cột JSON bằng bảng TRÍCH DẪN |


## 2. CSDL đồ thị (`.nexgraph/graph.db`)

Kiểu dữ liệu dùng tên logic của môn học; ghi chú kiểu SQLite khi cài đặt: số nguyên → INTEGER, thời điểm → INTEGER (epoch), văn bản → TEXT, logic → INTEGER 0/1 có CHECK.

| Thực thể | Thuộc tính (khóa chính gạch dưới) | Ghi chú |
|---|---|---|
| DỰ ÁN (1 dòng) | <u>ma_du_an</u> (UUID), ten, co_git, phien_ban_schema, tao_luc | Không lưu đường dẫn gốc |
| LẦN LẬP CHỈ MỤC | <u>ma_lan</u>, loai (day_du/tang_dan), trang_thai (cho/cau_truc/phan_giai/hoan_tat/loi/huy), bat_dau_luc, ket_thuc_luc, so_tep_xu_ly, so_tep_tong, commit_sha, thong_bao_loi | commit_sha rỗng khi không có Git |
| TỆP | <u>ma_tep</u>, duong_dan_tuong_doi (duy nhất), ngon_ngu, kich_thuoc, mtime, ma_bam (SHA-256), la_kiem_thu, la_tep_sinh_tu_dong, ma_lan | `ma_lan` = lần xử lý gần nhất; không lưu `so_nut` (suy ra) |
| LỖI PHÂN TÍCH | <u>ma_loi</u>, ma_tep, loai (parse_partial/parse_unusable/read/extract/oversized), chi_tiet | Duy nhất theo (ma_tep, loai) |
| KHỐI KIẾN TRÚC | <u>ma_khoi</u>, ten, ma_khoi_cha, do_gan_ket, mo_ta, nguon_mo_ta (mau/ai) | Chỉ lưu khối **cộng đồng** do gom cụm sinh ra; có cha–con (phản thân). Khối thư mục/module suy ra từ đường dẫn tệp (xem `...-chuan-hoa.md` §1.3) |
| NÚT | <u>ma_nut</u>, id_nut (duy nhất, `rel::QN#kind`), loai_nut (17 giá trị NodeKind), nhan, ten_day_du, dong_bat_dau, dong_ket_thuc, la_kiem_thu, nguon_goc (ast/resolver/llm), chu_ky, tai_lieu, ma_tep, ma_khoi | `ma_tep` rỗng cho repository/directory; **không có `language`** (xem §4) |
| CẠNH | <u>ma_canh</u>, ma_nut_nguon, ma_nut_dich, loai_canh (14 giá trị EdgeType), loai_con, muc_tin_cay (EXTRACTED/INFERRED/AMBIGUOUS), diem_tin_cay, nguon_goc, dong_bang_chung, cot_bang_chung | Tệp bằng chứng = tệp của nút nguồn (xem §4) |
| THAM CHIẾU CHƯA PHÂN GIẢI | <u>ma_tc</u>, ma_nut_nguon, ten_tham_chieu, loai_tham_chieu, dong, cot, trang_thai (cho/that_bai) | |

Mối kết hợp (bản số kiểu (tối thiểu, tối đa) như giáo trình):

| Mối kết hợp | Bên A | Bên B |
|---|---|---|
| DỰ ÁN – có – LẦN LẬP CHỈ MỤC | LẦN (1,1) | DỰ ÁN (0,n) |
| LẦN – xử lý – TỆP | TỆP (1,1) | LẦN (0,n) |
| TỆP – gặp – LỖI PHÂN TÍCH | LỖI (1,1) | TỆP (0,n) |
| TỆP – chứa – NÚT | NÚT (0,1) | TỆP (0,n) |
| KHỐI – gồm – NÚT | NÚT (0,1) | KHỐI (0,n) |
| KHỐI – có cha – KHỐI | con (0,1) | cha (0,n) |
| NÚT – là nguồn của – CẠNH | CẠNH (1,1) | NÚT (0,n) |
| NÚT – là đích của – CẠNH | CẠNH (1,1) | NÚT (0,n) |
| NÚT – xuất phát – THAM CHIẾU CHƯA PHÂN GIẢI | THAM CHIẾU (1,1) | NÚT (0,n) |

Ràng buộc chính: `UNIQUE(ma_nut_nguon, ma_nut_dich, loai_canh, IFNULL(dong,-1), IFNULL(cot,-1))`; `ON DELETE CASCADE` từ TỆP → NÚT → CẠNH / THAM CHIẾU / LỖI; `PRAGMA foreign_keys=ON` ở mọi kết nối (SQLite tắt mặc định); `dong_ket_thuc >= dong_bat_dau`; nút mã nguồn (class/function/method/widget…) bắt buộc có dòng.

Bảng ảo: `nut_fts` (FTS5) do bộ lập chỉ mục nạp từ khóa đã tách camelCase khi ghi nút; không thuộc mô hình thực thể và không có cột tương ứng trong NÚT.

## 3. CSDL cá nhân (thư mục dữ liệu của app)

| Thực thể | Thuộc tính | Ghi chú |
|---|---|---|
| DỰ ÁN ĐÃ MỞ | <u>ma_du_an</u> (cùng UUID), duong_dan_tuyet_doi (duy nhất), ten, noi_luu (trong_du_an/thu_muc_app), mo_lan_cuoi | |
| KẾT NỐI AI | <u>ma_ket_noi</u>, loai (acp/api_key), ten_hien_thi, ten_agent, base_url, ten_model, muc_keychain, la_mac_dinh | CHECK theo loại: acp cần `ten_agent`; api_key cần `base_url`, `ten_model`, `muc_keychain`. **Khóa API không vào CSDL** |
| ĐỒNG Ý GỬI DỮ LIỆU | <u>ma_du_an, ma_ket_noi</u>, dong_y_luc | Mối kết hợp nhiều–nhiều có thuộc tính (spec §5.8) |
| PHIÊN CHAT | <u>ma_phien</u>, ma_du_an, ma_ket_noi (cho phép rỗng), tieu_de, tao_luc, cap_nhat_luc | |
| TIN NHẮN | <u>ma_tin</u>, ma_phien, thu_tu, vai_tro, noi_dung, tao_luc | `UNIQUE(ma_phien, thu_tu)` |
| TRÍCH DẪN | <u>ma_trich_dan</u>, ma_tin, duong_dan_tuong_doi, dong_bat_dau, dong_ket_thuc, trang_thai (da_xac_minh/chua_xac_minh) | Ánh xạ sang nút khi hiển thị, không lưu `id_nut` (đã bỏ khi chuẩn hóa) |
| ĐOẠN MÃ ĐÃ GỬI | <u>ma_doan</u>, ma_tin, duong_dan_tuong_doi, dong_bat_dau, dong_ket_thuc, ma_bam | Ghi vị trí đoạn code đã gửi cho AI trong lượt hỏi, không chép nguyên văn. `ma_bam` (SHA-256 của nội dung lúc gửi) là **bổ sung của mình**, để báo "tệp đã đổi từ lúc gửi" khi người dùng xem lại |

Cấu hình chung (ngôn ngữ, giao diện) là một bảng một dòng, không đưa vào mô hình thực thể.

## 4. Kiểm tra chuẩn hóa

Đã làm đầy đủ ở `2026-10-24-nexgraph-csdl-chuan-hoa.md` §1 (phụ thuộc hàm, khóa, BCNF). Kết quả chính: 6 hiệu chỉnh (ngôn ngữ chuyển sang TỆP; bỏ `cap` và `loai` của khối; bỏ `tu_khoa_tach`; bỏ `duoi_ten`; bỏ `id_nut` ở TRÍCH DẪN; thêm duy nhất (ma_tep, loai) cho LỖI PHÂN TÍCH). Còn hai điểm cần kiểm khi cài bộ phân tích: tệp bằng chứng của cạnh và hàm nạp chồng làm `id_nut` trùng.

## 5. Các quyết định đã chốt (người dùng, 2026-10-24)

1. Có bảng ĐOẠN MÃ ĐÃ GỬI (tin nhắn, đường dẫn, dòng), không chép nguyên văn code.
2. Không lưu phiên ACP ở MVP (thêm sau nếu cần tiếp tục hội thoại với agent).
3. Không lưu bước tham quan và vùng ảnh hưởng (tính khi cần).

Tân từ và sơ đồ thực thể kết hợp: `2026-10-24-nexgraph-csdl-tan-tu.md`, `design/diagrams/erd-do-thi.html`, `design/diagrams/erd-ca-nhan.html`.
