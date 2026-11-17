# Danh sách nghiệm thu Windows

Bản phát hành **NexGraph 0.1.0** dùng **Electron độc lập với Monaco**. [CI tại `6687fc9`](https://github.com/twotnguyen/nexgraph/actions/runs/44065280698) đã build và smoke bản Electron trên Windows. **Nhóm 8** còn phải cài và thao tác trên máy Windows của nhóm bằng đúng bộ cài phát hành. [Hướng dẫn phát hành](release/README.md) · [Hướng dẫn cài đặt](install-notes.md).

Mỗi mục ghi **Đạt**, **Lỗi** hoặc **Chưa kiểm**. Với lỗi, ghi bước tái hiện, nội dung lỗi, log hoặc ảnh. Ghi OS/build Windows, CPU, RAM, GPU, commit NexGraph, URL run/artifact, dung lượng và ngày kiểm.

## A. Cài và khởi động

- [ ] Tải artifact từ job đóng gói Windows của commit cần kiểm, giải nén và chọn bộ cài NSIS. Ví dụ cho Windows x64 là `NexGraph-0.1.0-windows-x64.exe`. Nếu tự build, lấy bộ cài trong `apps/desktop/dist/` theo [hướng dẫn đóng gói](install-notes.md#đóng-gói-electron). Ghi đúng tên và kiến trúc của tệp thực tế.
- [ ] Ghi đường dẫn tệp `.exe` đã tải, kích thước và SHA-256. Ví dụ từ thư mục chứa bộ cài x64, chạy `Get-FileHash -Algorithm SHA256 -LiteralPath '.\NexGraph-0.1.0-windows-x64.exe'`.
- [ ] Chạy installer NSIS và ghi đường dẫn cài thực tế. Ghi cảnh báo SmartScreen nếu xuất hiện và kết quả mở NexGraph.
- [ ] Mở `NexGraph.exe` từ thư mục vừa cài. Kiểm tệp `resources\engine\nexgraph-engine.exe`, trạng thái **Engine: sẵn sàng** và nút **Mở thư mục…** ở màn **Dự án**.
- [ ] Nếu tự build, chạy `pnpm --filter @nexgraph/desktop run smoke:packaged`. Lưu dòng `SMOKE OK` kèm `fs=OK agent=OK` trong log. Script smoke dùng `apps/desktop/dist/win-unpacked/NexGraph.exe`; kết quả cài qua NSIS được ghi riêng ở các bước trên.

## B. Luồng dự án và demo

- [ ] Chạy [fixture Python ngắn](demo-script.md#kiểm-nhanh-bằng-fixture-python) với LLM giả để kiểm luồng cơ bản.
- [ ] Chạy [demo NestJS](demo-script.md#demo-nestjs-trong-5-phút) từ bản sao có dấu và khoảng trắng, chẳng hạn `Đồ án\nestjs demo`. Ghi tổng thời gian.
- [ ] Mở **Kiến trúc** và **Bản đồ**. Nếu WebGL không dùng được, app có báo trạng thái và vẫn xem được **Kiến trúc**.
- [ ] Chọn luồng `signIn`, thử **Tô luồng** và mở trích dẫn đúng dòng trong Monaco.
- [ ] Sửa rồi Ctrl+S, kiểm **Thay đổi** và kiểm thử liên quan; đổi nhánh Git và kiểm graph làm mới.
- [ ] Bật **Cập nhật sau mỗi commit**, commit một thay đổi trên bản sao, kiểm trạng thái hết “Graph cũ”. Gỡ rồi kiểm khối NexGraph trong `.git/hooks/post-commit` đã được bỏ.
- [ ] Thoát app, Task Manager không còn tiến trình `nexgraph-engine.exe` của phiên vừa kiểm.

## C. Các kịch bản lỗi

- [ ] Chưa cấu hình AI: các thẻ đồ thị vẫn dùng được và Agent hướng dẫn vào **Tài khoản AI**.
- [ ] Dự án lớn chưa lập chỉ mục: app cho chọn thư mục con.
- [ ] Dự án Go hoặc Java nhỏ: graph chung được dựng, app hiển thị mức hỗ trợ.
- [ ] Mất mạng với provider online: mở lại được dự án đã lập chỉ mục; Agent báo lỗi kết nối.
- [ ] Dự án không có `.git`: thẻ **Thay đổi** so với lần lập chỉ mục trước.

## D. Editor, Agent và MCP

- [ ] Mở tệp CRLF có BOM, sửa và Ctrl+S, xác nhận EOL/BOM giữ nguyên.
- [ ] Đổi thẻ khi có thay đổi chưa lưu. Đóng thẻ/thoát app hiện xác nhận.
- [ ] Sửa từ ngoài: thẻ sạch nạp lại; thẻ bẩn hiện lựa chọn xử lý xung đột và giữ nháp.
- [ ] Thêm nhà cung cấp tuỳ chỉnh, chọn model, kiểm kết nối. Key đã lưu không xuất hiện lại trong ô nhập.
- [ ] Hỏi: xem streaming, bấm **Dừng**, mở trích dẫn và **Tô luồng**. Ghi loại provider (giả hoặc thật).
- [ ] Chuyển **Sửa** thấy cảnh báo quyền chạy lệnh. Duyệt diff làm đổi tệp, từ chối giữ nguyên byte. Khi đang chờ duyệt, thử **Dừng**, đổi **Hỏi** hoặc tải lại cửa sổ, xác nhận đề xuất cũ không thực thi và lượt sau dùng được.
- [ ] Thử duyệt lệnh vô hại `echo NexGraph`, ghi shell Windows thực tế và kết quả.
- [ ] Nếu kiểm OAuth, ghi provider, kết quả đăng nhập và hủy. Ghi rõ khi dùng adapter/provider giả.
- [ ] Xem trước rồi áp dụng cấu hình MCP/skill trong bản sao, xác nhận phần cấu hình cũ được giữ. Nếu client đã cài, mở dự án và gọi `graph_stats` để xác nhận kết nối runtime.

## E. Bằng chứng

- Máy, ngày, commit, kiến trúc và URL run/artifact:
- Tên bộ cài, đường dẫn tải, byte, SHA-256 và thư mục sau cài:
- Fixture/dự án, nhà cung cấp AI, client MCP:
- Log, ảnh hoặc video:
- Lỗi và mục còn chờ:
