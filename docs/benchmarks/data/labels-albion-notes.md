# Ghi chú gán nhãn Ground-Truth cho dự án Albion (Labels Albion Notes)

## 1. Tổng quan

- **Mục tiêu**: Bộ dữ liệu nhãn ground-truth cho 12 tệp mẫu được chọn ngẫu nhiên từ repo `albion` (commit `b82be71177dc6ab0b96b566ea4ded8c029ed6712`).
- **Tập tin nhãn CSV**: `labels-albion.csv` (245 dòng nhãn).
- **Quy tắc gán nhãn**:
  - Không mở bất kỳ tệp database (`*.db`) hoặc chạy công cụ phân tích đồ thị tự động.
  - Phân tích trực tiếp từ mã nguồn theo format quy định của `eval_score.py`.
  - Cột CSV: `file,kind,source,target,line`.
  - `kind`: `symbol`, `import`, `call`, `inherit`, `test`.

### Tổng hợp số lượng theo loại quan hệ (kind)

| Kind | Số lượng | Ghi chú |
| :--- | :---: | :--- |
| `symbol` | 105 | Khai báo hàm, phương thức (`Class.method`), lớp |
| `import` | 20 | Import giữa các tệp nội bộ dự án |
| `call` | 110 | Lời gọi giữa các hàm/phương thức tới symbol nội bộ dự án |
| `inherit` | 0 | Không có (tất cả các lớp đều kế thừa thư viện ngoài hoặc built-in) |
| `test` | 10 | Các tệp kiểm thử gọi hoặc khởi tạo symbol trong tệp mẫu |
| **Tổng cộng** | **245** | |

---

## 2. Bảng thống kê chi tiết theo từng tệp

| STT | Đường dẫn tệp | Symbol | Import | Call | Inherit | Test | Tổng |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | `_backup_chatbot/translate_albion_v1.py` | 8 | 2 | 16 | 0 | 0 | **26** |
| 2 | `bot/cogs/about.py` | 4 | 0 | 1 | 0 | 0 | **5** |
| 3 | `bot/cogs/alo_tts.py` | 20 | 3 | 16 | 0 | 7 | **46** |
| 4 | `bot/cogs/blacklist.py` | 12 | 2 | 14 | 0 | 0 | **28** |
| 5 | `bot/cogs/sync.py` | 14 | 2 | 14 | 0 | 0 | **30** |
| 6 | `bot/cogs/update_translator.py` | 24 | 3 | 39 | 0 | 3 | **69** |
| 7 | `bot/core/webserver.py` | 4 | 1 | 0 | 0 | 0 | **5** |
| 8 | `bot/main.py` | 8 | 4 | 3 | 0 | 0 | **15** |
| 9 | `scripts/apply_schema.py` | 5 | 0 | 4 | 0 | 0 | **9** |
| 10 | `web_dashboard/src/app/api/blacklist/route.ts` | 4 | 3 | 3 | 0 | 0 | **10** |
| 11 | `web_dashboard/src/components/MultiSearchableSelect.tsx` | 1 | 0 | 0 | 0 | 0 | **1** |
| 12 | `web_dashboard/src/components/SearchableSelect.tsx` | 1 | 0 | 0 | 0 | 0 | **1** |
| | **Tổng** | **105** | **20** | **110** | **0** | **10** | **245** |

---

## 3. Danh sách các phần tử bỏ qua hoặc không chắc chắn (Skipped & Uncertain)

Theo đúng hướng dẫn đánh giá và nguyên tắc ground-truth:

### 3.1. Bỏ qua quan hệ kế thừa (`inherit = 0`)
- `bot/cogs/about.py`: `AboutCog(commands.Cog)` kế thừa từ thư viện bên ngoài `discord.ext.commands.Cog`.
- `bot/cogs/alo_tts.py`: `AloTtsCog(commands.Cog)` kế thừa từ thư viện ngoài.
- `bot/cogs/blacklist.py`: `BlacklistCog(commands.Cog)` kế thừa từ thư viện ngoài; `GlobalBlacklist` không kế thừa lớp nào.
- `bot/cogs/sync.py`: `Sync(commands.Cog)` kế thừa từ thư viện ngoài.
- `bot/cogs/update_translator.py`: `UpdateTranslatorCog(commands.Cog)` kế thừa từ thư viện ngoài.
- `bot/main.py`: `TNCBot(commands.Bot)` kế thừa từ `commands.Bot` của thư viện ngoài.
- `scripts/apply_schema.py`: `MissingDatabaseDriverError(RuntimeError)` kế thừa từ built-in `RuntimeError` của Python.
- Các tệp TypeScript còn lại là hàm hoặc component, không có định nghĩa lớp kế thừa.

