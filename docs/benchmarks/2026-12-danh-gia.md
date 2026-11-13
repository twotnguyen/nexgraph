# Đánh giá NexGraph (H6)

Tư liệu nội bộ của nhóm: được phép nêu tên các công cụ và dự án tham khảo. Bảng dùng cho báo cáo nộp khoa nằm trong `docs/project/bao-cao-va-tai-lieu.md` mục "Số liệu cho chương 3" (đã thay tên). Mọi số trong tệp này truy được tới tệp thô trong `docs/benchmarks/data/`.

**Quy tắc ghi số:** mỗi phép đo ghi commit NexGraph, commit dự án, máy, ngày, số lần lặp; trung vị và khoảng min–max khi lặp ≥ 3. Kết quả không đạt mục tiêu vẫn ghi nguyên. Không số nào là ước lượng.

**Phạm vi đã chạy (đọc trước):**

| Mục | Trạng thái |
|---|---|
| Độ đúng (§2), so với công cụ gốc (§3), hiệu năng engine (§4) | **Đã chạy** bằng script, số liệu thật, trên macOS |
| Kịch bản demo và năm kịch bản lỗi | **Đã chạy ở mức engine** (HTTP thật, script `demo_check.py`) và bằng test tự động; **chưa bấm thử trên cửa sổ Electron**, chưa chụp ảnh |
| AI agent có/không MCP (§5) | Bộ 10 câu và đáp án **đã sẵn**; **chưa chạy** (cần người dùng chọn agent, model, cấp quyền) |
| Khảo sát người dùng (§6) | Phiếu và đáp án **đã sẵn**; **chưa khảo sát** (cần 5–10 bạn) |
| Windows | Danh sách kiểm **đã sẵn**; **chưa chạy**; CI trên `main` mới nhất chưa xác nhận xanh (chưa push) |
| Đo end-to-end trên app thật bằng đồng hồ | **Chưa làm** (cần cửa sổ Electron) |

## 1. Bộ dự án và máy đo

<!--PINS-->

Máy đo: Apple M3 Pro, 12 lõi, 18 GB RAM, macOS 15.7.3, Python 3.12 (venv của engine), Node v26.7.0. Commit NexGraph lúc đo: xem trường `nexgraph_commit` trong từng `data/perf-*.json` (các số hiệu năng) và `git log` của nhánh `feat/h6-danh-gia` (các số độ đúng). Đo trên bản sao ở thư mục tạm; thư mục gốc không bị ghi và không có `.nexgraph/` nào được tạo.

Ghi chú: `bookstore_app` nằm trong kho NexGraph nên commit ghim là commit NexGraph lúc đo. `Bot_Albion_TNC` có thư mục ẩn `.agents`, `.claude` chứa script của công cụ agent (không phải mã dự án); lấy mẫu độ đúng bỏ qua thư mục ẩn nhưng đo hiệu năng vẫn lập chỉ mục hết (258 tệp).

## 2. Độ đúng của đồ thị (spec §7.1)

### 2.1 Quy trình và độ tin cậy của nhãn

