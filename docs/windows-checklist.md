# Danh sách nghiệm thu Windows

Dùng checklist này cho **Electron độc lập**. Ghi kết quả Code-OSS riêng với artifact và quy trình dựng tương ứng. CI đã được ghi nhận ở mốc `61cc7af` cho build và smoke bản Electron, còn cài và thao tác trên máy Windows của nhóm đang chờ ghi nhận. Xem [bằng chứng và hướng dẫn](install-notes.md).

Mỗi mục ghi **Đạt**, **Lỗi** hoặc **Chưa kiểm**. Với lỗi, ghi bước tái hiện, nội dung lỗi, log hoặc ảnh. Ghi OS/build Windows, CPU, RAM, GPU, commit NexGraph, URL run/artifact, dung lượng và ngày kiểm.

## A. Cài và khởi động

- [ ] Tải `.exe` từ job `package (windows-latest)` của commit cần kiểm hoặc tạo bộ cài theo [hướng dẫn đóng gói](install-notes.md#đóng-gói-electron). Ghi đúng loại artifact và kích thước của bộ cài.
- [ ] Chạy installer NSIS. Ghi cảnh báo SmartScreen nếu xuất hiện và kết quả mở NexGraph.
- [ ] Mở app trên máy đích, kiểm màn **Dự án** và trạng thái engine.
- [ ] Nếu tự build, chạy `pnpm --filter @nexgraph/desktop run smoke:packaged`. Lưu dòng `SMOKE OK` kèm `fs=OK agent=OK` trong log kiểm tự động.

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

- Máy, ngày, commit, bản chạy và artifact:
- Fixture/dự án, nhà cung cấp AI, client MCP:
- Log, ảnh hoặc video:
- Lỗi và mục còn chờ:
