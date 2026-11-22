# Cài đặt và chạy NexGraph

Tài liệu này hướng dẫn phát triển và đóng gói từ mã nguồn. Để cài NexGraph 0.2.0 Electron/Monaco bằng tệp tải từ CI, xem [hướng dẫn bản phát hành](release/README.md). Cách chạy test và các nhóm test opt-in ở [hướng dẫn kiểm thử](testing.md). [Lớp phủ Code-OSS](../apps/shell/README.md) có quy trình dựng riêng.

## Chạy Electron từ checkout sạch

Cần Git, Node.js 22.19.0 trở lên (khuyến nghị Node.js 24), pnpm `11.24.0` theo `package.json` và uv trong `PATH`. Kiểm bằng `git --version`, `node --version`, `pnpm --version` và `uv --version` trong terminal sẽ dùng để chạy dự án. Kho riêng tư cần tài khoản GitHub có quyền đọc. Với máy mới, clone repo trước bằng `git clone https://github.com/twotnguyen/nexgraph.git` rồi `cd nexgraph`. Thực hiện các lệnh sau từ thư mục gốc repo trong PowerShell trên Windows hoặc terminal trên macOS.

```sh
pnpm run setup:dev
pnpm dev
```

`setup:dev` đồng bộ Python 3.12 và dependency từ `engine/uv.lock`, thử nạp CLI engine, cài dependency JavaScript từ `pnpm-lock.yaml` rồi tải binary Electron bằng `install-electron`. Lần đầu cần kết nối mạng để tải các phụ thuộc. `pnpm dev` tự khởi động engine qua uv. Khi thấy **Engine: sẵn sàng**, chọn **Mở thư mục…** và chọn bản sao dự án. Dự án nhỏ được lập chỉ mục tự động, dự án vượt ngưỡng hiển thị lựa chọn phạm vi. Khi hoàn tất, bấm **Bắt đầu khám phá** để mở không gian làm việc. Dự án gần đây đã có chỉ mục mở thẳng vào không gian làm việc. Lập chỉ mục và khám phá graph dùng được khi chưa cấu hình AI. [Chi tiết bước tải Electron](https://www.electronjs.org/docs/latest/tutorial/installation#binary-download-step) · [Dự án mẫu](demo-script.md)

- Nếu gặp `Electron uninstall`, chạy lại `pnpm run setup:dev` và kiểm phần tải binary. Nếu máy mới cài uv, mở lại terminal rồi thử `uv --version` trong chính terminal dùng để chạy `pnpm dev`.
- Nếu Windows báo Application Control khi nạp Python, dùng bản Python 3.12 đã được cho phép trên máy. Đặt `$env:UV_PYTHON` thành đường dẫn đầy đủ đến `python.exe` đó, rồi chạy lại cả hai lệnh trong cùng phiên PowerShell.

Với checkout đã có, sau khi thay đổi được hợp nhất và nhánh `main` cục bộ sạch, chạy `git pull --ff-only`, rồi chạy lại hai lệnh trên. Dependency được tái tạo từ các lockfile, dữ liệu gần đây và khóa AI được lưu riêng trên từng máy.

Trong không gian làm việc, cây bên trái duyệt tệp trong dự án, kể cả tệp cấu hình và tài liệu ngoài chỉ mục. Các thẻ ở giữa hiển thị Monaco hoặc sơ đồ, trợ lý AI nằm bên phải. `Ctrl+L` hoặc `⌘L` bật/tắt trợ lý và `Ctrl+S` hoặc `⌘S` lưu tệp đang mở. Nút **← Tổng quan** mở số liệu, tùy chọn index, Git hook và tích hợp MCP. Cổng Vite in ra terminal phục vụ renderer Electron, thao tác đầy đủ trong cửa sổ NexGraph.

Từ gốc kho, kiểm tra mã bằng

```sh
uv run --project engine --locked pytest engine/tests -q
pnpm --filter @nexgraph/desktop typecheck
pnpm --filter @nexgraph/desktop test
```

## Đóng gói Electron

Chạy trên hệ điều hành cần đóng gói, sau khi cài phụ thuộc như trên:

```sh
cd engine
uv run --locked pyinstaller packaging/nexgraph-engine.spec --noconfirm
cd ..
pnpm --filter @nexgraph/desktop run package
pnpm --filter @nexgraph/desktop run smoke:packaged
```

Bộ cài nằm ở `apps/desktop/dist/`, với tên `NexGraph-<version>-macos-<arch>.dmg` hoặc `NexGraph-<version>-windows-<arch>.exe`. Lệnh `smoke:packaged` ở trên dùng app đã giải nén để kiểm nhanh khi phát triển. Trong CI, script mở app do chính tệp NSIS cài vào thư mục tạm hoặc app được chép từ DMG vừa gắn. Lượt này dùng thư mục dữ liệu tạm, engine đi kèm và mô hình giả cục bộ. Tải bộ cài và tệp `.build.json` đối chiếu theo [hướng dẫn bản bàn giao](release/README.md#tải-đúng-bộ-cài).

| Bằng chứng | Phạm vi |
| --- | --- |
| [Kiểm trên macOS ngày 15/11/2026](benchmarks/2026-11-15-editor-agent.md) | Bản Electron arm64 chưa ký, DMG khoảng 239,2 MB. Đã bấm thử editor và Agent trên fixture Python với engine thật và LLM giả. |
| [CI Electron](https://github.com/twotnguyen/nexgraph/actions/workflows/ci.yml) | Job desktop kiểm setup và chạy dev. Job package kiểm bộ cài của checkout ghi trong tệp `.build.json` trước khi tải artifact lên. Xem log và tải artifact cần đăng nhập GitHub. |
| [Nghiệm thu trên máy đích](release/acceptance/2026-11-18.md) | Ghi cài đặt và thao tác trên bộ cài Windows và macOS theo [checklist](windows-checklist.md), kèm thời gian từng lượt demo NestJS. Ghi loại provider và client MCP nếu đã thử. |

## Chạy Code-OSS

`apps/shell/` ghim upstream Code-OSS. `apps/extension/` dùng lại engine và giao diện graph của NexGraph. Thao tác mở mã chuyển sang editor của Code-OSS, Agent nằm ở thanh bên phụ. Làm theo [hướng dẫn dựng shell](../apps/shell/README.md), gồm phiên bản Node/pnpm riêng trong `upstream.json`, Visual Studio Build Tools C++ trên Windows và cấu hình engine khi chạy dev. Script chỉ kèm engine trong bản đóng gói nếu có kết quả PyInstaller trước đó. Workflow [CI hiện hành](../.github/workflows/ci.yml) kiểm bản Electron độc lập. Trạng thái bộ cài và nghiệm thu Code-OSS cần bằng chứng riêng.

## Cài đặt tài khoản AI

Trong khung trợ lý, chọn **Kết nối**, chọn nhà cung cấp và phương thức xác thực. **Gemini → Tài khoản Google** thiết lập Antigravity CLI chính thức rồi đăng nhập Google trong trình duyệt; **Gemini → API key** vẫn dùng key Google AI Studio qua Pi. Gemini CLI cũ đã ngừng phục vụ tài khoản cá nhân/AI Pro từ 18/6/2026; luồng mới dùng `agy acp` được Google hỗ trợ. Hai lựa chọn có quyền/quota riêng và không tự chuyển khi gặp lỗi. Antigravity CLI là binary native, không cần Node riêng; lần thiết lập đầu cần mạng. **Cài đặt → Tài khoản AI** vẫn quản lý nhà cung cấp tùy chỉnh. Dùng **Kiểm tra kết nối và công cụ** trước khi kích hoạt. Đăng nhập ChatGPT đi qua trình duyệt; việc mở trang thành công chưa xác nhận token và lời gọi model thành công. Claude dùng Anthropic API key. Xem [hướng dẫn trợ lý AI](ai-workbench.md).

- Base URL custom mặc định dùng HTTPS và phải qua kiểm tra địa chỉ mạng. Để thử máy chủ HTTP loopback tùy chỉnh, khởi động app với `NEXGRAPH_ALLOW_HTTP_PROVIDER=1` theo [kịch bản fixture](demo-script.md#kiểm-nhanh-bằng-fixture-python). Kết nối **Ollama local** có luồng riêng cho loopback, không cần cờ dev này. Custom endpoint không có API key vẫn nhận `Authorization: Bearer unused` do SDK pi.
- API key và token OAuth của Pi dùng kho mã hóa của NexGraph. Token OAuth Pi nằm trong `agent/oauth-secrets.json` dưới thư mục dữ liệu engine. NexGraph thử di trú `agent/auth.json` của bản cũ khi kho khóa an toàn khả dụng. Hội thoại Pi lưu tại `agent/sessions/`, tách theo dự án, gốc thư mục, nhà cung cấp, đích gửi và danh tính kết nối.
- Đăng nhập Google do Antigravity CLI quản lý; token CLI không được đưa vào kho Pi hay renderer. Cấu hình NexGraph cho CLI nằm dưới `antigravity/`, binary chính thức được tải với hash được ghim. Kho xác thực của CLI có thể dùng chung với Antigravity trên máy, không thuộc kho token mã hóa Pi. Lịch sử NexGraph cho runtime này nằm tại `antigravity/sessions/`. **Ngắt kết nối NexGraph** chỉ dừng kết nối trong ứng dụng, không đăng xuất tài khoản Google khỏi các công cụ khác.
- Lần gửi đầu cho mỗi dự án, tài khoản và đích gửi yêu cầu đồng ý. **Hỏi** và **Kế hoạch** chỉ đọc. Trong **Sửa → Quyền & giới hạn**, chọn duyệt từng thay đổi hoặc tự động và bật quyền chạy lệnh riêng. Quyền này trở về duyệt từng thay đổi, không chạy lệnh khi đóng dự án. Checkpoint chỉ khôi phục mã nguồn văn bản đã thu thập trong phạm vi cho phép.
- Trên Electron, Monaco giữ CRLF/BOM khi lưu. Thẻ có thay đổi chưa lưu được giữ lại nếu tệp trên đĩa đổi. Editor đánh dấu chỉ đọc khi tệp vượt 5 MiB hoặc không phải UTF-8.

## Git hook cập nhật sau commit

Trong **Tổng quan dự án → Cập nhật sau mỗi commit**, NexGraph thêm khối giữa `# >>> nexgraph >>>` và `# <<< nexgraph <<<` vào thư mục hook Git thật sự có hiệu lực: tôn trọng `core.hooksPath` (kể cả Husky 9 với `<hooksPath>/_`), worktree có `.git` là tệp và dự án nằm trong thư mục con. Khối gọi `nexgraph-engine refresh` ở nền. Có thể gỡ qua giao diện hoặc xóa đúng khối đó bằng tay; khi nhiều worktree dùng chung thư mục hook, NexGraph chỉ gỡ khối của chính dự án đó. `core.hooksPath` trỏ **ra ngoài kho** thì NexGraph từ chối ghi (`unsupported_hook_path`, trạng thái `outside_repo`). Hook có sẵn cần shebang shell tương thích (`sh`, `bash`, `dash`, `ksh` hoặc `zsh`). NexGraph giữ nguyên hook có interpreter khác. [Mã hook phía app](../../apps/desktop/src/main/git-hook.ts) · [Tương đương graphify](../../engine/src/graphify/hooks.py)

## Tích hợp trợ lý AI ngoài NexGraph

Ghi `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor), `.vscode/mcp.json` (VS Code), `opencode.json` (OpenCode), `.codex/config.toml` (Codex) sau khi bạn xem trước và xác nhận. Chỉ thêm mục `nexgraph`; tệp không phân tích được (JSON hỏng hoặc có chú thích `//`, TOML đã có sẵn) thì không ghi, dùng nút "Sao chép cấu hình".

### 21 nền tảng, gỡ và hook nhắc dùng graph (W5, 2026-11-21)

Hộp thoại có 21 trợ lý. Mỗi trợ lý ghi tối đa bốn phần, mỗi phần có xem trước:

- **cấu hình MCP**: ngoài 5 tệp ở trên còn có `.gemini/settings.json` (`mcpServers`) và `.kiro/settings/mcp.json` (`mcpServers`);
- **quy tắc hỏi graph trước**:
  - khối marker trong `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `CODEBUDDY.md` hoặc `.github/copilot-instructions.md`;
  - hoặc tệp riêng `.cursor/rules/nexgraph.mdc`, `.kiro/steering/nexgraph.md`, `.windsurf/rules/nexgraph.md`, `.agents/rules/nexgraph.md`;
- **skill**: `<thư mục của trợ lý>/skills/nexgraph/SKILL.md`;
- **hook**:
  - Claude Code và CodeBuddy: `PreToolUse` trong `.claude/settings.json` và `.codebuddy/settings.json`;
  - Gemini CLI: `BeforeTool` trong `.gemini/settings.json`;
  - OpenCode và Kilo: plugin `.opencode/plugins/nexgraph.js` và `.kilo/plugins/nexgraph.js`, Kilo đăng ký thêm trong `.kilo/kilo.json`.

Nút **Gỡ…** xem trước rồi thực hiện:

- chỉ bỏ mục, khối hoặc hook của NexGraph, phần còn lại của tệp giữ nguyên;
- tệp Markdown, skill, plugin chỉ còn phần của NexGraph thì bị xoá, kèm các thư mục cha trở nên rỗng (dừng ở gốc dự án);
- tệp JSON (`.mcp.json`, `settings.json`, `kilo.json`…) còn rỗng thì giữ lại dạng `{}`, vì không phân biệt được với tệp `{}` có sẵn của người dùng;
- trong `hooks`, chỉ bỏ từng lệnh `hook-guard` của NexGraph; lệnh khác cùng nhóm matcher được giữ;
- skill không có frontmatter `name: nexgraph` thì không bị xoá.

`AGENTS.md` và `.agents/skills/nexgraph/` dùng chung cho nhiều trợ lý.

Hook gọi `nexgraph-engine hook-guard read|search|gemini --project <dự án> --data-dir <thư mục app> [--strict]`:

- **Khi nào nhắc:** lệnh trả `additionalContext` khi graph còn mới mà trong 30 phút qua chưa có lần gọi MCP `query_graph` hoặc `get_context`. "Còn mới" nghĩa là HEAD trùng commit đã index và tệp đích không đổi sau lần index.
- **Tem thời gian:** ghi ở `<thư mục app>/projects/<id>/last_query_stamp`.
- **Chế độ nghiêm (strict):** chỉ có ở Claude Code và CodeBuddy. Chặn lần `Read` đầu tiên mỗi phiên khi chưa hỏi graph. Grep, Glob và Bash chỉ được nhắc, không bị chặn.
- **Bỏ qua:** tệp trong `.nexgraph/`, và `file_path`/`path` (của Read, Grep, Glob) nằm ngoài dự án.
- **Không bao giờ chặn nhầm:** mọi lỗi, kể cả stdin hỏng hay tham số sai, đều cho lệnh thoát 0 và không in gì.

### Skill và khối quy tắc

Nội dung skill và khối quy tắc sinh từ cùng nguồn với phần "Quy tắc dùng đồ thị NexGraph" trong app (gồm danh sách tool chỉ đọc của MCP). Hai mục lẻ "Skill nexgraph (Claude Code)" và "Khối nexgraph trong AGENTS.md" trước đây nay là phần skill của **Claude Code** và phần quy tắc của **Agent Skills (AGENTS.md)**.

- **SKILL.md:** frontmatter `name`/`description` + quy tắc. Tệp đã có cùng nội dung → "Đã cài"; khác → **không ghi đè**, hiện nội dung để ghép tay.
- **Khối marker:** chèn hoặc thay khối giữa `<!-- nexgraph:start -->` và `<!-- nexgraph:end -->`. Phần ngoài khối giữ nguyên từng byte, khối dùng kiểu xuống dòng của tệp (CRLF hoặc LF); chưa có tệp thì tạo tệp chỉ gồm khối.
- Tệp JSON có BOM vẫn đọc được (BOM bị bỏ khi ghi lại).
- Mọi đường dẫn đều được kiểm symlink: symlink (kể cả symlink treo) trỏ ra ngoài dự án bị chặn và không ghi gì.

### Đối chiếu nguồn chính thức (2026-11-13; hàng Codex tra ngày 2026-11-15)

| Client | Cấu hình được NexGraph ghi | Nguồn |
|---|---|---|
| Claude Code | `.mcp.json`, `mcpServers.nexgraph`, `type: stdio`, `command` và `args`; skill: `.claude/skills/nexgraph/SKILL.md` | [Project scope và stdio](https://code.claude.com/docs/en/mcp) |
| Cursor | `.cursor/mcp.json`, `mcpServers.nexgraph`, `type: stdio`, `command` và `args` | [MCP](https://cursor.com/docs/mcp), [vị trí tệp](https://cursor.com/help/customization/mcp) |
| VS Code | `.vscode/mcp.json`, `servers.nexgraph`, `type: stdio`, `command` và `args` | [Editor-managed configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration#_editor-managed-configuration-for-local-harness-compatibility) |
| OpenCode | `opencode.json` hoặc tệp `opencode.json(c)` có sẵn, `mcp.servers.nexgraph`, `type: local`, `command` là mảng | [JSON schema chính thức](https://opencode.ai/config.json), [MCP](https://opencode.ai/docs/mcp-servers/) |
| Codex | `.codex/config.toml` của dự án (tạo khi chưa có), `[mcp_servers.nexgraph]`, `command` và `args`, định dạng TOML | [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp), [config.toml](https://learn.chatgpt.com/docs/config-file/config-advanced) (tra 2026-11-15) |

Codex (tài liệu OpenAI tra ngày 2026-11-15): MCP cấu hình bằng bảng `[mcp_servers.<tên>]` với `command`, `args` (stdio); Codex đọc thêm `.codex/config.toml` của dự án nhưng **chỉ khi dự án được đánh dấu tin cậy trong Codex** — cấu hình dự án không được tin cậy sẽ bị bỏ qua, kể cả layer `.codex/`. NexGraph không bao giờ ghi `~/.codex/config.toml` toàn cục. Nếu `.codex/config.toml` đã có trong dự án, NexGraph không phân tích/sửa TOML: sao chép mục `[mcp_servers.nexgraph]` rồi dán vào tệp dự án hoặc tệp toàn cục bằng tay.

NexGraph tạo mục `mcp.servers.nexgraph` theo OpenCode V2. Nếu tệp hiện có đặt các server trực tiếp dưới `mcp` theo V1, NexGraph dùng cùng cấu trúc. Khi dự án đã có cấu hình trong `.opencode/`, NexGraph ưu tiên tệp đó theo thứ tự của OpenCode. Sau khi xác nhận ghi cấu hình, chạy `opencode mcp list` từ thư mục dự án. Nếu OpenCode đang khởi động và hiện `pending` hoặc chưa liệt kê server, đợi vài giây rồi chạy lại.

VS Code đánh dấu Local harness/editor-managed là deprecated; `.vscode/mcp.json` vẫn là cấu hình hợp lệ của editor và có thể forward sang Copilot. Copilot native dùng `.mcp.json`/`mcpServers`; không đồng nhất hai schema. Chọn Claude Code trong NexGraph nếu cần xuất dạng workspace-root `.mcp.json` rồi đối chiếu hướng dẫn Copilot.

Đây là đối chiếu schema. Để nghiệm thu runtime, mở một dự án đã lập chỉ mục bằng client cần dùng và gọi tool NexGraph như `graph_stats`. JSONC có chú thích vẫn chỉ sao chép cấu hình để ghép tay: không ghi lại làm mất chú thích.
