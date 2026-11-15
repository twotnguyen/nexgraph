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

Giới hạn: không streaming; lịch sử trong Workspace được gửi làm ngữ cảnh cho câu tiếp theo. Hội thoại và nháp giữ trong RAM khi ẩn/hiện chat, mất khi rời Workspace; lúc đó lượt đang chạy bị huỷ. Tối đa 8 vòng gọi tool mỗi câu hỏi. Lần gửi đầu cho mỗi cặp (dự án, máy chủ) có hộp thoại đồng ý. Kiểm đầu-cuối không cần key: `NEXGRAPH_E2E=1 pnpm --filter @nexgraph/desktop test ai-e2e` (engine Python thật + LLM giả).

Chọn **Thay**, để key rỗng rồi **Lưu** là xoá key đã lưu. Đổi origin (scheme/hostname/port) tự xoá key cũ nếu không nhập key mới; đổi model/path trong cùng origin giữ key.

## Git hook cập nhật sau commit (H5)

Tổng quan dự án → "Cập nhật sau mỗi commit" ghi một khối vào `.git/hooks/post-commit` giữa hai dòng `# >>> nexgraph >>>` và `# <<< nexgraph <<<`, chạy `nexgraph-engine refresh` ở nền. **Gỡ bằng tay:** xoá đúng khối giữa hai dòng đó (nếu tệp chỉ còn `#!/bin/sh` thì xoá tệp). Không hỗ trợ `core.hooksPath` (husky…) và worktree (`.git` là tệp): thẻ báo "không phải kho Git".

Installer từ chối `post-commit` hiện có dùng Python/Node hoặc interpreter không xác định; không ghi/chmod tệp đó. Chỉ ghép vào hook có shebang shell tương thích (`sh`, `bash`, `dash`, `ksh`, `zsh`, trực tiếp hoặc qua `env`).

## Tích hợp trợ lý AI (H5)

Ghi `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor), `.vscode/mcp.json` (VS Code), `opencode.json` (OpenCode), `.codex/config.toml` (Codex) sau khi bạn xem trước và xác nhận. Chỉ thêm mục `nexgraph`; tệp không phân tích được (JSON hỏng hoặc có chú thích `//`, TOML đã có sẵn) thì không ghi, dùng nút "Sao chép cấu hình".

### Skill nexgraph cho agent ngoài (F15)

Tổng quan dự án → "Tích hợp trợ lý AI" có thêm hai mục skill, nội dung sinh từ cùng nguồn với phần "Quy tắc dùng đồ thị NexGraph" trong app (gồm danh sách tool chỉ đọc của MCP):

- **Skill nexgraph (Claude Code):** ghi `.claude/skills/nexgraph/SKILL.md` (frontmatter `name`/`description` + quy tắc). File đã có cùng nội dung → báo "Đã cài"; khác → **không ghi đè**, hiện nội dung để người dùng ghép tay.
- **Khối nexgraph trong AGENTS.md:** chèn hoặc thay khối giữa hai dòng `<!-- nexgraph:start -->` và `<!-- nexgraph:end -->`. Phần ngoài khối giữ nguyên từng byte; chưa có `AGENTS.md` thì tạo tệp chỉ gồm khối. Khối dùng được cho mọi agent đọc AGENTS.md (Codex, Cursor…).
- Cả hai đường dẫn đều được kiểm symlink: symlink (kể cả symlink treo) trỏ ra ngoài dự án bị chặn và không ghi gì.

### Đối chiếu nguồn chính thức (2026-11-13; hàng Codex tra ngày 2026-11-15)

