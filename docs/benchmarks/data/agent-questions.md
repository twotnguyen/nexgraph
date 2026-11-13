# Bộ câu hỏi Benchmark cho Coding Agent trên hermes-agent

Tài liệu này chứa 10 câu hỏi benchmark dùng để đánh giá năng lực hiểu mã nguồn và duyệt đồ thị phụ thuộc của AI coding agent trên dự án `hermes-agent` (git commit `cc8cc35e6074173d6a4afaeaa351d6cba250c0cc`). Toàn bộ đáp án ground-truth được trích xuất và xác minh trực tiếp bằng phân tích mã nguồn và các lệnh `grep`/`rg`/`read`.

---

## Q1

**Câu hỏi:** Những vị trí nào trong toàn bộ repo (bao gồm cả mã nguồn và tests) gọi hàm `strip_pattern_and_format`?

- **Loại:** ai gọi X
- **Đáp án:** Có đúng 4 vị trí gọi hàm trên toàn repo (đã bao gồm tests, không tính dòng khai báo `def`):
  1. `agent/auxiliary_client.py:1431`
  2. `agent/chat_completion_helpers.py:1418`
  3. `agent/turn_recovery.py:532`
  4. `tests/tools/test_schema_sanitizer.py:253`
- **Cách xác minh:**
  ```bash
  rg -n "\bstrip_pattern_and_format\(" .
  ```
- **Cách chấm:**
  - 1.0: Trả về đầy đủ cả 4 vị trí `file:line` chính xác, không thừa dòng sai.
  - 0.5: Thiếu tối đa 1 vị trí (<= 1/3) và không có vị trí sai nào.
  - 0.0: Thiếu từ 2 vị trí trở lên hoặc chứa vị trí sai.

---

## Q2

**Câu hỏi:** Những vị trí nào trong toàn bộ repo (bao gồm cả mã nguồn và tests) gọi hàm `is_secret_field_name`?

- **Loại:** ai gọi X
- **Đáp án:** Có đúng 4 vị trí gọi hàm trên toàn repo (đã bao gồm tests, không tính dòng khai báo `def`):
  1. `tools/delegation_redaction.py:91`
  2. `tools/mcp_tool_handlers.py:85`
  3. `tests/agent/test_redact.py:1739`
  4. `tests/agent/test_redact.py:1745`
- **Cách xác minh:**
  ```bash
  rg -n "\bis_secret_field_name\(" .
  ```
- **Cách chấm:**
  - 1.0: Trả về đầy đủ cả 4 vị trí `file:line` chính xác, không thừa dòng sai.
  - 0.5: Thiếu tối đa 1 vị trí (<= 1/3) và không có vị trí sai nào.
  - 0.0: Thiếu từ 2 vị trí trở lên hoặc chứa vị trí sai.

---

## Q3

**Câu hỏi:** Những vị trí nào trong toàn bộ repo (bao gồm cả mã nguồn và tests) gọi hàm `reset_file_dedup`?

- **Loại:** ai gọi X
- **Đáp án:** Có đúng 7 vị trí gọi hàm trên toàn repo (đã bao gồm tests, không tính dòng khai báo `def`):
  1. `agent/conversation_compression.py:3328`
  2. `tests/tools/test_code_execution_programmatic_reads.py:26`
  3. `tests/tools/test_code_execution_programmatic_reads.py:48`
  4. `tests/tools/test_file_read_guards.py:586`
  5. `tests/tools/test_file_read_guards.py:636`
  6. `tests/tools/test_file_staleness.py:175`
  7. `tests/tools/test_known_file_write_baseline.py:320`
- **Cách xác minh:**
  ```bash
  rg -n "\breset_file_dedup\(" .
  ```
- **Cách chấm:**
  - 1.0: Trả về đầy đủ cả 7 vị trí `file:line` chính xác.
  - 0.5: Thiếu tối đa 2 vị trí (<= 1/3) và không có vị trí sai nào.
  - 0.0: Thiếu từ 3 vị trí trở lên hoặc chứa vị trí sai.