- Mẫu: 12 tệp mã không phải test, không ở thư mục ẩn, có ≥ 3 symbol, chọn bằng `scripts/eval_sample.py --files 12 --seed 7` từ đồ thị đã lập chỉ mục (chỉ lấy đường dẫn tệp). Danh sách: `data/labels-*.csv` cột `file`.
- Nhãn nháp do **một agent AI đọc mã nguồn, không mở CSDL đồ thị, không chạy NexGraph** (nestjs: 195 dòng, albion: 245 dòng). **Người dùng chưa duyệt lại**: kế hoạch yêu cầu duyệt ≥ 3 tệp mỗi dự án và ghi tỉ lệ sửa; mục này còn **chờ người dùng**.
- **Nhãn đã bị sửa sau khi xem kết quả của NexGraph**, trái với quy trình "gán nhãn trước, so sau" của kế hoạch. Các sửa (ghi trong `data/labels-*-notes.md`): thêm `constructor`, getter, `type` alias, hàm lồng nhau mà bản nháp bỏ theo quy ước sai; đổi nguồn của 7 lời gọi nằm trong hàm lồng sang đúng hàm lồng; thêm một nhãn `implements` bị bỏ sót. Mọi sửa đều kiểm lại với mã nguồn, nhưng thiên lệch xác nhận là có thể. Vì thế bảng 2.2 cho cả số **trước sửa nhãn** (lần chấm đầu) và **sau sửa nhãn**.
- Cạnh khớp theo `(nguồn, đích, dòng)`. Lời gọi tới thư viện ngoài không gán nhãn và không tính. `test` tính ở hai mức: symbol → tệp test (`test`) và tệp nguồn → tệp test (`test_file`).

### 2.2 Precision/recall theo loại (khớp theo dòng)

Số liệu: `data/accuracy/score-nestjs.json`, `score-albion.json` (sau sửa nhãn và sửa engine). Mỗi ô: `tp / fp / fn → precision, recall`.

| Loại | NestJS (TS, 12 tệp) | Albion (Py + TS, 12 tệp) |
|---|---|---|
| symbol | 80 / 0 / 0 → 1,000 ; 1,000 | 117 / 0 / 0 → 1,000 ; 1,000 |
| call | 44 / 0 / 1 → 1,000 ; 0,978 | 102 / 0 / 11 → 1,000 ; 0,903 |
| import | 69 / 0 / 0 → 1,000 ; 1,000 | 18 / 0 / 2 → 1,000 ; 0,900 |
| inherit (extends/implements) | 3 / 0 / 0 → 1,000 ; 1,000 | không có nhãn (mọi lớp cha là thư viện ngoài) |
| test (symbol → tệp test) | 4 / 2 / 11 → 0,667 ; 0,267 | 0 / 0 / 10 → n/a ; 0,000 |
| test (tệp nguồn → tệp test) | 4 / 2 / 0 → 0,667 ; 1,000 | 0 / 0 / 3 → n/a ; 0,000 |

**Lần chấm đầu (nhãn nháp chưa sửa, engine trước H6):** NestJS: symbol 64/16/0 (P 0,800), call 44/0/1, import 69/0/0, inherit 0/0/2, test 4/2/11. Albion: symbol 105/12/0 (P 0,897), call 99/6/11 (P 0,943; R 0,900), import 18/0/2, test 0/0/10. Phần lớn sai khác giữa hai lần chấm là **quy ước nhãn** (constructor, getter, hàm lồng), không phải lỗi engine: số liệu đầu đánh giá thấp NexGraph ở precision symbol và call.

### 2.3 Nguyên nhân sai (mọi `fn`/`fp` của loại `call` và các loại còn lại)

Chi tiết từng dòng: `data/accuracy/details-*.json`.

