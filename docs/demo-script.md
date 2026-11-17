# Kịch bản demo NexGraph

Dùng **NexGraph 0.1.0 Electron/Monaco** theo [hướng dẫn bản bàn giao và ảnh giao diện](release/README.md). Các lệnh `pnpm dev` bên dưới dùng để chuẩn bị và tập thử. Lượt bảo vệ dùng bộ cài ứng với hệ điều hành của máy demo. Chạy trên bản sao dự án và ghi tên bộ cài, commit NexGraph, commit hoặc tên fixture của dự án, hệ điều hành và nhà cung cấp AI trước mỗi lượt.

## Kiểm nhanh bằng fixture Python

Fixture bốn tệp `engine/tests/fixtures/flow_app` dùng để thử editor, luồng, trích dẫn và duyệt chỉnh sửa với engine thật và LLM giả. Tạo bản sao mới ở mỗi lượt.

**PowerShell (Windows)**, từ gốc repo:

```powershell
$demo = Join-Path ([System.IO.Path]::GetTempPath()) ('nexgraph-demo-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $demo | Out-Null
$fixture = Join-Path $demo 'flow_app'
Copy-Item -LiteralPath 'engine\tests\fixtures\flow_app' -Destination $fixture -Recurse
$env:NEXGRAPH_USER_DATA_DIR = Join-Path $demo 'user-data'
$env:NEXGRAPH_DATA_DIR = Join-Path $demo 'engine-data'
$env:NEXGRAPH_ALLOW_HTTP_PROVIDER = '1'
$fixture
pnpm dev
```

**macOS**, từ gốc repo:

```sh
demo=$(mktemp -d)
cp -R engine/tests/fixtures/flow_app "$demo/flow_app"
printf '%s\n' "$demo/flow_app"
NEXGRAPH_USER_DATA_DIR="$demo/user-data" NEXGRAPH_DATA_DIR="$demo/engine-data" \
  NEXGRAPH_ALLOW_HTTP_PROVIDER=1 pnpm dev
```

Mở terminal thứ hai ở gốc repo để chạy máy chủ kiểm thử. Lệnh import trực tiếp dùng được trên Windows, nơi kiểm tra đường dẫn ở điểm vào của script có thể bỏ qua khởi động khi gọi script trực tiếp:

```sh
node --input-type=module -e "import { createFakeLlm } from './apps/desktop/scripts/fake-llm.mjs'; createFakeLlm().listen(8787, '127.0.0.1', () => console.log('http://127.0.0.1:8787/v1'));"
```

1. Trong app, mở bản sao `flow_app` vừa tạo và dựng graph. Vào **Cài đặt → Tài khoản AI → Nhà cung cấp tuỳ chỉnh**, thêm nhà cung cấp với Base URL `http://127.0.0.1:8787/v1`, model `fake`, để trống API key. Lưu, chọn model và bấm **Kiểm tra kết nối**.
2. Ở **Luồng**, tìm `login`. Mở Agent ở chế độ **Hỏi**, đồng ý gửi dữ liệu cho endpoint cục bộ rồi hỏi về luồng đăng nhập. Kiểm trích dẫn hợp lệ mở đúng dòng trong Monaco và **Tô luồng** tô các cạnh của graph. Máy chủ giả cố ý trả thêm một trích dẫn tới tệp không tồn tại để kiểm tra app không cho mở chip đó.
3. Chuyển sang **Sửa**, gửi riêng `NEXGRAPH_DEMO_EDIT`. Kịch bản trả một đề xuất thêm comment vào dòng `return save_session(user)` trong `service.py`. Bấm **Từ chối**, xác nhận tệp giữ nguyên, gửi lại trên bản sao sạch và bấm **Duyệt**. Kiểm nội dung đã ghi và thẻ **Thay đổi**. Lệnh này dành cho fixture Python và dựa vào nội dung ban đầu của `service.py`.
4. Dừng máy chủ bằng Ctrl+C. Trên PowerShell, đóng phiên đã đặt biến test hoặc chạy `Remove-Item Env:NEXGRAPH_ALLOW_HTTP_PROVIDER, Env:NEXGRAPH_USER_DATA_DIR, Env:NEXGRAPH_DATA_DIR`.

Bằng chứng hiện có là [phiên kiểm Electron đóng gói trên macOS](benchmarks/2026-11-15-editor-agent.md) với fixture này. Ghi riêng kết quả của Windows, của phiên bản app đang chạy và của nhà cung cấp AI thật.

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

- [ ] Lượt 1 trên bản đóng gói macOS: chạy đủ năm bước, ghi thời gian, commit và ảnh.
- [ ] Lượt 2: lặp trên bản sao sạch, kiểm **Duyệt** đổi nội dung, **Từ chối** giữ nguyên tệp.
- [ ] Lượt 3: mất mạng ở lượt **Hỏi**, chạy phương án dự phòng và kiểm nháp chưa lưu khi đổi thẻ.
- [ ] Kiểm Windows theo [checklist](windows-checklist.md), ghi riêng kết quả provider thật/OAuth và client MCP khi đã thử.
- [ ] Gắn ảnh hoặc video và log với commit, artifact, hệ điều hành và cấu hình máy.