---

## Q4

**Câu hỏi:** Khi chạy lệnh CLI `hermes status` (không truyền cờ phụ như `--full` hay `--deep`), luồng xử lý chính đi qua những hàm nào theo thứ tự gọi?

- **Loại:** luồng xử lý của Y đi qua những hàm nào
- **Đáp án:** Luồng gọi chính (call chain) gồm 6 bước theo thứ tự:
  1. `hermes_cli/main.py:3335` — `main()`
  2. `hermes_cli/main.py:1745` — `cmd_status(args)` (được tạo qua `_forward_command`, chuyển tiếp sang `hermes_cli.status.show_status`)
  3. `hermes_cli/status.py:419` — `show_status(args)`
  4. `hermes_cli/status.py:393` — `_render_summary(ctx)`
  5. `hermes_cli/status.py:375` — `_gateway_state()`
  6. `hermes_cli/gateway.py:1550` — `get_gateway_runtime_snapshot(system=False)`
- **Cách xác minh:**
  - Kiểm tra entrypoint `pyproject.toml` định tuyến `hermes = "hermes_cli.main:main"`.
  - Đọc `hermes_cli/main.py` tại dòng 3335 (`main`) và dòng 3444 (`args.func(args)`).
  - Đọc định nghĩa `cmd_status` tại dòng 1745 (`_forward_command("cmd_status", "hermes_cli.status", "show_status")`).
  - Đọc `hermes_cli/status.py` tại dòng 419 (`show_status` gọi `_render_summary(ctx)` khi không có `--full`/`--deep`).
  - Đọc `hermes_cli/status.py` tại dòng 393 (`_render_summary` gọi `_gateway_state()`).
  - Đọc `hermes_cli/status.py` tại dòng 375 (`_gateway_state` gọi `get_gateway_runtime_snapshot()`).
  - Đọc `hermes_cli/gateway.py` tại dòng 1550 (`def get_gateway_runtime_snapshot`).
- **Cách chấm:**
  - 1.0: Nêu đúng cả 6 hàm/file theo đúng thứ tự thực thi.
  - 0.5: Thiếu tối đa 2 bước (<= 1/3), các bước còn lại đúng thứ tự và không bịa hàm sai.
  - 0.0: Thiếu từ 3 bước trở lên hoặc sai lệch hoàn toàn về thứ tự/hàm.

---

## Q5

**Câu hỏi:** Khi Gateway ở trạng thái rảnh (idle) nhận được một `MessageEvent` chứa lệnh slash `/whoami`, luồng xử lý đi qua những hàm nào theo thứ tự gọi?

- **Loại:** luồng xử lý của Y đi qua những hàm nào
- **Đáp án:** Luồng xử lý chính gồm 6 bước theo thứ tự:
  1. `gateway/platforms/base.py:3913` — `BasePlatformAdapter.handle_message(event)`
  2. `gateway/platforms/base.py:4412` — `BasePlatformAdapter._process_message_background(event, session_key)` (spawn qua `_start_session_processing`)
  3. `gateway/run_inbound.py:1354` — `GatewayRunner._handle_message(event)` (gọi qua `self._message_handler`)
  4. `gateway/run_inbound.py:1243` — `GatewayRunner._hm_dispatch_idle_commands(event, source, _quick_key)`
  5. `gateway/run_inbound.py:1098` — `GatewayRunner._hm_dispatch_canonical_command(event, source, _quick_key, canonical)`
  6. `gateway/slash_commands.py:332` — `GatewaySlashCommandsMixin._handle_whoami_command(event)`