| Nguyên nhân | Số | Loại | Bản chất |
|---|---|---|---|
| Cùng cặp (nơi gọi → đích) xuất hiện ≥ 2 lần trong một tệp: chỉ giữ lần đầu | 6 call (albion) | giới hạn thừa hưởng | bộ trích xuất gốc chỉ giữ một cạnh cho mỗi cặp nút khi nó tự nối lời gọi cùng tệp (xác nhận trên `translate_albion_v1.py`: dòng 218/225/228 có, 234/245/249 không). Khớp theo cặp (bỏ dòng) làm 6 `fn` này biến mất (§2.4) |
| Kiểu của `self.x` không suy ra được (`self.blacklist_db = GlobalBlacklist()` rồi `self.blacklist_db.add_entry()`) | 3 call (albion) | khả năng chưa có | resolver chưa suy kiểu thuộc tính gán trong `__init__` |
| Import theo gốc `sys.path` khác gốc dự án (`from core.storage import …`, `from cogs import alo_tts`), import có bí danh (`import start as start_heartbeat`) | 2 call + 2 import + 3 test_file (albion) | khả năng chưa có | `core.storage` ở `bot/core/storage.py`, không ở gốc dự án; test dùng `module.Class(...)` |
| Biến cục bộ nhận kiểu từ kiểu trả về (`paging = this.paginationUtilService.paging(...)` rồi `paging.format()`) | 1 call (nestjs) | khả năng chưa có | không có suy kiểu trả về |
| `TESTED_BY` mức lớp, nhãn mức phương thức | 11 test (nestjs) | khác biệt thiết kế | NexGraph nối lớp → tệp test; ở mức tệp (`test_file`) recall = 1,000 |
| Tệp test chỉ dùng lớp làm phụ thuộc giả (`ProductsService` trong spec của module khác) | 2 test/test_file (nestjs) | heuristic quá rộng | spec nhắc tên lớp nên có cạnh `TESTED_BY` dù không kiểm thử lớp đó |

### 2.4 Lỗi thật tìm được và đã sửa (kế hoạch Task 2 bước 7)

Không có lỗi nào trong số này lộ ra từ mẫu 12 tệp mỗi dự án; chúng lộ ra khi đối chiếu với công cụ gốc và khi đọc đồ thị lập chỉ mục của dự án. Mỗi lỗi có test đỏ trước khi sửa (`tests/test_generic_precision.py`) và commit riêng.

1. **Kế thừa Python giữa hai tệp bị mất toàn bộ**: bộ trích xuất gốc phát nút giữ chỗ cho lớp cha ở tệp khác, id viết thường (`b`), và code nối lấy id thay vì nhãn (`B`) nên không bao giờ khớp. Sửa ở `index/generic.py` (dùng nhãn của nút giữ chỗ, bỏ tiền tố module).
2. **Kế thừa TypeScript giữa hai tệp bị mất toàn bộ**: bộ trích xuất gốc chỉ phát cạnh `inherits` khi lớp cha nằm trong cùng tập tệp được trích xuất, mà NexGraph trích xuất từng tệp. Thêm bước đọc tiêu đề lớp (`extends`, `implements`, bỏ tham số generic) ở `index/generic.py`; giới hạn: lớp cha là biểu thức (`extends mixin(A, B)`) bị bỏ qua. Tác động trên mẫu: `inherit` recall 0/3 → 3/3.
3. **Lời gọi trên receiver lạ bị nối nhầm vào phương thức trùng tên của chính lớp**: `bcrypt.compare()` trong phương thức `compare` bị nối thành đệ quy `compare → compare` (do bộ trích xuất gốc khớp theo tên). Nay lời gọi `x.tên()` với `x` khác `this/self/cls/super` bị bỏ nối theo tên và đẩy sang resolver theo kiểu. Tác động trên mẫu: không đổi (lỗi nằm ngoài mẫu); xác nhận bằng test.

Sau sửa, toàn bộ bộ test engine xanh. Độ đúng trên mẫu 12 tệp không đổi vì các lỗi nằm ngoài mẫu; con số này **không** nói NexGraph hết lỗi.

## 3. So với công cụ trích xuất gốc (spec §7.1)

Công cụ gốc: bản vendor v0.9.92, `python -m graphify update <bản sao> --no-cluster` chạy trên bản sao của cả dự án (không phải từng tệp). Khớp cạnh theo cặp nút (`(tệp, nhãn)` cho nút, **không có dòng**: bản gốc không có dòng cho mọi cạnh và chỉ giữ một cạnh mỗi cặp). Để cùng điều kiện, NexGraph cũng được chấm theo cặp (`--ignore-line`). Bản gốc không có loại `test`; đích ngoài dự án bị loại cho cả hai.

