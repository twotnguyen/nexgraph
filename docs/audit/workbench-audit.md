# Rà soát chức năng và giao diện NexGraph

Phạm vi là ứng dụng Electron/Monaco, engine Python và bản xem trước Code-OSS. Checkout kiểm thử dựa trên Nhóm 8 ở `f9a8e6f`. Các sửa đổi lập chỉ mục ở checkout đang dùng được đọc để đối chiếu. Phiên này làm việc trên nhánh cục bộ `fix/comprehensive-audit-workbench`.

## Lỗi tìm thấy và sửa đổi

| Hiện tượng | Nguyên nhân và thay đổi | Kiểm tra |
| --- | --- | --- |
| Lập chỉ mục E-commerce đứng ở 0/268 trong khoảng 20 giây | Pool trích xuất trên máy Windows thử nghiệm chờ đến ngưỡng fallback. Windows dùng một worker mặc định. Thiết lập nhiều worker vẫn khả dụng và chuyển sang tuần tự nếu pool lỗi. | Đo bằng engine HTTP trên bản sao NestJS. Tệp đầu tiên ở khoảng 0,29 giây khi lập chỉ mục lần đầu và 0,24 giây khi dựng lại. |
| Tổng quan không phân biệt đồ thị trống, đồ thị cũ và lỗi đọc | Màn cũ bỏ lỗi truy vấn số liệu, gộp nhiều trạng thái và chỉ tải dữ liệu một lần. Màn mới hiển thị riêng đồ thị trống, mã mới hơn, độ mới chưa xác minh và lỗi có nút tải lại. | So sánh trước và sau khi sửa tệp rồi dựng lại. Mốc mới xuất hiện khi graph công bố. Ca hồi quy lỗi tải và thử lại đi qua giao diện. |
| Góc nhìn mở sẵn và watcher mất cập nhật trong lúc rebuild | Watcher bỏ thay đổi nếu refresh trả bận. Một số góc nhìn chưa nghe revision của graph. Watcher thử lại sau job và giao diện tải lại theo bản graph đã công bố. Request cũ bị chặn khi lựa chọn mới đã thay thế. | Giữ graph cũ khả dụng trong lúc dựng lại. Kiểm Architecture, Map, Flows, Report, Search, Graph và Changes với dữ liệu công bố mới. |
| Dự án không Git bị so với repository cha | Phát hiện Git của Changes đi ngược lên thư mục cha. Backend dùng phạm vi Git đã đăng ký cho dự án. | Fixture không có `.git` nằm trong repo khác dùng đúng mốc của lần lập chỉ mục. |
| Thiếu thao tác quản lý danh sách gần đây | Thêm **Gỡ dự án khỏi danh sách** với xác nhận và phản hồi. API kiểm xung đột với index/refresh, ẩn mục đã đăng ký và dừng dịch vụ của mục đó. | Hủy xác nhận giữ mục. Gỡ khiến mục biến mất và lookup trả 404. Mở lại cùng đường dẫn dùng cùng ID, tệp nguồn và cache đồ thị. |
| Engine hoặc MCP có thể treo lúc thoát | Windows từ chối `taskkill`, ứng dụng chờ sự kiện thoát. MCP cũng chưa tuần tự hóa start/stop trong lúc spawn. Dừng theo tiến trình đã tạo và dùng đường thoát stdin/owned child khi cần. | Dựng tiến trình riêng để tái hiện lỗi quyền, chạy Engine API/MCP lifecycle và xác nhận engine đã dừng sau smoke. |
| Xuất Markdown phạm vi hẹp có thể lấy cả đồ thị | Nhánh Markdown đọc graph gốc và có thể ghi trước khi xác minh phạm vi. Xác minh phạm vi trước, rồi dùng graph đã lọc. Hộp thoại chọn thư mục xuất đọc lại cấu hình trước khi lưu để giữ các thay đổi đồng thời. | Đọc nội dung tệp đã xuất. Scope sai không tạo tệp. Ca IPC đổi cài đặt trong lúc hộp thoại còn mở. |
| Cài đặt AI có thể dùng nháp khóa của nhà cung cấp trước | Đổi provider giữ nguyên trường khóa chưa lưu và lỗi kết nối IPC chưa được xử lý. Cài đặt xóa nháp khi đổi provider, tuần tự hóa thao tác và hiển thị kết quả kết nối hoặc lỗi. | Kiểm hồi quy cài đặt/phiên Pi, không dùng bí mật thật. |
| Code-OSS bỏ lệnh khi webview đang khởi động | Lệnh gửi trước khi renderer đăng ký listener. Bridge lưu lệnh khởi đầu và chuyển lệnh theo thứ tự khi renderer đăng ký. | Kiểm codec/hàng đợi, TypeScript và production build host/webview. |