- **Cách xác minh:**
  - Đọc `gateway/platforms/base.py` tại dòng 3913 (`handle_message`) gọi `_start_session_processing`.
  - Đọc `gateway/platforms/base.py` tại dòng 3824 (`_start_session_processing`) tạo `asyncio.create_task` chạy `_process_message_background`.
  - Đọc `gateway/platforms/base.py` tại dòng 4426 (`_process_message_background`) gọi `await self._message_handler(event)`.
  - Đọc `gateway/run_adapters.py` xác nhận `_primary_message_handler` trỏ tới `_handle_message` trong `gateway/run_inbound.py:1354`.
  - Đọc `gateway/run_inbound.py` tại dòng 1393 gọi `_hm_dispatch_idle_commands`.
  - Đọc `gateway/run_inbound.py` tại dòng 1248 gọi `_hm_dispatch_canonical_command`.
  - Đọc `gateway/run_inbound.py` tại dòng 1105 tra `_gateway_idle_command_handlers()` (chứa `"whoami"` trỏ tới `_handle_whoami_command` trong `gateway/slash_commands.py:332`).
- **Cách chấm:**
  - 1.0: Nêu đúng cả 6 hàm/file theo đúng thứ tự thực thi.
  - 0.5: Thiếu tối đa 2 bước (<= 1/3), các bước còn lại đúng thứ tự và không bịa hàm sai.
  - 0.0: Thiếu từ 3 bước trở lên hoặc sai thứ tự/hàm.

---

## Q6

**Câu hỏi:** Nếu thay đổi định nghĩa hoặc hành vi của hàm `is_excluded_skill_path` trong `agent/skill_utils.py`, những file mã nguồn nào bị ảnh hưởng trực tiếp (gọi hàm này) và những file test nào liên quan cần chạy?

- **Loại:** sửa Z thì ảnh hưởng đâu / test nào liên quan
- **Đáp án:**
  - **Tập các file mã nguồn bị ảnh hưởng trực tiếp (12 files):**
    1. `agent/curator_backup.py`
    2. `gateway/run.py`
    3. `hermes_cli/dump.py`
    4. `hermes_cli/profile_describer.py`
    5. `tools/credential_files.py`
    6. `tools/skill_lock.py`
    7. `tools/skill_manager_tool.py`
    8. `tools/skill_usage.py`
    9. `tools/skills_hub_install.py`
    10. `tools/skills_hub_official.py`
    11. `tools/skills_sync.py`
    12. `tools/skills_sync_optional.py`
  - **Tập các file test liên quan trực tiếp cần chạy (2 files):**
    1. `tests/agent/test_skill_utils.py`
    2. `tests/hermes_cli/test_profile_distribution_swap.py`
- **Cách xác minh:**
  ```bash
  rg -l "\bis_excluded_skill_path\b" .
  ```
  Phân tách kết quả theo tiền tố `tests/` và xác nhận từng file có vị trí gọi thực tế bằng `rg -n "\bis_excluded_skill_path\b" <file>`.
- **Cách chấm:**
  - 1.0: Nêu đúng đầy đủ 12 file mã nguồn và 2 file test (tổng 14 file), không có file sai.
  - 0.5: Thiếu tối đa 4 file (<= 1/3 của 14) và không có file sai nào.
  - 0.0: Thiếu từ 5 file trở lên hoặc có file sai.

---

## Q7

**Câu hỏi:** Nếu sửa đổi chữ ký hoặc kết quả trả về của hàm `get_language` trong `agent/i18n.py`, những file mã nguồn nào bị ảnh hưởng trực tiếp (gọi hàm này) và những file test nào liên quan cần chạy?

- **Loại:** sửa Z thì ảnh hưởng đâu / test nào liên quan
- **Đáp án:**
  - **Tập các file mã nguồn bị ảnh hưởng trực tiếp (3 files):**
    1. `hermes_cli/observability/shared_metrics_snapshot.py`
    2. `plugins/platforms/discord/adapter.py`
    3. `plugins/platforms/telegram/adapter.py`
  - **Tập các file test liên quan trực tiếp cần chạy (3 files):**
    1. `tests/agent/test_i18n.py`
    2. `tests/agent/test_i18n_layers.py`
    3. `tests/hermes_cli/test_config_display_language.py`