| Loại | NestJS: NexGraph | NestJS: gốc | Albion: NexGraph | Albion: gốc |
|---|---|---|---|---|
| symbol | 80/0/0 | 80/0/0 | 117/0/0 | 117/0/0 |
| call (theo cặp) | 43/0/1 → R 0,977 | 43/0/1 → R 0,977 | 101/0/5 → R 0,953 | 105/0/1 → R 0,991 |
| import | 66/0/0 → P 1,000 | 66/11/0 → P 0,857 | 18/0/2 → R 0,900 | 20/3/0 → P 0,870 |
| inherit | 3/0/0 | 3/0/0 | — | — |
| test (tệp nguồn → test) | 4/2/0 → P 0,667 | không có loại cạnh này | 0/0/3 | không có loại cạnh này |

Đọc kết quả: **NexGraph không vượt công cụ gốc ở recall lời gọi trên Python** (0,953 so với 0,991): bản gốc khớp theo tên nên bắt được `self.blacklist_db.add_entry()` và import bí danh mà resolver theo kiểu của NexGraph bỏ qua; đổi lại NexGraph bỏ lỗi cạnh nhầm. Ưu thế của NexGraph nằm ở: import chính xác hơn (bản gốc nối tới `package.json` cho mọi tệp JS/TS: 11 + 3 cạnh), có `TESTED_BY`, và nhiều cạnh cho một cặp nút (bản gốc: một cạnh/cặp). Mẫu nhỏ (24 tệp, 2 dự án), một người gán nhãn; không kiểm định thống kê.

<!--PERF-->

## 5. AI agent có và không có MCP của NexGraph (kết quả B, spec §7 mục 5)

**Trạng thái: chưa chạy, chờ người dùng.** Kế hoạch cấm agent tự chạy bước này vì tốn token của người dùng và cần người dùng chọn agent, model và cấp quyền.

Đã sẵn sàng:
- `data/agent-questions.md`: 10 câu hỏi về `hermes-agent` (commit `cc8cc35e6074173d6a4afaeaa351d6cba250c0cc`) đúng phân bổ của kế hoạch (3 "ai gọi X", 2 luồng xử lý, 2 vùng ảnh hưởng và test, 2 định nghĩa trùng tên, 1 phụ thuộc thư mục), mỗi câu có đáp án là tập `tệp:dòng` hoặc tên symbol, lệnh xác minh và thang chấm 1 / 0,5 / 0. Đáp án do một agent AI lập bằng `grep`/đọc mã, không dùng NexGraph; tôi đã chạy lại 3 lệnh xác minh (Q1, Q8, Q9) và kết quả khớp. Chưa có ai khác kiểm lại 7 câu còn lại.
- `data/agent-runs.csv`: bảng trống, cột `question,condition,tool_calls,tokens_in,tokens_out,seconds,score,notes`.
- Cài MCP cho điều kiện (b): nút "Tích hợp trợ lý AI" ở Tổng quan (H5) hoặc sao chép cấu hình.

Giao thức khi chạy: một agent, một model, cùng lời nhắc hệ thống; điều kiện (a) chỉ có công cụ đọc tệp/grep sẵn có, (b) thêm MCP của NexGraph; mỗi câu một phiên mới, mỗi điều kiện một lần (n = 1 mỗi ô; nên 3 lần nếu có thời gian). Dự án `hermes-agent` cần được lập chỉ mục trong NexGraph trước (120,9 s trên máy đo). Cần người dùng cho biết: agent nào (Claude Code, OpenCode…), model nào, và đồng ý chi phí token.

Giới hạn dự kiến khi có số: 10 câu, một dự án, một model, n nhỏ; không suy rộng.

## 6. Khảo sát người dùng (kết quả A và C, spec §7.3)

**Trạng thái: chưa khảo sát, chờ người dùng.** Cần 5–10 bạn cùng lớp, khoảng 30 phút mỗi người, một máy có NexGraph với bản sao NestJS đã lập chỉ mục và một máy chỉ có trình soạn thảo.