| Client | Cấu hình được NexGraph ghi | Nguồn |
|---|---|---|
| Claude Code | `.mcp.json`, `mcpServers.nexgraph`, `type: stdio`, `command` và `args`; skill: `.claude/skills/nexgraph/SKILL.md` | [Project scope và stdio](https://code.claude.com/docs/en/mcp) |
| Cursor | `.cursor/mcp.json`, `mcpServers.nexgraph`, `type: stdio`, `command` và `args` | [MCP](https://cursor.com/docs/mcp), [vị trí tệp](https://cursor.com/help/customization/mcp) |
| VS Code | `.vscode/mcp.json`, `servers.nexgraph`, `type: stdio`, `command` và `args` | [Editor-managed configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration#_editor-managed-configuration-for-local-harness-compatibility) |
| OpenCode | `opencode.json` (hoặc `.jsonc` có sẵn), `mcp.nexgraph`, `type: local`, `command` là mảng | [JSON schema chính thức](https://opencode.ai/config.json), [MCP](https://opencode.ai/docs/mcp-servers/) |
| Codex | `.codex/config.toml` của dự án (tạo khi chưa có), `[mcp_servers.nexgraph]`, `command` và `args`, định dạng TOML | [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp), [config.toml](https://learn.chatgpt.com/docs/config-file/config-advanced) (tra 2026-11-15) |

Codex (tài liệu OpenAI tra ngày 2026-11-15): MCP cấu hình bằng bảng `[mcp_servers.<tên>]` với `command`, `args` (stdio); Codex đọc thêm `.codex/config.toml` của dự án nhưng **chỉ khi dự án được đánh dấu tin cậy trong Codex** — cấu hình dự án không được tin cậy sẽ bị bỏ qua, kể cả layer `.codex/`. NexGraph không bao giờ ghi `~/.codex/config.toml` toàn cục. Nếu `.codex/config.toml` đã có trong dự án, NexGraph không phân tích/sửa TOML: sao chép mục `[mcp_servers.nexgraph]` rồi dán vào tệp dự án hoặc tệp toàn cục bằng tay.

OpenCode hiện mô tả dạng mới `mcp.servers`; schema chính thức vẫn nhận dạng trực tiếp `mcp.<tên>` nhưng đánh dấu deprecated. NexGraph giữ dạng đang được schema nhận, không tự di chuyển server khác của người dùng. Đã kiểm binary có trên máy: `opencode v2.2.7`; không còn là 2.1.4 trong ghi chú spike cũ.

VS Code đánh dấu Local harness/editor-managed là deprecated; `.vscode/mcp.json` vẫn là cấu hình hợp lệ của editor và có thể forward sang Copilot. Copilot native dùng `.mcp.json`/`mcpServers`; không đồng nhất hai schema. Chọn Claude Code trong NexGraph nếu cần xuất dạng workspace-root `.mcp.json` rồi đối chiếu hướng dẫn Copilot.

Đây là đối chiếu schema, không phải bằng chứng đã kết nối bằng cả bốn client. JSONC có chú thích vẫn chỉ sao chép cấu hình để ghép tay: không ghi lại làm mất chú thích.

## Editor và agent tích hợp (F13–F15, 2026-11-15)

- Monaco mở nhiều thẻ tệp, Cmd/Ctrl+S lưu qua main; thẻ bẩn không tự nạp lại khi tệp đổi bên ngoài. Tệp lớn hơn 5 MB hoặc không phải UTF-8 chỉ đọc. Giữ CRLF, BOM và quyền tệp.
- Agent mặc định **Hỏi** (13 tool chỉ đọc: 9 tool đồ thị và read/grep/find/ls). **Sửa** thêm write/edit/bash; mỗi thao tác phải được duyệt. Diff bị cũ hoặc đích bị tráo symlink thì từ chối, không tự áp lại.
- `bash` **không có sandbox**, chạy bằng quyền người dùng sau khi duyệt; không có "luôn cho phép". Windows chưa kiểm shell thực tế, xem `windows-checklist.md`.
- Tài khoản AI ưu tiên API key và custom provider; key mã hoá qua safeStorage, chỉ nạp vào runtime. OAuth có thể mở trình duyệt, hiện device code hoặc hỏi mã trong Settings; huỷ/rời màn thì huỷ lượt đăng nhập. Token OAuth lưu trong `agent/auth.json` của thư mục dữ liệu ứng dụng, quyền 0600 trên Unix. Không dùng chung `~/.pi`.
- Endpoint custom không cần key nhận sentinel `Bearer unused` do SDK OpenAI của pi yêu cầu key; server phải bỏ qua header này (như Ollama). Không phải API key thật. Nếu server từ chối header dư thì hiện chưa hỗ trợ endpoint đó.
- API key/OAuth với nhà cung cấp thật và Windows **chưa kiểm**; các test OAuth dùng provider giả đăng ký qua SDK pi thật, không chứng minh nhà cung cấp cho phép đăng nhập bên thứ ba.
- `smoke:packaged` dùng engine đóng gói, một máy chủ LLM giả cục bộ và renderer thật để kiểm `fs:write/read` cùng `agent:prompt → done`. Kho userData và dự án đều tạm; không đọc/ghi tài khoản người dùng. Kiểm giao diện với dữ liệu tạm có thể đặt `NEXGRAPH_USER_DATA_DIR` và `NEXGRAPH_DATA_DIR`; mặc định sản phẩm không đổi.

### Bản macOS editor + agent đã kiểm ngày 2026-11-15

`apps/desktop/dist/NexGraph-0.1.0-arm64.dmg`: **239.223.266 byte (~239,2 MB)**, dưới ngưỡng 400 MB sau khi giới hạn ngữ pháp Monaco. Typecheck sạch, 409 test desktop và 466 test engine đạt; smoke bản cài `SMOKE OK nodes=2 fs=OK agent=OK`. Đã bấm thử Monaco, hỏi có trích dẫn, tô luồng, duyệt/từ chối/dừng trên bản `.app` với engine thật và LLM giả cục bộ. Bằng chứng, ảnh và phần **chưa** nghiệm thu: [kiểm editor + agent](benchmarks/2026-11-15-editor-agent.md).