- **Cách xác minh:**
  ```bash
  rg -l "\bget_language\(" .
  ```
  Loại trừ chính file định nghĩa `agent/i18n.py` và file cấu hình baseline `scripts/boundary_lint_baseline.json`.
- **Cách chấm:**
  - 1.0: Nêu đúng đầy đủ 3 file mã nguồn và 3 file test (tổng 6 file), không có file sai.
  - 0.5: Thiếu tối đa 2 file (<= 1/3 của 6) và không có file sai nào.
  - 0.0: Thiếu từ 3 file trở lên hoặc có file sai.

---

## Q8

**Câu hỏi:** Hàm `coerce_tool_args` được định nghĩa ở những đâu trong dự án và có mấy bản trùng tên?

- **Loại:** X định nghĩa ở đâu, có mấy bản trùng tên
- **Đáp án:** Có đúng 2 bản định nghĩa hàm trùng tên `coerce_tool_args`:
  1. `acp_adapter/tools.py:120` (`def coerce_tool_args(raw: Any) -> Args:`)
  2. `tools/arg_coercion.py:21` (`def coerce_tool_args(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:`)
- **Cách xác minh:**
  ```bash
  rg -n "^(async )?def coerce_tool_args\b" .
  ```
- **Cách chấm:**
  - 1.0: Nêu chính xác số lượng là 2 và cung cấp đúng cả 2 vị trí `file:line`.
  - 0.5: Xác định được 2 vị trí nhưng thiếu số dòng chính xác hoặc thiếu 1 vị trí không kèm thông tin sai.
  - 0.0: Nêu sai số lượng và thiếu vị trí hoặc đưa ra vị trí không tồn tại.

---

## Q9

**Câu hỏi:** Class `CatalogEntry` được định nghĩa ở những đâu trong dự án và có mấy bản trùng tên?

- **Loại:** X định nghĩa ở đâu, có mấy bản trùng tên
- **Đáp án:** Có đúng 4 bản định nghĩa class trùng tên `CatalogEntry`:
  1. `cron/suggestion_catalog.py:27` (`class CatalogEntry:`)
  2. `hermes_cli/local_runtime/catalog.py:78` (`class CatalogEntry:`)
  3. `hermes_cli/mcp_catalog.py:109` (`class CatalogEntry:`)
  4. `tools/tool_search_catalog.py:27` (`class CatalogEntry:`)
- **Cách xác minh:**
  ```bash
  rg -n "^\s*class CatalogEntry\b" .
  ```
- **Cách chấm:**
  - 1.0: Nêu chính xác số lượng là 4 và cung cấp đúng cả 4 vị trí `file:line`.
  - 0.5: Thiếu tối đa 1 vị trí (<= 1/3) và không có vị trí sai nào.
  - 0.0: Thiếu từ 2 vị trí trở lên hoặc có vị trí sai.

---

## Q10

**Câu hỏi:** Thư mục `tui_gateway` phụ thuộc trực tiếp vào những thư mục top-level cùng cấp nào trong repo thông qua các câu lệnh import?

- **Loại:** kiến trúc phụ thuộc thư mục
- **Đáp án:** Thư mục `tui_gateway` phụ thuộc trực tiếp vào đúng 6 thư mục top-level cùng cấp:
  1. `agent` (237 dòng import)
  2. `gateway` (104 dòng import)
  3. `hermes_cli` (331 dòng import)
  4. `hermes_platform` (2 dòng import: tại `tui_gateway/contracts/machine.py:9` và `tui_gateway/methods_machine.py:17`)
  5. `pm` (1 dòng import: tại `tui_gateway/slash_worker_client.py:38`)
  6. `tools` (207 dòng import)
