# Cài đặt và chạy NexGraph

Hướng dẫn chạy và demo trong kho này dùng **Electron độc lập** (`apps/desktop`). [Lớp phủ Code-OSS](../apps/shell/README.md) có quy trình dựng riêng. Máy kiểm thử cần ghi rõ mình đang chạy bản nào và commit của bản đó.

## Chạy Electron từ checkout sạch

Cần Git, Node.js 24 (kho yêu cầu Node ≥ 22), pnpm `11.24.0` theo `package.json` và uv trong `PATH`. Engine yêu cầu Python 3.12. Thực hiện từ thư mục gốc kho trong PowerShell trên Windows hoặc terminal trên macOS:

```sh
uv python install 3.12
uv sync --project engine --python 3.12 --locked
pnpm install --frozen-lockfile
pnpm --filter @nexgraph/desktop exec install-electron
pnpm dev
```

`install-electron` tải binary Electron 44 cho máy hiện tại. Đợi tải xong rồi mới chạy `pnpm dev`. Ứng dụng tự khởi động engine từ mã nguồn qua uv. Chọn **Mở thư mục…**, chọn một bản sao dự án và dựng graph. Phần lập chỉ mục và khám phá graph dùng được khi chưa cấu hình AI. Xem [hướng dẫn tải binary Electron](https://www.electronjs.org/docs/latest/tutorial/installation#binary-download-step) và [fixture cùng kịch bản NestJS](demo-script.md).

Từ gốc kho, kiểm tra mã bằng:

```sh
uv run --project engine pytest engine/tests -q
pnpm --filter @nexgraph/desktop typecheck
pnpm --filter @nexgraph/desktop test
```

## Đóng gói Electron

Chạy trên hệ điều hành cần đóng gói, sau khi cài phụ thuộc như trên:

```sh
cd engine
uv run pyinstaller packaging/nexgraph-engine.spec --noconfirm
cd ..
pnpm --filter @nexgraph/desktop run package
pnpm --filter @nexgraph/desktop run smoke:packaged
```

Bộ cài nằm ở `apps/desktop/dist/` (`.dmg` trên macOS, `.exe` NSIS trên Windows). Smoke mở bản dựng đã giải nén với engine đóng gói, dự án và thư mục dữ liệu tạm. Kết quả đạt có dòng `SMOKE OK` kèm `fs=OK agent=OK`. Script tự chạy LLM giả cục bộ. Để kiểm việc cài bộ cài, mở app trên máy đích và ghi kết quả riêng theo [danh sách kiểm Windows](windows-checklist.md). Với bản chưa ký số, ghi lại cảnh báo Gatekeeper hoặc SmartScreen nếu xuất hiện.

| Bằng chứng | Phạm vi |
| --- | --- |
| [Kiểm trên macOS ngày 15/11/2026](benchmarks/2026-11-15-editor-agent.md) | Bản Electron arm64 chưa ký, DMG khoảng 239,2 MB. Đã bấm thử editor và Agent trên fixture Python với engine thật và LLM giả. |
| [CI Electron run 44065280698](https://github.com/twotnguyen/nexgraph/actions/runs/44065280698) | Cả sáu job engine, desktop và package/smoke trên macOS và Windows qua tại `6687fc9`. Kho riêng tư, cần quyền xem log và artifact. |
| Còn chờ nghiệm thu | Cài artifact trên máy Windows của nhóm, chạy đủ ba lượt demo NestJS trên bản đóng gói, kiểm nhà cung cấp AI thật và client MCP ngoài app. |

## Chạy Code-OSS

`apps/shell/` ghim upstream Code-OSS. `apps/extension/` dùng lại engine và giao diện graph của NexGraph. Thao tác mở mã chuyển sang editor của Code-OSS, Agent nằm ở thanh bên phụ. Làm theo [hướng dẫn dựng shell](../apps/shell/README.md), gồm phiên bản Node/pnpm riêng trong `upstream.json`, Visual Studio Build Tools C++ trên Windows và cấu hình engine khi chạy dev. Script chỉ kèm engine trong bản đóng gói nếu có kết quả PyInstaller trước đó. Workflow [CI hiện hành](../.github/workflows/ci.yml) kiểm bản Electron độc lập. Trạng thái bộ cài và nghiệm thu Code-OSS cần bằng chứng riêng.

## Cài đặt tài khoản AI

Trong **Cài đặt → Tài khoản AI**, chọn nhà cung cấp có sẵn và nhập API key, hoặc thêm **Nhà cung cấp tuỳ chỉnh** với tên, Base URL và model. Chọn model có tool calling và bấm **Kiểm tra kết nối**. Với nhà cung cấp có OAuth, màn hình có thể mở trình duyệt, hiện device code hoặc hỏi mã. Các test OAuth dùng provider giả qua SDK pi.

- Base URL custom mặc định dùng HTTPS và phải qua kiểm tra địa chỉ mạng. Để thử máy chủ HTTP loopback cục bộ, khởi động app với `NEXGRAPH_ALLOW_HTTP_PROVIDER=1` theo [kịch bản fixture](demo-script.md#kiểm-nhanh-bằng-fixture-python). Custom endpoint không có API key vẫn nhận `Authorization: Bearer unused` do SDK pi.
- API key được mã hóa qua kho bí mật của ứng dụng. OAuth lưu token trong `agent/auth.json` thuộc thư mục dữ liệu của NexGraph, quyền tệp `0600` trên Unix. Các phiên hội thoại của Agent giữ trong bộ nhớ.
- Lần gửi đầu cho mỗi cặp dự án và máy chủ yêu cầu đồng ý. **Hỏi** mặc định chỉ đọc. **Sửa** đòi xác nhận từng lần ghi, sửa hoặc chạy lệnh. Lệnh `bash` chạy bằng quyền người dùng, không có sandbox.
- Trên Electron, Monaco giữ CRLF/BOM khi lưu. Thẻ có thay đổi chưa lưu được giữ lại nếu tệp trên đĩa đổi. Editor đánh dấu chỉ đọc khi tệp vượt 5 MiB hoặc không phải UTF-8.

## Git hook cập nhật sau commit

Trong **Tổng quan dự án → Cập nhật sau mỗi commit**, NexGraph thêm khối giữa `# >>> nexgraph >>>` và `# <<< nexgraph <<<` vào `.git/hooks/post-commit`; khối gọi `nexgraph-engine refresh` ở nền. Có thể gỡ qua giao diện hoặc xóa đúng khối đó bằng tay. Hiện luồng này không hỗ trợ `core.hooksPath` và Git worktree có `.git` là tệp. Hook có sẵn cần shebang shell tương thích (`sh`, `bash`, `dash`, `ksh` hoặc `zsh`). NexGraph giữ nguyên hook có interpreter khác.

## Tích hợp trợ lý AI ngoài NexGraph

Ghi `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor), `.vscode/mcp.json` (VS Code), `opencode.json` (OpenCode), `.codex/config.toml` (Codex) sau khi bạn xem trước và xác nhận. Chỉ thêm mục `nexgraph`; tệp không phân tích được (JSON hỏng hoặc có chú thích `//`, TOML đã có sẵn) thì không ghi, dùng nút "Sao chép cấu hình".

### Skill nexgraph cho agent ngoài

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

Đây là đối chiếu schema. Để nghiệm thu runtime, mở một dự án đã lập chỉ mục bằng client cần dùng và gọi tool NexGraph như `graph_stats`. JSONC có chú thích vẫn chỉ sao chép cấu hình để ghép tay: không ghi lại làm mất chú thích.
