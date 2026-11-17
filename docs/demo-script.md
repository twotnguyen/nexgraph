# Kịch bản demo NexGraph

Dùng **NexGraph 0.1.0 Electron/Monaco** từ [bộ cài đúng commit bàn giao](release/README.md). Chạy trên bản sao dự án. Ghi tên và hash bộ cài, commit NexGraph, commit hoặc tên fixture của dự án, hệ điều hành và provider trước mỗi lượt. [Biên bản nghiệm thu](release/acceptance/2026-11-18.md).

## Kiểm nhanh bằng fixture Python

Fixture `engine/tests/fixtures/flow_app` dùng để thử Monaco, luồng, trích dẫn và duyệt chỉnh sửa với engine kèm bộ cài và mô hình giả. Cài NexGraph trước theo [hướng dẫn phát hành](release/README.md#tải-đúng-bộ-cài). Dùng checkout cùng commit để lấy fixture và script máy chủ giả. Tạo bản sao và hồ sơ thử riêng mỗi lượt.

Mở một terminal ở gốc repo và khởi động máy chủ giả cục bộ. Giữ terminal này mở trong các lượt cần AI.

```sh
node apps/desktop/scripts/fake-llm.mjs 8787
```

Trong terminal thứ hai, cũng ở gốc repo, tạo bản sao có đường dẫn tiếng Việt và khoảng trắng rồi mở executable đã cài. Ghi lại đường dẫn fixture mà lệnh in ra.

**Windows (PowerShell)**

```powershell
$app = (Get-Item -LiteralPath (Read-Host 'Đường dẫn đầy đủ đến NexGraph.exe đã cài')).FullName
$demo = Join-Path ([System.IO.Path]::GetTempPath()) ('nexgraph-demo-' + [guid]::NewGuid())
$fixture = Join-Path $demo 'Đồ án\flow app'
New-Item -ItemType Directory -Path (Split-Path $fixture -Parent) -Force | Out-Null
Copy-Item -LiteralPath 'engine\tests\fixtures\flow_app' -Destination $fixture -Recurse
$env:NEXGRAPH_USER_DATA_DIR = Join-Path $demo 'user-data'
$env:NEXGRAPH_DATA_DIR = Join-Path $demo 'engine-data'
$env:NEXGRAPH_ALLOW_HTTP_PROVIDER = '1'
$fixture
& $app
```

**macOS**

```sh
app='/Applications/NexGraph.app'
demo=$(mktemp -d)
fixture="$demo/Đồ án/flow app"
mkdir -p "$demo/Đồ án"
cp -R engine/tests/fixtures/flow_app "$fixture"
printf '%s\n' "$fixture"
NEXGRAPH_USER_DATA_DIR="$demo/user-data" NEXGRAPH_DATA_DIR="$demo/engine-data" \
  NEXGRAPH_ALLOW_HTTP_PROVIDER=1 "$app/Contents/MacOS/NexGraph"
```

1. Trong app, kiểm engine sẵn sàng, mở bản sao fixture và lập chỉ mục. Xem **Tìm kiếm**, **Kiến trúc** và **Luồng** trước khi cấu hình AI. Vào **Cài đặt → Tài khoản AI → Nhà cung cấp tuỳ chỉnh**, thêm Base URL `http://127.0.0.1:8787/v1` và model `fake`, để trống API key. Lưu, chọn model và bấm **Kiểm tra kết nối**.
2. Ở **Luồng**, tìm `login`. Mở Agent ở chế độ **Hỏi**, đồng ý gửi dữ liệu cho endpoint cục bộ rồi hỏi về luồng đăng nhập. Kiểm trích dẫn hợp lệ mở đúng dòng trong Monaco và **Tô luồng** tô các cạnh của graph. Máy chủ giả cố ý trả thêm một trích dẫn tới tệp không tồn tại để kiểm tra app không cho mở chip đó.
3. Chuyển sang **Sửa**, gửi `NEXGRAPH_DEMO_EDIT`. Máy chủ giả đề xuất thêm comment vào dòng `return save_session(user)` trong `service.py`. Bấm **Từ chối**, xác nhận tệp giữ nguyên, gửi lại và bấm **Duyệt thay đổi**. Kiểm nội dung đã ghi và thẻ **Thay đổi**.
4. Quay về **Hỏi**. Dừng máy chủ giả bằng Ctrl+C rồi gửi một câu hỏi. Ghi lỗi kết nối và kiểm **Tìm kiếm**, **Kiến trúc** và **Luồng** vẫn mở được. Ghi phép thử này là gián đoạn endpoint AI cục bộ.
5. Thoát ứng dụng, kiểm engine của lượt thử đã dừng rồi đóng terminal đã đặt biến thử trên Windows.

[Phiên kiểm Electron đóng gói trên macOS ngày 15/11](benchmarks/2026-11-15-editor-agent.md) ghi lại lượt thử fixture trước khi bỏ công cụ chạy lệnh. Ghi riêng kết quả của bản đang dùng và loại nhà cung cấp đã thử.

## Demo NestJS trong 5 phút

Chuẩn bị bản sao `ecommerce-backend-nestjs`, baseline đã dùng tại commit `d11f4ef7d906ba514cf9e3c2234116ad49789ee7` (268 tệp được lập chỉ mục). Giữ lịch sử Git hoặc tạo một commit mốc trong bản sao để **Thay đổi** so với HEAD. Lập chỉ mục trước, mở app và thử kết nối model hỗ trợ tool calling nếu trình bày phần AI thật. Chuẩn bị bản sao sạch cho từng lượt. Nếu mất kết nối, dùng thẻ **Luồng** và thao tác chỉnh sửa tay.

| Bước | Thao tác | Thời lượng |
| --- | --- | --- |
| 1. Mở dự án | Từ màn **Dự án**, mở bản sao NestJS đã lập chỉ mục và xem số tệp, nút, cạnh ở **Tổng quan**. | 0:30 |
| 2. Khám phá kiến trúc | Mở **Kiến trúc**, đi xuống `src/apps`, bấm mũi tên xem bằng chứng. Mở **Bản đồ** để xem toàn cục. Nếu máy thiếu WebGL, dùng **Kiến trúc**. | 1:00 |
| 3. Theo luồng đăng nhập | Chọn `signIn` ở **Luồng** và phát qua các cạnh. Nếu model sẵn sàng, hỏi “Luồng đăng nhập chạy thế nào?”, mở chip trích dẫn đúng dòng và thử **Tô luồng**. | 1:30 |
| 4. Sửa và xem ảnh hưởng | Mở `src/common/utils/string-util/string-util.service.ts` trong Monaco, thêm một comment rồi lưu. Mở **Thay đổi** để xem ảnh hưởng và kiểm thử liên quan. Nếu dùng AI thật, yêu cầu một thay đổi nhỏ trên bản sao, xem diff trước khi duyệt, rồi kiểm **Từ chối** ở một đề xuất khác. | 1:00 |
| 5. Trình bày đánh giá | Trình bày độ đúng và hiệu năng đã đo trong [báo cáo H6](benchmarks/2026-12-danh-gia.md). Ghi rõ các phép đo có/không MCP và khảo sát nếu vẫn đang chờ dữ liệu. | 0:30 |

Tổng mục tiêu là 4:30, còn 0:30 dự phòng. Các số của H6 cho demo là thời gian engine; ghi riêng tổng thời gian có thao tác giao diện.

## Nghiệm thu

- [ ] **Lượt 1**. Chạy đủ năm bước trên bản đã cài, ghi thời gian, commit và ảnh. Ghi thời gian index mới bên cạnh thời gian trình bày sau khi graph đã sẵn sàng.
- [ ] **Lượt 2**. Dùng bản sao sạch, kiểm **Duyệt** đổi nội dung và **Từ chối** giữ nguyên tệp. Ghi provider, model và diff đã quan sát.
- [ ] **Lượt 3**. Gián đoạn kết nối AI trong **Hỏi**, dùng thẻ **Luồng** để trình bày tiếp và kiểm nháp chưa lưu khi đổi thẻ. Ghi cách gián đoạn và nội dung lỗi.
- [ ] Điền [checklist cho Windows và macOS](windows-checklist.md) và cập nhật [biên bản nghiệm thu](release/acceptance/2026-11-18.md). Gắn ảnh hoặc video, log, artifact, hệ điều hành và cấu hình máy theo từng lượt.
