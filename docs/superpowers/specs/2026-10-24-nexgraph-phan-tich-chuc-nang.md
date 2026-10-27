# NexGraph — Phân tích chức năng và hồ sơ UML (bản nháp cho báo cáo tuần 2)

> Bản nháp chờ người dùng duyệt. Cập nhật 2026-10-24. Nền: spec (§3.1 use case, §4 tính năng, §5 kiến trúc), báo cáo tuần 1 (Bảng 2.2, 2.3), hợp đồng API engine v1 trong `plans/2026-10-18-nexgraph-roadmap.md`, CSDL trong `2026-10-24-nexgraph-csdl-*.md`.
> Tên lớp, thành phần ở §3 (sơ đồ lớp thiết kế) là **đề xuất mức thiết kế**; spec giao việc chốt tên chính xác cho người cài đặt.
> Không đưa tên repo khác vào báo cáo nộp.

## 1. Mô hình hóa chức năng

### 1.1 Tác nhân

| Tác nhân | Loại | Vai trò |
|---|---|---|
| Lập trình viên | Chính | Mở dự án, khám phá, tìm kiếm, xem vùng ảnh hưởng, hỏi đáp, cấu hình |
| Trợ lý AI cục bộ / Nhà cung cấp AI | Hệ thống ngoài | Sinh câu trả lời cho UC07 (trợ lý trên máy qua ACP hoặc dịch vụ qua khóa API) |
| Trợ lý AI bên ngoài | Hệ thống ngoài | Tra cứu đồ thị qua MCP (UC10), kể cả khi ứng dụng đã đóng |

Hệ thống không có tác nhân "quản trị" hay "người dùng đăng nhập": ứng dụng chạy trên một máy, một người dùng, không tài khoản.

### 1.2 Quan hệ giữa các use case (hình use case chi tiết)

| Use case | Quan hệ | Use case/chức năng liên quan | Ý nghĩa |
|---|---|---|---|
| UC01 Mở dự án và lập chỉ mục | include | Chọn thư mục dự án; Lập chỉ mục giai đoạn 1; Lập chỉ mục giai đoạn 2 | Ba bước luôn xảy ra |
| UC01 | extend | Hủy lập chỉ mục; Tự cập nhật khi tệp đổi | Xảy ra tùy tình huống |
| UC02 Xem bản đồ kiến trúc | extend | Xem bằng chứng của mũi tên | Chọn một mũi tên giữa hai khối |
| UC05 Xem mã của nút | extend | UC03, UC04 | Mở mã từ nút đang khám phá hoặc từ kết quả tìm kiếm |
| UC06 Xem vùng ảnh hưởng | include | Xác định ca kiểm thử liên quan | Luôn kèm test liên quan và test gap |
| UC07 Hỏi đáp với AI | include | Kiểm chứng trích dẫn; Gọi công cụ tra cứu đồ thị (cùng bộ công cụ UC10) | Luôn kiểm chứng trích dẫn và tra cứu đồ thị |
| UC07 | extend | Xác nhận gửi dữ liệu (lần đầu); Tô sáng luồng trên đồ thị | Chỉ xảy ra khi gửi lần đầu hoặc khi có luồng để tô sáng |
| UC07 | phụ thuộc | UC08 | Cần một kết nối AI đã cấu hình; không có thì hiển thị hướng dẫn |
| UC10 Truy vấn đồ thị qua MCP | include | Đọc đồ thị ở chế độ chỉ đọc | Trợ lý ngoài không ghi được dữ liệu |
| UC11 Xuất sơ đồ/báo cáo | extend | UC02, UC03 | Xuất hình đang hiển thị |

## 2. Đặc tả use case

Mỗi use case được đặc tả theo: tác nhân, mô tả, tiền điều kiện, luồng chính, luồng thay thế và ngoại lệ, hậu điều kiện, dữ liệu liên quan (bảng CSDL), hợp đồng API. Mã F là mã chức năng ở báo cáo tuần 1.

