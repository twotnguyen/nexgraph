# NexGraph — Mô tả dữ liệu, tân từ và mô hình thực thể kết hợp (bản nháp)

> Bản nháp cho báo cáo tuần 2, chưa duyệt. Cập nhật 2026-10-24. Nền: `2026-10-24-nexgraph-csdl-design.md` (thực thể, thuộc tính, quyết định đã chốt).
> Sơ đồ: `design/diagrams/erd-do-thi.html`, `design/diagrams/erd-ca-nhan.html`.
> Văn phong dưới đây viết theo kiểu báo cáo (không nêu tên repo khác). Tên thực thể/thuộc tính viết không dấu như giáo trình (MSSV, TenKH…).

## 1. Mô tả dữ liệu cần quản lý (theo mẫu "1.1 Mô tả" của giáo trình thực hành)

NexGraph là ứng dụng máy tính cho phép người dùng mở một thư mục mã nguồn gọi là **dự án**. Hệ thống phân tích dự án và lưu kết quả thành đồ thị tri thức để phục vụ khám phá, tìm kiếm, xem vùng ảnh hưởng và hỏi đáp với trợ lý AI. Ứng dụng chạy trên một máy, một người dùng, không có đăng nhập nên hệ thống không quản lý người dùng. Dữ liệu được chia thành hai nhóm lưu ở hai nơi khác nhau.

**Nhóm thứ nhất là dữ liệu đồ thị của từng dự án**, suy ra hoàn toàn từ mã nguồn và lưu ngay trong dự án, mỗi dự án một cơ sở dữ liệu. Mỗi dự án được cấp một mã định danh ngẫu nhiên khi mở lần đầu. Mỗi lần người dùng yêu cầu lập chỉ mục, hệ thống ghi nhận một **lần lập chỉ mục** gồm loại (đầy đủ hoặc tăng dần), trạng thái, thời điểm bắt đầu và kết thúc, số tệp đã xử lý và mã commit của Git tại thời điểm đó nếu dự án dùng Git. Trong mỗi lần lập chỉ mục, hệ thống duyệt các **tệp** mã nguồn, ghi đường dẫn tương đối, ngôn ngữ, kích thước, thời điểm sửa, mã băm nội dung (để lần sau chỉ xử lý tệp đã đổi), và đánh dấu tệp kiểm thử hoặc tệp sinh tự động. Tệp phân tích chưa trọn vẹn thì hệ thống ghi một hay nhiều **lỗi phân tích** kèm loại lỗi và chi tiết.

Từ mỗi tệp, hệ thống trích ra các **nút**: lớp, hàm, widget, màn hình, gói… Mỗi nút có định danh có cấu trúc duy nhất trong dự án, loại nút, nhãn hiển thị, tên đầy đủ, vị trí dòng bắt đầu và kết thúc, nguồn gốc (cây cú pháp, bộ phân giải hoặc mô hình ngôn ngữ), chữ ký và tài liệu mô tả nếu có. Giữa các nút có các **cạnh** có hướng thuộc nhiều loại (gọi hàm, khai báo import, kế thừa, kiểm thử, điều hướng…). Hai nút có thể nối với nhau bằng nhiều cạnh khác loại hoặc khác vị trí. Mỗi cạnh ghi mức tin cậy và điểm tin cậy, nguồn gốc, dòng và cột trong mã nguồn làm bằng chứng. Khi một lời gọi chưa tìm được nút đích ở giai đoạn đầu, hệ thống ghi lại thành **tham chiếu chưa phân giải** để xử lý ở giai đoạn sau. Các nút được gom thành **khối kiến trúc**: mỗi khối là một cộng đồng các nút do thuật toán gom cụm tạo ra (khối theo thư mục hoặc theo module suy ra từ đường dẫn tệp khi cần nên không lưu); khối có thể nằm trong khối khác.

**Nhóm thứ hai là dữ liệu cá nhân của người dùng**, lưu trong thư mục dữ liệu của ứng dụng vì có thể chứa đoạn mã đã gửi cho AI. Ứng dụng nhớ các **dự án đã mở** (đường dẫn tuyệt đối, nơi lưu dữ liệu đồ thị, lần mở cuối). Người dùng cấu hình một hay nhiều **kết nối AI**, hoặc là trợ lý cục bộ điều khiển qua giao thức ACP, hoặc là dịch vụ tương thích OpenAI dùng khóa API; khóa API được lưu ở kho khóa của hệ điều hành, không lưu trong cơ sở dữ liệu. Trước lần gọi AI đầu tiên của một dự án với một kết nối, người dùng phải **đồng ý gửi dữ liệu** và hệ thống ghi lại thời điểm đồng ý. Người dùng trao đổi với AI qua các **phiên chat** thuộc một dự án, mỗi phiên gồm nhiều **tin nhắn** theo thứ tự. Câu trả lời của AI có thể kèm các **trích dẫn** dạng đường dẫn và khoảng dòng, mỗi trích dẫn được kiểm tra là đã xác minh hoặc chưa xác minh. Với mỗi lượt hỏi, hệ thống ghi lại các **đoạn mã đã gửi** (đường dẫn, khoảng dòng, mã băm lúc gửi) để người dùng xem lại đã gửi gì.

Vùng ảnh hưởng, bước tham quan, bản đồ kiến trúc dạng mũi tên giữa các khối và điểm rủi ro đều suy ra từ đồ thị khi cần nên không lưu thành bảng riêng.

## 2. Tân từ các lược đồ quan hệ

Quy ước: khóa chính gạch dưới (ở đây viết **đậm**); khóa ngoại đánh dấu (FK). "Duy nhất" nghĩa là khóa dự tuyển. Kiểu, độ rộng và giải thích sẽ lập ở bước kế tiếp (từ điển dữ liệu).

### 2.1 CSDL đồ thị (`.nexgraph/graph.db`)

1. **DU_AN(<u>ma_du_an</u>, ten, co_git, phien_ban_schema, tao_luc)**
   Tân từ: Mỗi dự án có một mã định danh ngẫu nhiên (ma_du_an) để phân biệt với các dự án khác, có tên (ten), cho biết có dùng Git hay không (co_git), phiên bản cấu trúc dữ liệu đang dùng (phien_ban_schema) và thời điểm tạo (tao_luc). Cơ sở dữ liệu này chỉ chứa đúng một dự án nên quan hệ chỉ có một bộ; không lưu đường dẫn gốc để thư mục dự án có thể đổi tên hoặc di chuyển.

2. **LAN_LAP_CHI_MUC(<u>ma_lan</u>, ma_du_an (FK), loai, trang_thai, bat_dau_luc, ket_thuc_luc, so_tep_xu_ly, so_tep_tong, commit_sha, thong_bao_loi)**
   Tân từ: Mỗi lần lập chỉ mục có một số thứ tự (ma_lan) để phân biệt, thuộc về một dự án. Loại (loai) chỉ nhận một trong hai giá trị đầy đủ hoặc tăng dần; trạng thái (trang_thai) nhận một trong các giá trị chờ, cấu trúc, phân giải, hoàn tất, lỗi, hủy. Thời điểm kết thúc chỉ có khi lần lập chỉ mục đã dừng. Mã commit chỉ có khi dự án dùng Git. Thông báo lỗi chỉ có khi trạng thái là lỗi. Số tệp đã xử lý không vượt quá tổng số tệp.

3. **TEP(<u>ma_tep</u>, duong_dan_tuong_doi, ngon_ngu, kich_thuoc, mtime, ma_bam, la_kiem_thu, la_tep_sinh_tu_dong, ma_lan (FK))**
   Tân từ: Mỗi tệp có một mã số (ma_tep) để phân biệt; đường dẫn tương đối so với thư mục dự án (duong_dan_tuong_doi, dùng dấu `/` trên mọi hệ điều hành) cũng phân biệt các tệp với nhau. Tệp có ngôn ngữ, kích thước, thời điểm sửa và mã băm SHA-256 của nội dung; mã băm cùng kích thước và thời điểm sửa cho biết tệp có đổi từ lần trước hay không. Tệp có thể là tệp kiểm thử hoặc tệp sinh tự động. Mỗi tệp được ghi nhận bởi đúng một lần lập chỉ mục, là lần gần nhất xử lý tệp đó.

4. **LOI_PHAN_TICH(<u>ma_loi</u>, ma_tep (FK), loai, chi_tiet)**
   Tân từ: Mỗi lỗi phân tích có một mã số (ma_loi), xảy ra ở đúng một tệp; một tệp có thể có nhiều lỗi khác loại hoặc không có lỗi nào, mỗi loại lỗi tối đa một lần cho một tệp. Loại lỗi nhận một trong năm giá trị: phân tích một phần, không dùng được, không đọc được, không trích xuất được, quá lớn. Chi tiết là khoảng dòng gặp lỗi hoặc lý do bỏ qua tệp.

