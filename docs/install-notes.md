# Ghi chú cài đặt bản chưa ký số

Bản cài của NexGraph **chưa ký số**, nên macOS (Gatekeeper) và Windows (SmartScreen) sẽ cảnh báo. Bảng dưới ghi những gì đã kiểm tra thật và những gì chưa.

| Nền tảng | Đã kiểm tra | Kết quả |
|---|---|---|
| macOS 15 (Darwin 24.6), Apple Silicon, build cục bộ 2026-10-27 | Build `.dmg` và `NexGraph.app` bằng `pnpm --filter @nexgraph/desktop run package`; chạy `scripts/smoke-packaged.mjs` trên `.app` đã giải nén | `SMOKE OK nodes=2`; không còn tiến trình engine sau khi thoát; đường dẫn dữ liệu có dấu tiếng Việt (`Đồ án/data`) chạy được. `NexGraph-0.1.0-arm64.dmg` nặng **155 MB** (mục tiêu < 300 MB) |
| macOS: cài từ `.dmg` tải về từ CI, vượt Gatekeeper | **Chưa** | Chưa có CI chạy (chưa có remote GitHub); chưa thử mở app đã tải qua trình duyệt |
| Windows 10/11 (cài `.exe` NSIS, SmartScreen) | **Chưa** | Chưa có máy Windows trong phiên này. Việc của P3: tải `.exe` từ artifact CI, cài, ghi kết quả vào bảng này |
| Windows: kiểm thử `taskkill /T /F` diệt cả cây tiến trình | **Chưa** | Chỉ được kiểm bằng giá trị giả ở macOS |

## Cách vượt cảnh báo (theo tài liệu của từng hệ điều hành, chưa thử trên máy của nhóm)

- **macOS:** chuột phải vào `NexGraph.app`, chọn **Open**, rồi **Open** lần nữa. Nếu app tải qua trình duyệt bị chặn, có thể gỡ thuộc tính cách ly: `xattr -dr com.apple.quarantine /Applications/NexGraph.app`.
- **Windows:** ở cảnh báo SmartScreen chọn **More info**, rồi **Run anyway**.

## Việc còn lại để đóng Task 4

1. Tạo remote GitHub `nexgraph` (công khai), đẩy `main` và mở một PR để CI (`.github/workflows/ci.yml`) chạy trên macOS và Windows. Workflow chưa từng chạy.
2. P3 cài `.exe` trên Windows thật; P1 cài `.dmg` từ artifact CI; cập nhật bảng trên.

## Kế hoạch con 2: kiểm tra trên Windows (chưa làm)

Việc của P3 (kế hoạch con 2, Task 13 Step 4): chạy `uv run pytest` trong `engine/` và `pnpm --filter @nexgraph/desktop test`; mở `engine/tests/fixtures/bookstore_app` ở đường dẫn có dấu tiếng Việt và khoảng trắng, lập chỉ mục xong, mở thẻ Graph. Ghi kết quả vào bảng ở đầu tệp. Hai test dùng symlink (`test_symlink_*`) và một test quyền chỉ đọc tự bỏ qua trên Windows. Chưa có kết quả.

## Kế hoạch con 3: kiểm tra trên Windows (chưa làm)

Việc của P3 (kế hoạch con 3, Task 11 Step 5): chạy `uv run pytest` trong `engine/` và `pnpm --filter @nexgraph/desktop test`; mở `engine/tests/fixtures/bookstore_app` ở đường dẫn có dấu tiếng Việt và khoảng trắng, thử tìm kiếm (gõ có dấu và không dấu), thẻ Kiến trúc, bấm mũi tên xem bằng chứng, và thử một project lớn (tạo bằng `uv run python scripts/bench_search_arch.py --synthetic 6000` rồi mở thư mục sinh ra) để xem cảnh báo và chọn thư mục con. Ghi kết quả vào bảng ở đầu tệp. Chưa có kết quả.


## Kế hoạch con 4: kiểm trên Windows (P3, chưa làm)

Chưa kiểm trên Windows. Cần: `uv run pytest` ở `engine/` (cần `git` trong `PATH`; các test Git tự bỏ qua nếu thiếu), `pnpm --filter @nexgraph/desktop test`, mở `bookstore_app` ở đường dẫn có dấu và khoảng trắng, bật theo dõi và sửa tệp bằng trình soạn thảo thật (VS Code, Notepad), xem panel "Thay đổi", thử `git checkout` đổi nhánh (bão sự kiện), thử project không phải Git. Điểm có rủi ro riêng: `fs.watch` đệ quy trên NTFS, đường dẫn dùng `\` ở sự kiện (đã chuẩn hoá trong `shouldIgnore`), và `core.autocrlf` làm Git báo cả tệp là đã đổi.

## Trợ lý AI (H4)

Cài đặt → "Trợ lý AI": Base URL, model, API key (lưu bằng kho khoá của hệ điều hành, không bao giờ sang giao diện). Chỉ có adapter API key tương thích OpenAI (`POST <Base URL>/chat/completions` có `tools`).

| Nhà cung cấp | Base URL | Ghi chú |
|---|---|---|
| OpenRouter | `https://openrouter.ai/api/v1` | model có hỗ trợ tool calling |
| Ollama cục bộ | `http://localhost:11434/v1` | không cần key; model phải hỗ trợ tool calling (ví dụ `qwen2.5-coder`, `llama3.1`) |
| Máy chủ thử | `node apps/desktop/scripts/fake-llm.mjs` | LLM giả để kiểm không cần key |

Giới hạn: không streaming; lịch sử chat không lưu (mất khi rời màn Workspace); tối đa 8 vòng gọi tool mỗi câu hỏi. Lần gửi đầu cho mỗi cặp (dự án, máy chủ) có hộp thoại đồng ý. Kiểm đầu-cuối không cần key: `NEXGRAPH_E2E=1 pnpm --filter @nexgraph/desktop test ai-e2e` (engine Python thật + LLM giả).
