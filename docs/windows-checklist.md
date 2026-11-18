# Checklist nghiệm thu bộ cài trên Windows và macOS

Dùng NexGraph Electron độc lập với Monaco. Chọn bộ cài NSIS và DMG từ cùng commit dự kiến bàn giao. Điền **Đạt**, **Lỗi** hoặc **Chưa chạy** cho từng phép thử. Với lỗi, ghi bước tái hiện, mã hoặc thông báo lỗi và đính kèm log hoặc ảnh. [Hướng dẫn chọn bộ cài](release/README.md) · [Biên bản nghiệm thu](release/acceptance/2026-11-18.md).

## A. Chốt bản kiểm và mở ứng dụng

- [ ] Ghi phiên bản, commit đầy đủ, URL lượt chạy, hệ điều hành, bản build, kiến trúc và ngày kiểm. Ghi CPU, RAM và GPU của máy dùng cho demo.
- [ ] Tải artifact đúng hệ điều hành và kiến trúc từ lượt chạy đã ghi. Lưu tên bộ cài, kích thước theo byte và SHA-256 của tệp thực tế rồi đối chiếu với tệp `.build.json` đi kèm.
- [ ] **Windows**. Chạy NSIS, ghi thư mục đã cài và mở `NexGraph.exe` từ thư mục đó. Kiểm tệp `resources\engine\nexgraph-engine.exe`.
- [ ] **macOS**. Gắn DMG, chép NexGraph vào **Applications**, tháo ảnh đĩa và mở bản vừa chép. Kiểm tệp `NexGraph.app/Contents/Resources/engine/nexgraph-engine`.
- [ ] Ghi mọi cảnh báo hoặc chặn từ SmartScreen, Application Control hay Gatekeeper nếu xuất hiện. Khi app mở được, ghi trạng thái **Engine: sẵn sàng** và nút **Mở thư mục…** ở màn **Dự án**.
- [ ] Ở dòng kiểm CI của từng hệ điều hành, lưu log smoke từ job đã cài chính artifact đó. Ở dòng máy đích, ghi kết quả khởi động và thao tác trên bản đã cài tại máy.

## B. Luồng chính trên bản đã cài