5. **KHOI_KIEN_TRUC(<u>ma_khoi</u>, ten, ma_khoi_cha (FK), do_gan_ket, mo_ta, nguon_mo_ta)**
   Tân từ: Mỗi khối kiến trúc có một mã số (ma_khoi) và một tên. Khối kiến trúc là một cộng đồng các nút do thuật toán gom cụm tạo ra; khối theo thư mục hoặc module không lưu mà suy ra từ đường dẫn tệp. Một khối có thể nằm trong tối đa một khối cha và chứa nhiều khối con; khối gốc không có khối cha, cấp của khối được tính từ chuỗi khối cha. Độ gắn kết là điểm của thuật toán gom cụm. Mô tả và nguồn mô tả (mẫu hoặc AI viết lại) cùng có hoặc cùng không có.

6. **NUT(<u>ma_nut</u>, id_nut, loai_nut, nhan, ten_day_du, dong_bat_dau, dong_ket_thuc, la_kiem_thu, nguon_goc, chu_ky, tai_lieu, ma_tep (FK), ma_khoi (FK))**
   Tân từ: Mỗi nút có một mã số (ma_nut) và một định danh có cấu trúc duy nhất trong dự án (id_nut) theo dạng đường dẫn tương đối, tên đầy đủ và loại nút; id_nut không chứa số dòng nên không đổi khi thêm dòng phía trên. Loại nút thuộc một trong 17 giá trị (repository, package, directory, file, module, class, mixin, enum, extension, function, method, test, widget, screen, route, document, concept). Nút thuộc các loại mã nguồn (class, mixin, enum, extension, function, method, test, widget, screen, route) bắt buộc có dòng bắt đầu và dòng kết thúc, và dòng kết thúc không nhỏ hơn dòng bắt đầu. Nút nằm trong tối đa một tệp (nút repository và directory không thuộc tệp nào) và thuộc tối đa một khối kiến trúc. Ngôn ngữ của nút được xác định qua tệp chứa nó. Nguồn gốc nhận một trong ba giá trị ast, resolver, llm.

7. **CANH(<u>ma_canh</u>, ma_nut_nguon (FK), ma_nut_dich (FK), loai_canh, loai_con, muc_tin_cay, diem_tin_cay, nguon_goc, dong_bang_chung, cot_bang_chung)**
   Tân từ: Mỗi cạnh có một mã số (ma_canh), đi từ đúng một nút nguồn đến đúng một nút đích. Loại cạnh nhận một trong 14 giá trị (CONTAINS, DEFINES, CALLS, IMPORTS, INHERITS, IMPLEMENTS, REFERENCES, USES_TYPE, TESTED_BY, DOCUMENTS, DEPENDS_ON, SEMANTIC_RELATED, COMPOSES, NAVIGATES_TO); loại con giữ tên quan hệ gốc nếu có. Hai nút có thể có nhiều cạnh, nhưng không có hai cạnh trùng cùng nút nguồn, nút đích, loại cạnh, dòng và cột bằng chứng. Mức tin cậy nhận một trong ba giá trị EXTRACTED, INFERRED, AMBIGUOUS; điểm tin cậy nằm trong đoạn [0, 1]. Dòng và cột bằng chứng cho biết nơi trong tệp của nút nguồn mà quan hệ được nhìn thấy; cạnh cấu trúc như CONTAINS có thể không có.

8. **THAM_CHIEU_CHUA_PHAN_GIAI(<u>ma_tc</u>, ma_nut_nguon (FK), ten_tham_chieu, loai_tham_chieu, dong, cot, trang_thai)**
   Tân từ: Mỗi tham chiếu chưa phân giải có một mã số (ma_tc), xuất phát từ đúng một nút nguồn, ghi tên đang tham chiếu (vd. `Navigator.push`), loại tham chiếu tương ứng với một loại cạnh, và vị trí dòng, cột. Trạng thái là chờ hoặc thất bại (đã thử, chưa có nút phù hợp, được thử lại khi có tệp mới). Khi nút nguồn bị xóa thì tham chiếu bị xóa theo; khi phân giải thành công thì tham chiếu bị xóa và cạnh tương ứng được tạo.