### UC01 – Mở dự án và lập chỉ mục (F1)
- **Tác nhân:** Lập trình viên.
- **Mô tả:** Người dùng chọn một thư mục mã nguồn; hệ thống phân tích và lưu thành đồ thị.
- **Tiền điều kiện:** Engine đã khởi động (thanh trạng thái báo sẵn sàng). Thư mục tồn tại và đọc được.
- **Luồng chính:** (1) Người dùng chọn "Mở thư mục" và chọn thư mục. (2) Ứng dụng gửi yêu cầu đăng ký dự án (`POST /v1/projects`); engine kiểm tra thư mục, xác định có dùng Git không, đọc `.gitignore`. (3) Engine tạo `.nexgraph/` (kèm `.nexgraph/.gitignore` chứa `*`) và `graph.db`; ghi dự án vào danh sách dự án đã mở. (4) Ứng dụng yêu cầu lập chỉ mục (`POST /v1/projects/{pid}/index`), nhận mã công việc. (5) Giai đoạn 1: engine liệt kê tệp, bỏ tệp theo `.gitignore`, tệp sinh tự động, thư mục build; phân tích cấu trúc (tệp, lớp, hàm, widget, import) và ghi vào CSDL; đẩy tiến độ qua sự kiện. (6) Ứng dụng mở màn hình làm việc; người dùng khám phá được ngay. (7) Giai đoạn 2 chạy nền: phân giải lời gọi, điều hướng, kiểm thử, gom cộng đồng; giao diện cập nhật dần. (8) Công việc kết thúc ở trạng thái hoàn tất.
- **Luồng thay thế / ngoại lệ:** (a) Thư mục dự án không ghi được → lưu dữ liệu đồ thị ở thư mục dữ liệu ứng dụng, giao diện ghi rõ nơi lưu. (b) Dự án quá lớn → cảnh báo, cho tiếp tục, hủy hoặc chọn thư mục con. (c) Người dùng hủy → công việc ở trạng thái hủy, phần đã ghi giữ lại. (d) Tệp có lỗi cú pháp → giữ phần phân tích được, ghi một bộ vào LỖI PHÂN TÍCH. (e) Không phải dự án Flutter → đồ thị chung vẫn chạy, thẻ Flutter ẩn. (f) Đang có một lần lập chỉ mục chạy → từ chối lần thứ hai (RB19).
- **Hậu điều kiện:** Có một LẦN LẬP CHỈ MỤC ở trạng thái hoàn tất; TỆP, NÚT, CẠNH, KHỐI KIẾN TRÚC được ghi; ứng dụng không sửa tệp mã nguồn nào.
- **Dữ liệu:** du_an, lan_lap_chi_muc, tep, loi_phan_tich, nut, canh, tham_chieu_chua_phan_giai, khoi_kien_truc; du_an_da_mo (CSDL cá nhân).

### UC02 – Xem bản đồ kiến trúc (F2, FL)
- **Tác nhân:** Lập trình viên. **Tiền điều kiện:** UC01 đã qua giai đoạn 1 (cộng đồng chỉ có sau giai đoạn 2).
- **Luồng chính:** (1) Người dùng chọn thẻ Kiến trúc. (2) Ứng dụng gọi `GET /architecture`. (3) Engine gom nút thành khoảng 9–12 khối mỗi màn (theo thư mục, module hoặc cộng đồng), tổng hợp cạnh thật giữa các khối thành mũi tên kèm số bằng chứng. (4) Giao diện bố trí và vẽ. (5) Người dùng chọn một khối để đi sâu hoặc chọn một mũi tên để xem bằng chứng (`GET /architecture/evidence`): danh sách vị trí tệp:dòng.
- **Ngoại lệ:** Chưa có cộng đồng → gom theo thư mục. Không có cạnh thật giữa hai khối → không vẽ mũi tên. Có AI → AI chỉ đặt tên và mô tả khối, không thêm mũi tên.
- **Hậu điều kiện:** Không ghi dữ liệu (chỉ đọc; mô tả AI nếu có được lưu ở KHỐI KIẾN TRÚC).
- **Dữ liệu:** khoi_kien_truc, nut, canh (qua v_canh_bang_chung).

### UC03 – Khám phá đồ thị (F3, FL)
- **Tác nhân:** Lập trình viên.
- **Luồng chính:** (1) Người dùng chọn một nút (từ bản đồ, tìm kiếm hoặc cây tệp). (2) Ứng dụng gọi `GET /neighbors?node&types&direction&depth`. (3) Engine trả các nút lân cận (tối đa khoảng 2.000, vượt thì gom) và cạnh. (4) Giao diện bố trí đồ thị, tô màu theo loại nút, mở thẻ thông tin (vị trí, nơi gọi, nơi được gọi, số ca kiểm thử). (5) Người dùng lọc theo loại cạnh, đổi độ sâu, chọn nút khác.
- **Ngoại lệ:** Kết quả bị cắt → `truncated=true`, giao diện báo. Dự án Flutter → thẻ Flutter hiển thị cây widget, bản đồ màn hình, thư viện.
- **Dữ liệu:** nut, canh.