### 3.2. Bỏ qua các hàm lồng / Closure nội bộ (Nested Functions)
Các hàm định nghĩa bên trong thân hàm khác không xuất hiện ở cấp độ module/class symbol công khai, nên không gán symbol riêng:
- `_backup_chatbot/translate_albion_v1.py`: `_nlines` trong `_is_broken`, `_call` trong `_run_batch`, `_checkpoint` trong `main`. Các lời gọi tới symbol nội bộ bên trong các closure này được tính là xuất phát từ hàm bao ngoài.
- `bot/cogs/alo_tts.py`: `repl_mention`, `repl_channel` trong `clean_text_for_tts`; `after_play` trong `_tts_worker`.
- `web_dashboard/src/components/MultiSearchableSelect.tsx`: `handleClickOutside`, `getColorHex`, `handleToggleOption`, `handleRemove`.
- `web_dashboard/src/components/SearchableSelect.tsx`: `handleClickOutside`, `getColorHex`.

### 3.3. Bỏ qua TypeScript Interfaces & Types
- `web_dashboard/src/components/MultiSearchableSelect.tsx`: `Option`, `MultiSearchableSelectProps`.
- `web_dashboard/src/components/SearchableSelect.tsx`: `Option`, `SearchableSelectProps`.
- `web_dashboard/src/app/api/blacklist/route.ts`: kiểu `Session` của `next-auth`.

### 3.4. Bỏ qua lời gọi framework, thư viện ngoài và đối tượng động (`self.bot.<x>`)
- Tất cả lời gọi phương thức trên `self.bot.<x>`, `interaction.<x>`, `interaction.response.<x>`, `interaction.followup.<x>`, `guild.<x>`, `channel.<x>`, `vc.<x>` thuộc `discord.py` đều bị bỏ qua vì là API framework/đối tượng động không thể xác định lớp nội bộ với độ chắc chắn tuyệt đối.
- Thư viện HTTP / Cloud / AI: `requests.post`, `aiohttp.ClientSession`, các lời gọi REST API tới Google Gemini endpoint.
- Thư viện cơ sở dữ liệu: Các lời gọi fluent query builder của Supabase client (`client.table(...).select(...)`, `upsert(...)`, `delete(...)`) được truyền trong các biểu thức lambda của `async_execute`.
- Thư viện Web Next.js: `NextResponse.json`, `getServerSession`.
- Thư viện UI React: Các hook `useState`, `useRef`, `useEffect` và sự kiện DOM chuẩn (`document.addEventListener`).

### 3.5. Trường hợp chuyển giao hàm làm tham số (Callback Passing)
- `bot/cogs/alo_tts.py:127`: `await self.bot.loop.run_in_executor(None, generate_tts_file, text)`. Ở đây `generate_tts_file` được truyền như một tham số hàm callback vào `run_in_executor`, không phải là một Call expression trực tiếp trong AST.
- `bot/core/webserver.py:56`: `Thread(target=_run).start()`. `_run` được truyền làm target của thread.
- Các trường hợp này được ghi nhận tại đây nhưng không sinh cạnh `call` để đảm bảo độ chính xác theo AST call matcher.

### 3.6. Kiểm thử gián tiếp qua HTTP Client (`test`)
- `bot/core/webserver.py::webhook_reload`: Trong tệp kiểm thử `bot/tests/test_webhook_heartbeat.py`, hàm này được kích hoạt thông qua Flask test client (`client.post("/api/webhook/reload")`). Do từ khóa symbol `webhook_reload` không xuất hiện trực tiếp dưới dạng định danh mã nguồn trong test file, nó không khớp lệnh `grep` theo tên symbol. Do đó, trường hợp này được ghi nhận trong ghi chú thay vì tạo cạnh `test` trực tiếp.