## Số đo trên bản sao E-commerce

Bản sao NestJS tại `d11f4ef7d906ba514cf9e3c2234116ad49789ee7`, trong thư mục `Đồ án/nestjs demo`. Mỗi lần dựng dùng engine HTTP thật trên Windows. Kết quả sau sửa là **268 tệp, 1.190 nút, 2.906 cạnh và 4 khối kiến trúc**.

| Lần đo | Trước khi đổi mặc định | Sau khi đổi mặc định |
| --- | ---: | ---: |
| Tệp đầu tiên khi lập chỉ mục lần đầu | 20,5 giây | 0,29 giây |
| Lập chỉ mục lần đầu | 39,95 giây | 13,41 giây |
| Dựng lại | 33,34 giây | 12,51 giây |

Đã xác nhận đồ thị mới, cũ sau một chỉnh sửa, rồi mới sau khi dựng lại. Các số đo áp dụng cho repo và máy thử này. Mở lại sau khi gỡ giữ được cùng đồ thị.

## Giao diện và khả năng sử dụng

- **Dự án, Tổng quan, Chọn phạm vi và Lập chỉ mục.** Điều hướng và hành động chính nằm trong thanh tiêu đề gọn. Danh sách gần đây có tình trạng chờ, lỗi và thử lại. Tổng quan dùng bảng số liệu và trạng thái theo dữ liệu thực. Lập chỉ mục tách phần đọc tệp và nối quan hệ, có hủy, làm lại và xem graph cũ khi graph đã công bố.
- **Workspace.** Thanh hoạt động hẹp, Explorer, tìm kiếm, Thay đổi, Tham quan, dải thẻ và trợ lý theo bố cục công cụ lập trình. Explorer mở mã trực tiếp. Thẻ hỗ trợ điều hướng phím. Panels, bản đồ, luồng, cây và editor có bố cục thích nghi với cửa sổ hẹp và trạng thái tải hoặc lỗi có hành động.
- **Cài đặt, hộp thoại và trợ lý.** Cài đặt chia nhóm thông tin xác thực, provider tùy chỉnh, OAuth, model và quyền riêng tư. Cập nhật giao diện nút, trạng thái đang chạy và thông báo có thể đóng. Monaco và bản diff dùng cùng theme với workspace.
- **Sáng/tối.** NexGraph ghi lựa chọn vào hồ sơ cục bộ. Code-OSS đọc theme của shell. Palette dùng chung cho bề mặt, đường viền, chữ, sơ đồ, editor và các trạng thái. Hiệu ứng chuyển trạng thái, skeleton và thanh tiến độ hỗ trợ `prefers-reduced-motion`.

## Ma trận xác minh

| Nhóm | Cách kiểm |
| --- | --- |
| Mở dự án, đường dẫn tiếng Việt, index, cancel, reindex, giữ đồ thị, remove/reopen | Engine HTTP với NestJS, fixtures engine và Desktop/IPC. |
| Tìm kiếm, bằng chứng, kiến trúc, Bản đồ, Graph, Luồng, Cây, Báo cáo, Tham quan | Suite engine kiểm truy vấn, cạnh và vị trí bằng chứng. Suite renderer kiểm hành vi của người dùng, UI lỗi, refetch và kết quả đến muộn. |
| Thay đổi, vùng ảnh hưởng, lưu Monaco, ghi xung đột, CRLF/BOM | Engine kiểm Git/no-Git. Desktop/IPC kiểm thao tác ghi thật với fixture và phiên agent. |
| Hỏi/Sửa, Duyệt/Từ chối/Dừng, chặn shell, mất kết nối | Phiên Pi thật dùng nhà cung cấp giả cục bộ, kết hợp suite Electron. |
| Xuất, MCP, Git hook, cấu hình Codex/Claude | Kiểm xuất tệp và phạm vi, vòng đời dịch vụ, luồng stdio/HTTP và cấu hình trên fixture. |
| Theme, workbench và Code-OSS | Kiểm renderer, ứng dụng Electron build với engine thật, và production build extension. |