### UC04 – Tìm kiếm (F4)
- **Tác nhân:** Lập trình viên.
- **Luồng chính:** (1) Người dùng nhập từ khóa, chọn bộ lọc loại. (2) Ứng dụng gọi `GET /search?q&kinds&limit`. (3) Engine tìm toàn văn (FTS5) trên nhãn, tên đầy đủ, chữ ký, tài liệu và từ khóa đã tách camelCase; xếp hạng, ưu tiên trùng tên chính xác. (4) Giao diện liệt kê kèm tệp:dòng; người dùng chọn kết quả để mở trên đồ thị hoặc xem mã (UC05).
- **Ngoại lệ:** Không có kết quả → thông báo, gợi ý bỏ bộ lọc. Chỉ mục tìm kiếm chưa sẵn → kết quả từ giai đoạn 1.
- **Dữ liệu:** nut, nut_fts.

### UC05 – Xem mã của nút (F3)
- **Tác nhân:** Lập trình viên. **Tiền điều kiện:** có một nút hoặc một trích dẫn được chọn.
- **Luồng chính:** (1) Ứng dụng gọi `GET /code?file&start&end`. (2) Engine đọc đoạn mã từ tệp (chỉ đọc) và trả kèm ngôn ngữ. (3) Giao diện mở tệp ở thẻ riêng, tô sáng khoảng dòng.
- **Ngoại lệ:** Tệp đã đổi hoặc bị xóa so với lần lập chỉ mục → báo "tệp đã thay đổi", đề nghị lập chỉ mục lại. Tệp ngoài thư mục dự án → từ chối.
- **Dữ liệu:** tep, nut.

### UC06 – Xem vùng ảnh hưởng khi sửa mã (F6)
- **Tác nhân:** Lập trình viên.
- **Luồng chính:** (1) Người dùng sửa và lưu một hàm ở trình soạn thảo ngoài. (2) Tiến trình chính phát hiện tệp đổi (sau khoảng chờ gộp sự kiện) và yêu cầu lập chỉ mục tăng dần. (3) Engine so mã băm, phân tích lại tệp đổi và cập nhật đồ thị; phát sự kiện `changes_updated`. (4) Ứng dụng gọi `GET /changes`. (5) Engine lấy các đoạn dòng bị sửa (`git diff` với HEAD), ánh xạ sang nút theo khoảng dòng. (6) Engine lan truyền ngược theo cạnh với trọng số theo loại cạnh, hệ số suy giảm và giới hạn độ sâu. (7) Engine xác định ca kiểm thử liên quan (kiểm thử trực tiếp và của nơi gọi trong hai bước) và đánh dấu hàm đổi mà không có kiểm thử (test gap). (8) Giao diện hiển thị danh sách bị ảnh hưởng kèm điểm, số bước, test liên quan.
- **Luồng thay thế:** Dự án không dùng Git → so với trạng thái lần lập chỉ mục gần nhất (mã băm), giao diện ghi "không có Git: so với lần lập chỉ mục trước".
- **Ngoại lệ:** Không có thay đổi → thông báo "chưa có thay đổi". Ứng dụng chỉ đọc Git, không bao giờ ghi.
- **Dữ liệu:** tep (ma_bam, mtime), nut (dong_bat_dau, dong_ket_thuc), canh, lan_lap_chi_muc (commit_sha).

### UC07 – Hỏi đáp với trợ lý AI (F5, F8)
- **Tác nhân:** Lập trình viên; Trợ lý AI cục bộ hoặc Nhà cung cấp AI.
- **Tiền điều kiện:** Dự án đã lập chỉ mục; có một kết nối AI (UC08).
- **Luồng chính:** (1) Người dùng nhập câu hỏi. (2) Nếu là lần đầu gửi mã của dự án này tới kết nối này, ứng dụng hiện thông báo và xin đồng ý; ghi ĐỒNG Ý GỬI DỮ LIỆU. (3) Tiến trình chính gửi câu hỏi tới trợ lý (ACP hoặc API) kèm bộ công cụ tra cứu đồ thị; với ACP, MCP của NexGraph và cấu hình chỉ đọc được truyền vào phiên. (4) Trợ lý gọi các công cụ tra cứu (tìm kiếm, nút, lân cận, vùng ảnh hưởng, kiến trúc, đọc mã, truy vết luồng); mọi yêu cầu quyền ghi tệp hoặc chạy lệnh bị từ chối. (5) Trợ lý trả lời kèm trích dẫn `đường dẫn:dòng đầu–dòng cuối`. (6) Ứng dụng kiểm tra từng trích dẫn (tệp tồn tại, khoảng dòng hợp lệ); hợp lệ thành chip chọn được, không hợp lệ bị gạch và gắn "chưa xác minh". (7) Ứng dụng ánh xạ trích dẫn hợp lệ sang nút và tìm đường nối chỉ qua cạnh thật (`POST /paths`); có đường thì tô sáng, không có thì chỉ tô nút. (8) Ứng dụng lưu phiên, tin nhắn, trích dẫn và các đoạn mã đã gửi.
- **Ngoại lệ:** (a) Chưa có kết nối AI → hướng dẫn cấu hình, các chức năng khác vẫn chạy. (b) Người dùng từ chối gửi dữ liệu → không gửi, kết thúc. (c) Trợ lý không trả lời hoặc lỗi → thông báo lỗi, giữ câu hỏi để gửi lại. (d) Không đảm bảo được chế độ chỉ đọc với trợ lý cục bộ → ghi "chế độ hạn chế yếu", ưu tiên đường API.
- **Hậu điều kiện:** PHIÊN CHAT, TIN NHẮN, TRÍCH DẪN, ĐOẠN MÃ ĐÃ GỬI được ghi; mã nguồn không bị sửa.
- **Dữ liệu:** ket_noi_ai, dong_y_gui_du_lieu, phien_chat, tin_nhan, trich_dan, doan_ma_da_gui. Ràng buộc: RB31, RB32, RB34.

