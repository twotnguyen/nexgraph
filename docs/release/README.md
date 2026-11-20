# Cài và nghiệm thu NexGraph 0.1.0

Bản bàn giao chính 0.1.0 là **NexGraph độc lập trên Electron, với trình soạn thảo Monaco tích hợp**. CI đóng gói engine Python cùng ứng dụng. Code-OSS đã tích hợp dưới dạng bản xem trước, có quy trình dựng và mốc nghiệm thu riêng. [Cấu hình bộ cài](../../apps/desktop/electron-builder.yml) · [Kiến trúc](../srs/architecture.md)

## Tải đúng bộ cài

Bản đã gắn tag `v<version>` có sẵn bộ cài và tệp `.build.json` ở [Releases](https://github.com/twotnguyen/nexgraph/releases). Phát hành bản mới: tăng `version` trong `apps/desktop/package.json`, merge vào `main`, rồi `git tag v<version> && git push origin v<version>`; CI kiểm, đóng gói hai hệ điều hành rồi tạo Release. Tag không khớp `version` thì CI dừng. Commit chưa gắn tag thì lấy bộ cài từ Actions như dưới đây.

1. Mở lượt [GitHub Actions](https://github.com/twotnguyen/nexgraph/actions/workflows/ci.yml) của commit dự kiến bàn giao. Chọn cả hai bộ cài từ cùng commit đó. Ở **Artifacts**, tải gói `NexGraph-${version}-<hệ-điều-hành>-${arch}` rồi giải nén để lấy bộ cài. Chỉ dùng artifact của lượt chạy mà mọi job đều đạt: job đóng gói chạy song song với kiểm thử nên vẫn tải bộ cài lên khi test engine hoặc desktop thất bại. Tải artifact cần đăng nhập GitHub.
2. Kiểm hệ điều hành và kiến trúc của máy, rồi đối chiếu tên tệp trong artifact. Trên Windows xem **Settings → System → About → System type**. Trên macOS xem **About This Mac** để phân biệt Apple silicon và Intel. Chỉ dùng kiến trúc có trong lượt build và khớp với máy đích.
3. Trong artifact, mở tệp cùng tên gốc với bộ cài và có đuôi `.build.json`, ví dụ `NexGraph-0.1.0-windows-x64.build.json`. Dùng `version`, `platform`, `arch`, `filename`, `bytes`, `sha256`, `commit` và `run` để đối chiếu tệp thực tế trước khi cài. Ghi hash và nguồn vào [biên bản nghiệm thu](acceptance/2026-11-18.md).

| Hệ điều hành | Tệp trong artifact 0.1.0 | Cách cài |
|---|---|---|
| Windows x64 | `NexGraph-0.1.0-windows-x64.exe` | Mở trình cài NSIS, chọn nơi cài, sau đó mở NexGraph từ Start. |
| macOS Apple silicon | `NexGraph-0.1.0-macos-arm64.dmg` | Mở ảnh đĩa, kéo NexGraph vào **Applications**, tháo ảnh đĩa rồi mở ứng dụng. |

Tính SHA-256 của tệp bộ cài đã giải nén bằng `Get-FileHash -Algorithm SHA256 -LiteralPath '<tệp>'` trong PowerShell hoặc `shasum -a 256 '<tệp>'` trên macOS. So hash không phân biệt chữ hoa và thường. Trường `commit` ghi đúng checkout mà runner đã dùng. Khi kiểm pull request, GitHub có thể dựng từ commit hợp nhất của lượt chạy.

Mỗi tệp cài phải dưới 500 MB; bước kiểm tệp cài trong CI báo lỗi khi vượt. Bản 0.1.0 trên macOS chiếm khoảng 650 MB sau khi kéo vào Applications.

### Mở bộ cài chưa ký số

Bộ cài không có chứng chỉ nhà phát triển nên hệ điều hành cảnh báo ở lần mở đầu.

- **macOS:** mở NexGraph, gặp thông báo không xác minh được nhà phát triển thì chọn **Done**. Vào **System Settings → Privacy & Security**, kéo xuống mục Security, chọn **Open Anyway** cạnh dòng nhắc NexGraph rồi xác nhận. Từ bản 0.1.1, app được ký ad-hoc nên đi được đường này. Bản 0.1.0 có chữ ký chưa trọn, macOS có thể báo app "bị hỏng"; khi đó chạy `xattr -dr com.apple.quarantine /Applications/NexGraph.app` trong Terminal rồi mở lại.
- **Windows:** SmartScreen hiện "Windows protected your PC" thì chọn **More info → Run anyway**.

Nếu hệ điều hành vẫn chặn trình cài hoặc engine đã cài, ghi rõ thành phần và thông báo trong checklist. Với máy được quản lý, báo người phụ trách máy. [Workflow và artifact](../../.github/workflows/ci.yml) · [Kiểm tên bộ cài](../../apps/desktop/scripts/check-installer.mjs).

## Chạy lần đầu

1. Mở NexGraph và chờ trạng thái engine sẵn sàng. Bộ cài dùng engine kèm theo. Git giúp đọc thay đổi theo HEAD. Khi dự án thiếu Git phù hợp, Changes dùng mốc lập chỉ mục.
2. Tại màn **Dự án**, chọn **Mở thư mục…** và chọn bản sao mã nguồn có dấu và khoảng trắng. Có thể chạy [fixture Python trên app đã cài](../demo-script.md#kiểm-nhanh-bằng-fixture-python) trước khi chuẩn bị bản sao NestJS.
3. Dự án nhỏ tự lập chỉ mục, dự án vượt ngưỡng hiển thị lựa chọn phạm vi. Khi hoàn tất, bấm **Bắt đầu khám phá**. Dự án đã có chỉ mục mở thẳng vào không gian làm việc. Thử **Tìm kiếm** rồi vào **Kiến trúc**, chọn một quan hệ có bằng chứng và mở mã đúng dòng trong Monaco.
4. Cây tệp nằm bên trái, mã và sơ đồ ở giữa, trợ lý AI bên phải. Thử mở tệp từ cây, sửa rồi lưu bằng `Ctrl+S` hoặc `⌘S` và mở **Thay đổi**. Nút **← Tổng quan** mở thống kê và tùy chọn index. Phần lập chỉ mục, tìm kiếm và xem graph chạy cục bộ. Cấu hình AI khi cần kiểm Hỏi hoặc Sửa.

## Ảnh giao diện

**Màn Dự án.** Ảnh lưu từ đợt kiểm NexGraph 0.1.0 Electron trên Windows, với engine thật đã sẵn sàng. Các ảnh trong mục này ghi lại phiên bản ở thời điểm kiểm, trước lần cập nhật bố cục ba cột.

![Màn Dự án của NexGraph 0.1.0 trên Windows, nút Mở thư mục và trạng thái engine sẵn sàng](screenshots/projects.png)

**Kiến trúc NestJS.** Ảnh chụp trên Windows từ renderer Electron 0.1.0 đã build, dùng engine phát triển và bản sao `ecommerce-backend-nestjs` tại `d11f4ef`. Đồ thị gốc hiển thị các khối và quan hệ `test → src`.

![Màn Kiến trúc của dự án NestJS và quan hệ phụ thuộc từ test sang src](screenshots/architecture.png)

**Monaco và trợ lý.** Hai ảnh chụp bản Electron đóng gói trên macOS arm64 với fixture Python và mô hình giả lập ngày 15/11. Ảnh Hỏi minh họa trích dẫn mở đúng dòng và vùng ảnh hưởng. Ảnh Sửa minh họa diff cùng hai lựa chọn Duyệt và Từ chối. [Biên bản chụp ảnh](../benchmarks/2026-11-15-editor-agent.md#kiểm-trên-bản-đóng-gói-electron-thật)

![Trình soạn thảo Monaco mở trích dẫn từ chế độ Hỏi](../benchmarks/2026-11-15-editor-ask.png)

![Chế độ Sửa trình bày diff và yêu cầu duyệt thao tác sửa tệp](../benchmarks/2026-11-15-editor-approval.png)

## Bằng chứng và nghiệm thu

| Nơi kiểm | Phép thử và bằng chứng |
|---|---|
| CI trên GitHub | Windows cài NSIS vào thư mục tạm. macOS gắn DMG rồi chép app vào thư mục tạm. Smoke dùng engine đi kèm và AI giả để kiểm đường dẫn có dấu, lập chỉ mục, sửa tệp, vùng ảnh hưởng trên fixture không Git và truy vấn sau gián đoạn endpoint AI. Lưu tệp `.build.json`, dòng `SMOKE OK` có `fs=OK agent=OK index=OK edit_policy=OK acceptance=OK workspace_controls=OK webgl_fallback=OK` và dòng `SMOKE ENGINE STOPPED pid=…`. |
| Máy Windows đích | Cài bản NSIS đã đối chiếu, ghi thư mục cài và trạng thái engine. Làm checklist trên bản sao nguồn Unicode có khoảng trắng. Lưu kết quả thao tác, cảnh báo hệ điều hành, ảnh, log và tình trạng tiến trình khi thoát. |
| Máy macOS đích | Chép app từ DMG đã đối chiếu vào **Applications**, ghi kiến trúc và trạng thái engine. Làm cùng checklist trên bản sao nguồn Unicode có khoảng trắng. Lưu ảnh, log và tình trạng tiến trình khi thoát. |
| Demo NestJS | Ghi kết quả ba lượt trên bản đã cài, thời gian thực tế, kết quả Duyệt/Từ chối và thao tác dự phòng khi AI gián đoạn. Ghi provider hoặc mô hình giả được dùng. Ghi kết nối MCP riêng nếu đã thử bằng client thật. |

Trong [biên bản nghiệm thu](acceptance/2026-11-18.md), điền **Đạt**, **Lỗi** hoặc **Chưa chạy** theo từng phép thử. Việc cài và thao tác trên máy đích dùng cùng commit với artifact đã kiểm trên CI. [Checklist Windows và macOS](../windows-checklist.md) · [Kịch bản fixture và NestJS](../demo-script.md) · [Smoke đóng gói](../../apps/desktop/scripts/smoke-packaged.mjs) · [Cài đặt từ mã nguồn](../install-notes.md).

## Bản xem trước Code-OSS

Code-OSS có editor native và dùng lại giao diện/engine NexGraph. Bản xem trước có build riêng. Khi xét chuyển thành bản chính, yêu cầu một lượt CI riêng trên Windows và macOS với engine kèm theo, mở được trên máy sạch, cùng biên bản kiểm mở đúng dòng, lập chỉ mục, refresh, duyệt AI và dọn tiến trình. Ghi riêng kết quả xuất PNG vì lớp tương thích hiện chưa hỗ trợ thao tác này. [Build Code-OSS](../../apps/shell/README.md) · [Lớp tương thích](../../apps/extension/src/electron-host.ts)