Đã sẵn sàng: `data/khao-sat-phieu.md` (năm câu hỏi có đáp án đúng/sai, bốn câu thang 1–5, đáp án, hướng dẫn người điều phối), `data/khao-sat-ket-qua.csv` (bảng trống: `nguoi,nhom,cau,dung,giay,de_dung,ban_do,luong,dung_lai`). Đáp án được lập từ mã nguồn (grep và đọc); câu 1 và 4 có phần chủ quan nên chấm theo mức "đúng đủ / một phần". Khi có dữ liệu: bảng tỉ lệ đúng và thời gian trung vị theo nhóm cho từng câu, trung bình thang đo, ghi rõ n và đây là khảo sát nhỏ không kiểm định thống kê.




<!--SCENARIOS-->

## 8. Hạn chế đã biết

- **Chỉ adapter API key**; không đăng nhập theo gói thuê bao; **không streaming**; **lịch sử chat không lưu**; giao diện **chỉ tiếng Việt**.
- **Chưa kiểm trên Electron thật** (cửa sổ, WebGL trong `file://`, bấm chuột): mọi kiểm giao diện là test jsdom và engine thật qua HTTP. Chưa chụp ảnh `docs/screenshots/h6/`.
- **Chưa chạy trên Windows**; CI của `main` mới nhất chưa xác nhận xanh (chưa push; lần chạy gần nhất `43363591920` có 3 test đỏ trên `windows-latest`, đã sửa cục bộ ở H0 nhưng chưa có bằng chứng CI).
- **Chưa chạy với nhà cung cấp AI thật**: chat mới được kiểm với máy chủ giả (`fake-llm.mjs`) và test đơn vị.
- **Độ đúng** chấm trên 24 tệp của 2 dự án bằng nhãn nháp của một agent, đã sửa sau khi xem kết quả (§2.1). Python: `self.x.method()` với `x` gán trong `__init__`, `import` theo gốc `sys.path` khác gốc dự án và bí danh import chưa được nối; cùng cặp gọi nhiều lần trong một tệp chỉ giữ lần đầu (thừa hưởng). TypeScript: lớp cha là biểu thức bị bỏ; `TESTED_BY` mức lớp.
- **Hook git** không hỗ trợ `core.hooksPath` (husky…) và worktree.
- **Cấu hình tích hợp agent** (Claude Code, Cursor, VS Code, OpenCode) lấy theo mã của công cụ tham khảo, chưa đối chiếu tài liệu chính thức và chưa thử với chính các công cụ đó.
- **Task bị cắt hoặc chưa làm trọn:** Task 3 bước 4 (đồng hồ bấm tay trên app), Task 4 (chạy agent), Task 5 (khảo sát), Task 6 bước 1 (ảnh trên app thật), bước 3 (3 lần liên tiếp trên app) và bước 4 (video), Task 7 bước 3–4 (Windows, gắn thẻ). Xem từng mục.

## 9. Việc chưa kiểm (cần người dùng)

| Việc | Cần gì |
|---|---|
| Duyệt nhãn tay ≥ 3 tệp mỗi dự án, ghi tỉ lệ sửa | người dùng, ~1 giờ |
| Chạy 10 câu hỏi với agent có/không MCP | chọn agent, model, cấp quyền/token |
| Khảo sát 5–10 bạn | 30 phút mỗi người |
| Bấm thử `docs/demo-script.md` 3 lần trên app Electron, chụp ảnh | người dùng, cửa sổ thật |
| Chạy `docs/windows-checklist.md` | P3, máy Windows |
| Thử một nhà cung cấp AI thật | API key |
| Push nhánh và xác nhận CI xanh cả 6 job | người dùng đồng ý push |
| Gắn thẻ `v0.2.0-alpha` cục bộ | người dùng đồng ý (không push thẻ) |