### UC08 – Cấu hình kết nối AI (F5)
- **Tác nhân:** Lập trình viên.
- **Luồng chính:** (1) Người dùng mở Cài đặt, chọn loại kết nối: trợ lý cục bộ (agent chạy qua ACP) hoặc khóa API. (2) Nhập thông tin (tên trợ lý; hoặc địa chỉ dịch vụ, tên mô hình, khóa). (3) Tiến trình chính lưu khóa vào kho khóa hệ điều hành và ghi KẾT NỐI AI với tên mục kho khóa. (4) Ứng dụng kiểm tra kết nối (khởi tạo ACP hoặc gọi liệt kê mô hình). (5) Hiển thị kết quả và phiên bản trợ lý.
- **Ngoại lệ:** Kiểm tra lỗi → báo lỗi và gợi ý (sai khóa, sai địa chỉ, chưa cài trợ lý), vẫn cho lưu. Đặt làm mặc định khi đã có mặc định → chuyển cờ mặc định (RB26).
- **Dữ liệu:** ket_noi_ai; khóa API chỉ ở kho khóa.

### UC09 – Tham quan dự án (F7)
- **Tác nhân:** Lập trình viên.
- **Luồng chính:** (1) Người dùng chọn thẻ Tour. (2) Ứng dụng gọi `GET /tour`. (3) Engine sinh 5–10 bước tất định từ đồ thị: điểm khởi động, các màn hình theo route, các khối lớn nhất theo độ trung tâm, các nút có nhiều phụ thuộc nhất. (4) Mỗi bước giao diện dời camera tới vùng đồ thị, mở mã và hiển thị mô tả sinh từ mẫu. (5) Người dùng chuyển bước trước/sau.
- **Ngoại lệ:** Có AI → AI chỉ viết lại mô tả cho tự nhiên; thiếu AI vẫn chạy. Không nhận ra điểm khởi động → bỏ bước đầu.
- **Dữ liệu:** nut, canh, khoi_kien_truc (không lưu bước tham quan).

### UC10 – Truy vấn đồ thị qua MCP (F8)
- **Tác nhân:** Trợ lý AI bên ngoài.
- **Tiền điều kiện:** Dự án đã được lập chỉ mục; người dùng đã sao chép cấu hình MCP từ Cài đặt vào trợ lý ngoài.
- **Luồng chính:** (1) Trợ lý ngoài khởi chạy `nexgraph-engine mcp --project <đường dẫn>` qua đầu vào/đầu ra chuẩn. (2) Engine mở `graph.db` ở chế độ chỉ đọc (WAL cho phép ứng dụng ghi song song). (3) Trợ lý gọi công cụ (search, get_node, get_neighbors, get_impact, get_architecture, read_code, trace_flow). (4) Engine truy vấn, giới hạn kích thước kết quả, báo khi bị cắt, trả về dữ liệu có cấu trúc.
- **Ngoại lệ:** Chưa lập chỉ mục → trả phản hồi thành công kèm hướng dẫn (không báo lỗi) để trợ lý không bỏ cuộc. Đường dẫn ngoài dự án → từ chối.
- **Hậu điều kiện:** Không ghi dữ liệu.
- **Dữ liệu:** graph.db (chỉ đọc).