- **Cách xác minh:**
  - Liệt kê toàn bộ các thư mục con cấp 1 (sibling top-level directories) trong repository: `acp_adapter`, `agent`, `apps`, `contributors`, `cron`, `docker`, `evals`, `gateway`, `hermes_cli`, `hermes_platform`, `locales`, `nix`, `optional-mcps`, `optional-skills`, `plugin-catalog`, `plugins`, `pm`, `providers`, `scripts`, `skills`, `tests`, `tools`, `ui-tui`, `web`, `website`, v.v.
  - Quét tất cả câu lệnh import trong `tui_gateway/` bằng lệnh:
    ```bash
    rg -n "^\s*(from|import)\s+([a-zA-Z0-9_]+)" tui_gateway/
    ```
  - Lọc ra các package trùng tên với các thư mục cấp 1 trên (ngoại trừ chính `tui_gateway`).
  - Kiểm tra các trường hợp ngoại lệ: chuỗi `from docker -e` nằm trong docstring tại `tui_gateway/launch_profile_policy.py:159` không phải là câu lệnh import, nên `docker` không nằm trong danh sách phụ thuộc.
- **Cách chấm:**
  - 1.0: Nêu đúng và đủ 6 thư mục (`agent`, `gateway`, `hermes_cli`, `hermes_platform`, `pm`, `tools`), không thừa không thiếu.
  - 0.5: Thiếu tối đa 2 thư mục (<= 1/3) và không chứa thư mục sai nào.
  - 0.0: Thiếu từ 3 thư mục trở lên hoặc chứa thư mục không có quan hệ phụ thuộc.

---

## Giới hạn

Một số yếu tố đặc thù trong kiến trúc mã nguồn Python của dự án có thể làm cho câu trả lời bị nhập nhằng hoặc dễ dẫn đến sai lệch khi phân tích tự động:

1. **Lazy imports bên trong hàm:** Rất nhiều module trong `hermes-agent` (như `tui_gateway`, `gateway/run_inbound.py`, `hermes_cli/main.py`) thực hiện import cục bộ bên trong hàm thay vì ở cấp module nhằm tối ưu thời gian khởi động hoặc tránh vòng lặp phụ thuộc (circular imports). Phân tích chỉ nhìn ở đầu file sẽ bỏ sót hầu hết các phụ thuộc này.
2. **Khai báo chuyển tiếp động (Dynamic Forwarding / Mixins):** Nhiều lệnh CLI được tạo qua helper `_forward_command(name, module, func_name)` trong `hermes_cli/main.py`, hoặc các handler được tra cứu qua `getattr(self, ...)` trong `_command_handler_table`. Phân tích AST đơn giản không theo dõi giá trị chuỗi sẽ không thấy liên kết trực tiếp giữa entrypoint và hàm xử lý.
3. **Các biểu tượng trùng tên (Homonyms):** Việc cùng một tên hàm (như `coerce_tool_args`) hay cùng một tên lớp (như `CatalogEntry`) xuất hiện ở nhiều gói con độc lập là tương đối phổ biến. Nếu agent chỉ grep tên mà không kiểm tra namespace import sẽ dễ nhầm lẫn giữa các biểu tượng khác nhau.
4. **Dương tính giả từ comment và docstring:** Tìm kiếm theo regex thô có thể bắt gặp các chuỗi cú pháp giống câu lệnh import trong docstring (ví dụ `from docker ...`), đòi hỏi phải đối chiếu dòng code thực tế hoặc phân tích ngữ pháp.
5. **Kỹ thuật Mock / Monkeypatch trong kiểm thử:** Một số bài kiểm thử sử dụng `monkeypatch.setattr(...)` hoặc `@patch(...)` bằng chuỗi ký tự thay vì gọi hàm trực tiếp. Các trường hợp được ghi nhận trong benchmark ở trên đã được lọc kỹ để ưu tiên các vị trí thực sự gọi hàm.