---

## 4. Nhận xét về độ khó & thời gian thực hiện (Time & Difficulty)

### 4.1. Thời gian ước tính & mức độ phức tạp
- **Tổng thời gian phân tích và gán nhãn**: Khoảng 45 - 60 phút đọc kỹ lưỡng 12 tệp nguồn và các tệp kiểm thử liên quan.
- **Phân loại độ khó**:
  - **Dễ**:
    - `web_dashboard/src/components/SearchableSelect.tsx` & `MultiSearchableSelect.tsx`: UI component độc lập, chỉ dùng React hook cơ bản, không có import hay call nội bộ.
    - `bot/core/webserver.py`: Tệp nhỏ gọn, chỉ 56 dòng, chủ yếu tích hợp Flask.
    - `scripts/apply_schema.py`: Script độc lập, chỉ gọi các hàm tiện ích cục bộ trong cùng tệp.
  - **Trung bình**:
    - `bot/cogs/about.py`, `bot/cogs/sync.py`, `bot/main.py`: Các cogs và tệp khởi động bot; cấu trúc rõ ràng, phụ thuộc tập trung vào `bot/core/db.py`, `bot/core/config.py`.
    - `web_dashboard/src/app/api/blacklist/route.ts`: Cần resolve path alias `@/*` theo `tsconfig.json` trỏ tới `web_dashboard/src/*`.
  - **Phức tạp**:
    - `_backup_chatbot/translate_albion_v1.py`: Chứa nhiều hàm phụ trợ xử lý batch, parse chuỗi regex, lời gọi qua lại giữa các hàm nội bộ và gọi sang `build_albion_item_db.py`, `bot/core/storage.py`.
    - `bot/cogs/alo_tts.py` & `bot/cogs/update_translator.py`: Code bất đồng bộ nhiều tầng, chứa nhiều slash commands, lock quản lý đồng thời, luồng xử lý queue ngầm và có test case chuyên biệt trong `bot/tests/test_config_concurrency.py` và `bot/tests/test_discord_workflows.py`.

### 4.2. Đề xuất 3 tệp cho Reviewer người kiểm tra lại (Human Verification)
Khuyến nghị người đánh giá kiểm tra sâu ít nhất 3 tệp sau đây để xác nhận độ tin cậy cao nhất:
1. **`bot/cogs/alo_tts.py`**: Tệp đại diện hoàn chỉnh nhất cho cog phức tạp có tích hợp DB (`async_execute`), cấu hình đa luồng (`asyncio.Lock`), gọi nội bộ và có độ phủ kiểm thử phong phú trong `bot/tests/`.
2. **`bot/cogs/update_translator.py`**: Tệp có số lượng call nội bộ lớn nhất (39 calls) với logic xử lý thread Discord và gọi async storage.
3. **`_backup_chatbot/translate_albion_v1.py`**: Tệp script dữ liệu đại diện cho logic kết hợp giữa helper script (`build_albion_item_db.py`) và module dùng chung (`core.storage`).

## Duyệt bổ sung (agent, 2026-11-13; người dùng vẫn cần duyệt lại ≥ 3 tệp)
Bản nháp bỏ qua hàm lồng nhau và quy mọi lời gọi trong hàm lồng về hàm ngoài. Đọc lại mã thấy đó là sai ngữ nghĩa (lời gọi ở dòng 218–249 của `translate_albion_v1.py` nằm trong hàm lồng `_call`, khai báo dòng 208). Đã sửa nhãn trước khi chấm lần hai: 6 dòng `call` đổi nguồn từ `_run_batch` sang `_call`; thêm 3 dòng `call` (`_is_broken→_nlines` 187, `_run_batch→_call` 260, `main→_checkpoint` 364) và 15 dòng `symbol` (hàm lồng `_call`, `_checkpoint`, `_nlines`, `after_play`, `repl_channel`, `repl_mention`; TypeScript `Option`, `*Props`, `handleClickOutside`). Số liệu chấm lần một (trước sửa nhãn) lưu trong báo cáo để thấy tác động của quy ước.