- [ ] Chạy [fixture Python với hồ sơ riêng và mô hình giả](demo-script.md#kiểm-nhanh-bằng-fixture-python). Ghi kết quả lập chỉ mục, tìm kiếm và mở mã đúng dòng.
- [ ] Mở bản sao NestJS có dấu và khoảng trắng, chẳng hạn `Đồ án/nestjs demo`. Ghi mã commit dự án, thời gian lập chỉ mục mới, số tệp, nút và cạnh trong **Tổng quan**.
- [ ] Tìm một symbol trong **Tìm kiếm**. Mở **Kiến trúc**, chọn một quan hệ có bằng chứng, mở tệp và đối chiếu đúng dòng trong Monaco. Mở **Bản đồ** rồi chọn luồng `signIn` trong **Luồng**.
- [ ] Sửa một tệp mẫu, lưu bằng `Ctrl+S` hoặc `⌘S`, rồi xem **Thay đổi** và vùng ảnh hưởng. Với repo Git, kiểm thêm đổi nhánh và làm mới graph.
- [ ] Trên bản sao Git, bật **Cập nhật sau mỗi commit**. Commit một thay đổi và kiểm ứng dụng cập nhật graph. Gỡ tích hợp rồi kiểm khối NexGraph được bỏ khỏi `.git/hooks/post-commit`.
- [ ] Chạy [ba lượt demo NestJS](demo-script.md#nghiệm-thu). Ghi thời gian thao tác, ảnh các điểm mốc và kết quả của lượt dùng phương án dự phòng.
- [ ] Trước khi thoát, ghi PID của engine và worker của lượt kiểm. Đóng app và kiểm các PID đó đã thoát trong Task Manager hoặc Activity Monitor.

## C. Tình huống cần đối chiếu

- [ ] **Không có Git**. Lập chỉ mục một bản sao nằm ngoài cây thư mục Git. Sửa tệp, mở **Thay đổi** và kiểm chênh lệch so với mốc lập chỉ mục.
- [ ] **Thiếu WebGL**. Thêm `--disable-webgl` vào cuối lệnh mở app đã cài trong [kịch bản fixture](demo-script.md#kiểm-nhanh-bằng-fixture-python). Mở **Bản đồ**, kiểm thông báo hướng người dùng sang **Kiến trúc**, rồi mở thẻ đó và xem bằng chứng.
- [ ] **AI chưa cấu hình hoặc không kết nối được**. Kiểm Agent hướng dẫn vào **Tài khoản AI** khi chưa có model. Sau khi có kết nối, thử mất mạng hoặc dừng máy chủ giả theo [kịch bản fixture](demo-script.md#kiểm-nhanh-bằng-fixture-python). Ghi cách tạo lỗi, thông báo Agent và kết quả mở lại đồ thị đã lập chỉ mục.
- [ ] **Dựng lại bị hủy**. Khi đã có graph, bấm **Index lại**, mở bản hiện có rồi quay lại tiến độ và bấm **Hủy**. Mở lại dự án, xác nhận tìm kiếm, Kiến trúc và Luồng giữ kết quả đã công bố.
- [ ] **Engine dừng trong lúc dựng lại**. Trên bản sao thử nghiệm, dừng riêng engine của lượt kiểm. Mở app và kiểm đồ thị đã công bố vẫn đọc được. Chạy lại rồi đối chiếu số tệp, nút, cạnh và một truy vấn với bản dựng sạch.
- [ ] Với dự án lớn chưa được lập chỉ mục, thử chọn thư mục con. Với một dự án Go hoặc Java nhỏ, kiểm mức hỗ trợ được hiển thị.

## D. Editor, Agent và MCP

- [ ] Mở tệp CRLF có BOM. Sửa giữa hai lần lưu liên tiếp rồi so nội dung cuối và EOL/BOM theo byte. Đổi thẻ, đóng thẻ hoặc thoát khi có nháp để kiểm lựa chọn lưu hoặc giữ nháp.
- [ ] Sửa từ ngoài. Thẻ sạch nạp lại. Thẻ có nháp hiển thị xung đột và giữ bản đang sửa.
- [ ] Thêm provider tùy chỉnh, chọn model và thử kết nối. Nếu dùng API key, kiểm ô nhập không hiển thị lại key đã lưu.
- [ ] Ẩn và mở lại Agent. Với **Hỏi**, xem streaming, thử **Dừng**, mở trích dẫn và **Tô luồng** nếu provider hỗ trợ.
- [ ] Với **Sửa**, kiểm diff trước khi **Duyệt thay đổi**. So nội dung sau khi duyệt. Lặp lại với **Từ chối**, **Dừng**, chuyển sang **Hỏi** và tải lại cửa sổ khi đang chờ duyệt. Kiểm đề xuất cũ hết hiệu lực.
- [ ] Trong lúc chờ duyệt, lưu bản khác của tệp từ editor. Duyệt diff cũ và kiểm thông báo xung đột cùng nội dung giữ trên đĩa. Lặp với đề xuất tạo tệp ở đường dẫn vừa có tệp.
- [ ] Với mô hình giả, thử gọi shell trong cả **Hỏi** và **Sửa**. Kiểm danh sách tool gửi đi, không có thẻ duyệt lệnh và tệp đánh dấu không xuất hiện. [Smoke qua IPC](../apps/desktop/src/main/smoke-desktop.ts) · [Kiểm thử phiên Pi](../apps/desktop/test/agent-session-pi.test.ts).
- [ ] Với hai máy chủ giả, đổi provider trong khi hộp đồng ý gửi mã đang mở. Kiểm câu hỏi được giữ lại và payload đầu tiên sau khi xác nhận ở đích mới không mang lịch sử cũ.
- [ ] Dùng `.env` giả và liên kết tới tệp đã bị loại để kiểm phạm vi dữ liệu của `read`, `grep`, `find`, `get_context` và MCP. Thử cùng một truy vấn trên tệp công khai để kiểm luồng đọc bình thường.
- [ ] Khi có client MCP thật, mở bản sao dự án đã lập chỉ mục, xem trước và áp dụng cấu hình rồi thử `graph_stats`. Ghi client và kết quả bảo toàn cấu hình có sẵn.
- [ ] Khi có provider thật hoặc tài khoản OAuth thử nghiệm, ghi tên provider và model, kết quả kết nối, đăng nhập, hủy, mở lại và đăng xuất nếu đã thử. Kiểm di trú `auth.json` bằng credential dành cho thử nghiệm nếu phù hợp.

## E. Bằng chứng

Điền [biên bản nghiệm thu](release/acceptance/2026-11-18.md) cho từng máy và từng lượt. Gắn commit, URL run/artifact, hệ điều hành, loại provider, fixture và video hoặc ảnh vào kết quả tương ứng. Ẩn khóa, token và thông tin cá nhân trong ảnh hoặc log. [Mẫu trường cần ghi](srs/traceability.md#biên-bản-cho-bản-bàn-giao).