### 2.2 CSDL cá nhân (thư mục dữ liệu ứng dụng)

9. **DU_AN_DA_MO(<u>ma_du_an</u>, duong_dan_tuyet_doi, ten, noi_luu, mo_lan_cuoi)**
   Tân từ: Mỗi dự án đã mở có mã định danh (ma_du_an) trùng với mã trong cơ sở dữ liệu đồ thị của dự án đó, và một đường dẫn tuyệt đối duy nhất. Nơi lưu cho biết dữ liệu đồ thị nằm trong thư mục dự án hay trong thư mục ứng dụng (khi thư mục dự án không ghi được). Lần mở cuối dùng để sắp xếp danh sách.

10. **KET_NOI_AI(<u>ma_ket_noi</u>, loai, ten_hien_thi, ten_agent, base_url, ten_model, muc_keychain, la_mac_dinh)**
    Tân từ: Mỗi kết nối AI có một mã số (ma_ket_noi) và tên hiển thị. Loại là acp hoặc api_key. Kết nối acp bắt buộc có tên trợ lý cục bộ (ten_agent); kết nối api_key bắt buộc có địa chỉ dịch vụ, tên mô hình và tên mục trong kho khóa hệ điều hành, còn bản thân khóa không được lưu ở đây. Tối đa một kết nối là mặc định.

11. **DONG_Y_GUI_DU_LIEU(<u>ma_du_an (FK), ma_ket_noi (FK)</u>, dong_y_luc)**
    Tân từ: Mỗi bộ ghi nhận rằng người dùng đã đồng ý cho gửi mã nguồn của một dự án tới một kết nối AI, vào thời điểm dong_y_luc. Mỗi cặp dự án và kết nối chỉ có tối đa một bộ.

12. **PHIEN_CHAT(<u>ma_phien</u>, ma_du_an (FK), ma_ket_noi (FK), tieu_de, tao_luc, cap_nhat_luc)**
    Tân từ: Mỗi phiên chat có một mã số (ma_phien) và thuộc đúng một dự án đã mở. Phiên ghi lại kết nối AI đang dùng; nếu kết nối bị xóa thì phiên vẫn còn nhưng không còn kết nối. Thời điểm cập nhật không nhỏ hơn thời điểm tạo.

13. **TIN_NHAN(<u>ma_tin</u>, ma_phien (FK), thu_tu, vai_tro, noi_dung, tao_luc)**
    Tân từ: Mỗi tin nhắn có một mã số (ma_tin), thuộc đúng một phiên chat và có thứ tự riêng trong phiên đó; hai tin nhắn trong cùng một phiên không trùng thứ tự. Vai trò là người dùng hoặc trợ lý. Xóa phiên thì xóa mọi tin nhắn của phiên.

14. **TRICH_DAN(<u>ma_trich_dan</u>, ma_tin (FK), duong_dan_tuong_doi, dong_bat_dau, dong_ket_thuc, trang_thai)**
    Tân từ: Mỗi trích dẫn có một mã số, thuộc đúng một tin nhắn của trợ lý, chỉ tới một khoảng dòng trong một tệp của dự án. Trạng thái là đã xác minh (tệp tồn tại và khoảng dòng hợp lệ) hoặc chưa xác minh. Trích dẫn được ánh xạ sang nút của đồ thị khi hiển thị (theo đường dẫn và khoảng dòng) chứ không lưu định danh nút, vì đồ thị đổi sau mỗi lần lập chỉ mục.

15. **DOAN_MA_DA_GUI(<u>ma_doan</u>, ma_tin (FK), duong_dan_tuong_doi, dong_bat_dau, dong_ket_thuc, ma_bam)**
    Tân từ: Mỗi đoạn mã đã gửi có một mã số (ma_doan), thuộc đúng một tin nhắn của người dùng, ghi vị trí đoạn mã trong tệp (đường dẫn và khoảng dòng) và mã băm SHA-256 của nội dung tại lúc gửi. Mã băm cho phép báo tệp đã thay đổi kể từ lúc gửi; nội dung đoạn mã được đọc lại từ tệp, không lưu bản sao.

## 3. Mối kết hợp và bản số

Đọc bản số theo quy ước của giáo trình: cặp (tối thiểu, tối đa) cạnh một loại thực thể là số lần một thể hiện của loại thực thể đó tham gia mối kết hợp.

### 3.1 CSDL đồ thị

| Mối kết hợp | Bản số | Diễn giải |
|---|---|---|
| DU_AN – có – LAN_LAP_CHI_MUC | DU_AN (0,n); LAN (1,1) | Một dự án có nhiều lần lập chỉ mục; mỗi lần thuộc một dự án |
| LAN_LAP_CHI_MUC – xử lý – TEP | LAN (0,n); TEP (1,1) | Mỗi tệp thuộc về lần xử lý gần nhất |
| TEP – gặp – LOI_PHAN_TICH | TEP (0,n); LOI (1,1) | |
| TEP – chứa – NUT | TEP (0,n); NUT (0,1) | Nút repository, directory không thuộc tệp nào |
| KHOI_KIEN_TRUC – gồm – NUT | KHOI (0,n); NUT (0,1) | |
| KHOI_KIEN_TRUC – có cha – KHOI_KIEN_TRUC (phản thân) | cha (0,n); con (0,1) | |
| NUT – là nguồn của – CANH | NUT (0,n); CANH (1,1) | |
| NUT – là đích của – CANH | NUT (0,n); CANH (1,1) | Hai mối kết hợp riêng giữa NUT và CANH vì cạnh có hướng |
| NUT – xuất phát – THAM_CHIEU_CHUA_PHAN_GIAI | NUT (0,n); THAM_CHIEU (1,1) | |

### 3.2 CSDL cá nhân

| Mối kết hợp | Bản số | Diễn giải |
|---|---|---|
| DU_AN_DA_MO – có – PHIEN_CHAT | DU_AN_DA_MO (0,n); PHIEN (1,1) | |
| KET_NOI_AI – dùng trong – PHIEN_CHAT | KET_NOI (0,n); PHIEN (0,1) | Kết nối bị xóa thì phiên giữ lại, không còn kết nối |
| PHIEN_CHAT – gồm – TIN_NHAN | PHIEN (0,n); TIN (1,1) | |
| TIN_NHAN – dẫn – TRICH_DAN | TIN (0,n); TRICH_DAN (1,1) | |
| TIN_NHAN – gửi – DOAN_MA_DA_GUI | TIN (0,n); DOAN (1,1) | |
| DU_AN_DA_MO – đồng ý với – KET_NOI_AI | DU_AN_DA_MO (0,n); KET_NOI (0,n) | Mối kết hợp nhiều–nhiều có thuộc tính dong_y_luc; chuyển thành quan hệ DONG_Y_GUI_DU_LIEU |

## 4. Việc kế tiếp
1. Duyệt sơ đồ thực thể kết hợp (hai tệp HTML).
2. Từ điển dữ liệu: kiểu, độ rộng, giải thích lý do chọn (câu hỏi 1 của bài thực hành).
3. Ràng buộc toàn vẹn (RBTV) có bối cảnh một và nhiều quan hệ; phụ thuộc hàm, khóa, chuẩn hóa BCNF.
4. Script SQL (SQLite) và kiểm thử bằng dữ liệu mẫu.
5. Phân tích chức năng: các sơ đồ UML (hoạt động, tuần tự, lớp) cho UC01–UC11.

---

## Phụ lục: lược đồ phiên bản 2 (2026-10-27, kế hoạch con 4)

Cộng thêm, không sửa các quan hệ ở trên:

16. **KIEU_BIEN(<u>ma_nut (FK)</u>, <u>ten</u>, kieu)** — kiểu khai báo của biến/tham số/trường theo nút khai báo. Mỗi bộ mô tả một tên khai báo trong phạm vi một nút; (`ma_nut`, `ten`) là khóa; xóa nút thì xóa các bộ này. Dùng để nối lại tham chiếu chưa phân giải khi cập nhật tăng dần.
17. **MOC_TEP(<u>duong_dan_tuong_doi</u>, ma_bam)** — mã băm SHA-256 của từng tệp tại lần lập chỉ mục đầy đủ gần nhất; mốc so sánh khi dự án không có Git. Không có khóa ngoại để mốc sống độc lập với `TEP` (tệp bị xóa ở lần cập nhật tăng dần vẫn còn trong mốc).
- Thuộc tính mới của LAN_LAP_CHI_MUC: `thu_muc_con` (có thể rỗng) — thư mục con của dự án mà lần lập chỉ mục bị giới hạn.