### UC11 – Xuất sơ đồ và báo cáo (F9)
- **Tác nhân:** Lập trình viên.
- **Luồng chính:** (1) Người dùng chọn Xuất, chọn định dạng (PNG của sơ đồ đang hiển thị, Markdown tóm tắt dự án, JSON đồ thị). (2) Ứng dụng lấy dữ liệu từ engine và hiển thị hộp thoại chọn nơi lưu. (3) Ứng dụng ghi tệp tại nơi người dùng chọn.
- **Ngoại lệ:** Nơi lưu không ghi được → báo lỗi, cho chọn nơi khác. Mức ưu tiên "Có thể có": là chức năng đầu tiên bị cắt khi trễ.
- **Dữ liệu:** đọc nut, canh, khoi_kien_truc; không ghi CSDL.

## 3. Các sơ đồ UML

Bảng dưới là danh sách hình dự kiến đưa vào báo cáo (Chương 3, mục "Hồ sơ thiết kế"). Tệp nguồn ở `design/diagrams/`, ảnh ở `bao-cao/tuan-02/hinh/`.

| Hình | Loại | Nội dung | Tệp |
|---|---|---|---|
| Use case chi tiết | Use case | 11 use case, ba tác nhân, quan hệ include, extend | `uml-usecase.html` |
| Hoạt động UC01 | Hoạt động (3 làn) | Mở dự án và lập chỉ mục, rẽ nhánh dự án lớn, hai giai đoạn song song | `uml-hd-uc01.html` |
| Hoạt động UC06 | Hoạt động (3 làn) | Phát hiện thay đổi, nhánh Git hoặc không Git, lan truyền, test liên quan | `uml-hd-uc06.html` |
| Hoạt động UC07 | Hoạt động (3 làn) | Hỏi đáp: xác nhận gửi dữ liệu, tra cứu, kiểm chứng trích dẫn, tô sáng luồng | `uml-hd-uc07.html` |
| Tuần tự UC01 | Tuần tự | Giao diện, tiến trình chính, engine, CSDL, thư mục dự án | `uml-tt-uc01.html` |
| Tuần tự UC06 | Tuần tự | Sửa tệp → vùng ảnh hưởng, nhánh Git/không Git | `uml-tt-uc06.html` |
| Tuần tự UC07 | Tuần tự | Hỏi đáp qua ACP hoặc khóa API, kiểm chứng trích dẫn | `uml-tt-uc07.html` |
| Tuần tự UC08 | Tuần tự | Lưu khóa vào kho khóa, kiểm tra kết nối | `uml-tt-uc08.html` |
| Tuần tự UC10 | Tuần tự | Trợ lý ngoài gọi MCP qua stdio | `uml-tt-uc10.html` |
| Lớp thực thể | Lớp | 15 lớp thực thể ánh xạ một–một sang quan hệ CSDL | `uml-lop-thuc-the.html` |
| Lớp thiết kế | Lớp | Thành phần engine và tiến trình chính, giao diện AiAdapter | `uml-lop-thiet-ke.html` |

Quy ước vẽ: nét đen, nền trắng, in được; thuật ngữ kỹ thuật tiếng Anh giữ nguyên trên hình; nội dung tiếng Việt.

## 4. Truy vết yêu cầu → thiết kế → dữ liệu

| UC | Chức năng | Sơ đồ | Bảng chính | Hợp đồng API v1 |
|---|---|---|---|---|
| UC01 | F1 | AD UC01, SD UC01 | du_an, lan_lap_chi_muc, tep, nut, canh | POST /projects, POST /projects/{pid}/index, GET /jobs/{id}, GET /events |
| UC02 | F2, FL | Use case | khoi_kien_truc, nut, canh | GET /architecture, /architecture/evidence |
| UC03 | F3, FL | Use case | nut, canh | GET /neighbors, /nodes/{id}, /flutter/* |
| UC04 | F4 | Use case | nut, nut_fts | GET /search |
| UC05 | F3 | Use case | tep, nut | GET /code |
| UC06 | F6 | AD UC06, SD UC06 | tep, nut, canh, lan_lap_chi_muc | GET /changes |
| UC07 | F5, F8 | AD UC07, SD UC07 | phien_chat, tin_nhan, trich_dan, doan_ma_da_gui, dong_y_gui_du_lieu | POST /paths + công cụ MCP |
| UC08 | F5 | SD UC08 | ket_noi_ai | (cục bộ, không qua engine) |
| UC09 | F7 | Use case | nut, canh, khoi_kien_truc | GET /tour |
| UC10 | F8 | SD UC10 | graph.db (chỉ đọc) | công cụ MCP qua stdio |
| UC11 | F9 | Use case | — | (đọc qua các route trên) |