### Kết quả kiểm thử trên Windows

- Engine Python **512 đạt, 7 bỏ qua**. Cảnh báo của lượt thử gồm Starlette/httpx, cache Graphify và quyền ghi thư mục cache pytest.
- Desktop **495 đạt, 5 bỏ qua**, 53 tệp kiểm thử. Đã bật E2E với engine và phiên Pi thật. Một số ca cần quyền symlink tệp của Windows được đánh dấu bỏ qua.
- Smoke trên Electron build chạy với engine thật và AI giả cục bộ. Nhật ký xác nhận `fs=OK agent=OK index=OK edit_policy=OK acceptance=OK workspace_controls=OK webgl_fallback=OK theme=OK project_remove=OK` và engine đã dừng.
- Production build desktop và host/webview Code-OSS thành công. TypeScript của hai ứng dụng và bộ 6 bài kiểm thử bridge/extension đã chạy đạt.
- Kiểm trực quan renderer build với dữ liệu fixture tại 1.360 px và 720 px. Lượt này quan sát palette sáng/tối, đổi màu Monaco trong phiên, Explorer, panel AI và chiều rộng canvas. Ảnh của lượt thử được lưu cục bộ trên máy kiểm, ngoài repo. Hộp thoại cập nhật Windows đã che lượt thao tác cửa sổ trực tiếp. Lượt smoke Electron và ảnh renderer được ghi riêng.

Chưa xác minh OAuth/model online thật, máy chủ Neo4j/FalkorDB thật, chạy Code-OSS trong cửa sổ native, NSIS/DMG, công cụ media tùy chọn và hiệu năng của cấu hình mới với repo lớn hơn trên Windows.

## Chạy bản hiện tại từ mã nguồn

Từ thư mục gốc checkout của bạn, chạy trong PowerShell hoặc terminal macOS

```sh
pnpm run setup:dev
pnpm dev
```

Các lệnh dùng môi trường Python của checkout và lockfile đã commit. Hướng dẫn cài phụ thuộc, mở dự án và cập nhật sau khi hợp nhất nằm trong [cài đặt từ mã nguồn](../install-notes.md). Các kết quả ở trên thuộc đợt rà soát đã ghi, kết quả cho commit mới được ghi trong PR và lượt CI tương ứng.

## Tệp chính

- [Vòng đời dự án](../../engine/src/nexgraph_engine/store/projects.py), [bộ lập chỉ mục](../../engine/src/nexgraph_engine/index/indexer.py) và [định tuyến IPC](../../apps/desktop/src/main/ipc.ts).
- [Workspace](../../apps/desktop/src/renderer/src/app/screens/WorkspaceScreen.tsx), [sắc thái hai theme](../../apps/desktop/src/renderer/src/styles.css) và [đồng bộ lựa chọn theme](../../apps/desktop/src/renderer/src/shared/lib/useTheme.ts).
- [Dự án gần đây](../../apps/desktop/src/renderer/src/app/screens/ProjectsScreen.tsx), [Tổng quan](../../apps/desktop/src/renderer/src/app/screens/ProjectOverviewScreen.tsx), [Tiến độ](../../apps/desktop/src/renderer/src/app/screens/IndexingScreen.tsx) và [Cài đặt](../../apps/desktop/src/renderer/src/app/screens/SettingsScreen.tsx).
- [Engine launcher](../../apps/desktop/src/main/platform/engine/launcher.ts), [MCP HTTP](../../apps/desktop/src/main/features/integrations/mcp-http.ts), [xuất graph](../../engine/src/nexgraph_engine/export/run.py) và [bridge Code-OSS](../../labs/extension/src/host-command.ts).
