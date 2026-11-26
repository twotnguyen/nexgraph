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

| Vai | Dự án | Commit ghim | Tệp đã lập chỉ mục (theo ngôn ngữ) |
|---|---|---|---|
| Demo + độ đúng | `ecommerce-backend-nestjs` | `d11f4ef7d906ba514cf9e3c2234116ad49789ee7` | 268 (typescript 266, javascript 2) |
| Độ đúng | `Bot_Albion_TNC` | `b82be71177dc6ab0b96b566ea4ded8c029ed6712` | 258 (python 217, typescript 36, javascript 5) |
| Hồi quy Dart | `tests/fixtures/bookstore_app` | (thuộc kho NexGraph; commit NexGraph `5237841541ca4949ca106c7f33827e8b59e3bdb7`) | 9 (dart 9) |
| Hiệu năng tầng L, agent | `hermes-agent` | `cc8cc35e6074173d6a4afaeaa351d6cba250c0cc` | 17.260 (python 11325, typescript 5594, javascript 339, csharp 2) |
| Tầng L (đối chứng) | `repo-reference/open-design` | `b4ec310921f49ae512de1f0a1f3a4e7ce3d05f2f` | 5.672 (typescript 5369, javascript 185, python 118) |

Máy đo: Apple M3 Pro, 12 lõi, 18 GB RAM, macOS 15.7.3, Python 3.12 (venv của engine), Node v26.7.0. Commit NexGraph lúc đo: xem trường `nexgraph_commit` trong từng `data/perf-*.json` (các số hiệu năng) và `git log` của nhánh `feat/h6-danh-gia` (các số độ đúng). Đo trên bản sao ở thư mục tạm; thư mục gốc không bị ghi và không có `.nexgraph/` nào được tạo.

Ghi chú: `bookstore_app` nằm trong kho NexGraph nên commit ghim là commit NexGraph lúc đo. `Bot_Albion_TNC` có thư mục ẩn `.agents`, `.claude` chứa script của công cụ agent (không phải mã dự án); lấy mẫu độ đúng bỏ qua thư mục ẩn nhưng đo hiệu năng vẫn lập chỉ mục hết (258 tệp).

## 2. Độ đúng của đồ thị (spec §7.1)

### 2.1 Quy trình và độ tin cậy của nhãn

- Mẫu: 12 tệp mã không phải test, không ở thư mục ẩn, có ≥ 3 symbol, chọn bằng `tools/eval/eval_sample.py --files 12 --seed 7` từ đồ thị đã lập chỉ mục (chỉ lấy đường dẫn tệp). Danh sách: `data/labels-*.csv` cột `file`.
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
| Cùng cặp (nơi gọi → đích) xuất hiện ≥ 2 lần trong một tệp: chỉ giữ lần đầu | 6 call (albion) | giới hạn thừa hưởng | bộ trích xuất gốc chỉ giữ một cạnh cho mỗi cặp nút khi nó tự nối lời gọi cùng tệp (xác nhận trên `translate_albion_v1.py`: dòng 218/225/228 có, 234/245/249 không). Khớp theo cặp (bỏ dòng) làm 6 `fn` này biến mất (§3) |
| Kiểu của `self.x` không suy ra được (`self.blacklist_db = GlobalBlacklist()` rồi `self.blacklist_db.add_entry()`) | 3 call (albion) | khả năng chưa có | resolver chưa suy kiểu thuộc tính gán trong `__init__` |
| Import theo gốc `sys.path` khác gốc dự án (`from core.storage import …`, `from cogs import alo_tts`), import có bí danh (`import start as start_heartbeat`) | 2 call + 2 import + 3 test_file (albion) | khả năng chưa có | `core.storage` ở `bot/core/storage.py`, không ở gốc dự án; test dùng `module.Class(...)` |
| Biến cục bộ nhận kiểu từ kiểu trả về (`paging = this.paginationUtilService.paging(...)` rồi `paging.format()`) | 1 call (nestjs) | khả năng chưa có | không có suy kiểu trả về |
| `TESTED_BY` mức lớp, nhãn mức phương thức | 11 test (nestjs) | khác biệt thiết kế | NexGraph nối lớp → tệp test; ở mức tệp (`test_file`) recall = 1,000 |
| Tệp test chỉ dùng lớp làm phụ thuộc giả (`ProductsService` trong spec của module khác) | 2 test/test_file (nestjs) | heuristic quá rộng | spec nhắc tên lớp nên có cạnh `TESTED_BY` dù không kiểm thử lớp đó |

### 2.4 Lỗi thật tìm được và đã sửa (kế hoạch Task 2 bước 7)

Lỗi 2 lộ ra từ mẫu (`inherit` recall 0/3 trên NestJS); lỗi 1 và 3 lộ ra ngoài mẫu, khi đối chiếu với công cụ gốc và khi đọc đồ thị đã lập chỉ mục. Mỗi lỗi có test đỏ trước khi sửa (`tests/test_generic_precision.py`) và commit riêng. Các lỗi khác tìm thấy ở H6 nhưng không thuộc độ đúng đồ thị: `TESTED_BY` 82 s mỗi refresh và id trùng làm chết lập chỉ mục (§4.4), Go/Java ra 0 tệp (§7.2), `stale` báo cũ mãi với tệp chưa commit (đã sửa, có test `test_uncommitted_edit_that_the_graph_already_has_is_not_stale`).

1. **Kế thừa Python giữa hai tệp bị mất toàn bộ**: bộ trích xuất gốc phát nút giữ chỗ cho lớp cha ở tệp khác, id viết thường (`b`), và code nối lấy id thay vì nhãn (`B`) nên không bao giờ khớp. Sửa ở `index/generic.py` (dùng nhãn của nút giữ chỗ, bỏ tiền tố module).
2. **Kế thừa TypeScript giữa hai tệp bị mất toàn bộ**: bộ trích xuất gốc chỉ phát cạnh `inherits` khi lớp cha nằm trong cùng tập tệp được trích xuất, mà NexGraph trích xuất từng tệp. Thêm bước đọc tiêu đề lớp (`extends`, `implements`, bỏ tham số generic) ở `index/generic.py`; giới hạn: lớp cha là biểu thức (`extends mixin(A, B)`) bị bỏ qua. Tác động trên mẫu: `inherit` recall 0/3 → 3/3.
3. **Lời gọi trên receiver lạ bị nối nhầm vào phương thức trùng tên của chính lớp**: `bcrypt.compare()` trong phương thức `compare` bị nối thành đệ quy `compare → compare` (do bộ trích xuất gốc khớp theo tên). Nay lời gọi `x.tên()` với `x` khác `this/self/cls/super` bị bỏ nối theo tên và đẩy sang resolver theo kiểu. Tác động trên mẫu: không đổi (lỗi nằm ngoài mẫu); xác nhận bằng test.

Sau sửa, toàn bộ bộ test engine xanh. Số ở §2.2 đã gồm tác động của lỗi 2; lỗi 1 và 3 không đổi con số nào trên mẫu. Con số này **không** nói NexGraph hết lỗi: mẫu chỉ có 24 tệp.

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

## 4. Hiệu năng (spec §6.1, §7.2)

Script: `tools/bench/bench_all.py <dự án> --repeat 3 [--index-repeat 1] --out data/perf-<dự án>.json`. Dự án được chép sang thư mục tạm (bỏ `.git`, `node_modules`, `build`, `.venv`); lập chỉ mục và đo trong cùng một tiến trình Python, trên máy macOS nêu ở §1. Lập chỉ mục tầng L chạy 1 lần (`--index-repeat 1`), các chỉ số còn lại 3 lần.

**Điều kiện đo cần biết khi đọc số:**
- "Mở lại" là mở CSDL chỉ đọc và gọi `stats()` **trong tiến trình đã nóng** (bộ nhớ đệm của hệ điều hành đã có trang), không phải khởi động lạnh của ứng dụng.
- "Cập nhật sau khi sửa 1 tệp" thêm một dòng trống vào tệp ở giữa danh sách rồi gọi `refresh_project`; đây là sửa **không đổi cấu trúc** nên cận dưới của một lần sửa thật.
- "RAM đỉnh sau lập chỉ mục" là `ru_maxrss` của **tiến trình cha**. Lập chỉ mục tầng L chạy bằng 8 tiến trình con (`ProcessPoolExecutor`) không nằm trong số đó. Số tổng cả cây tiến trình ở §4.3.
- `list_flows(q="auth")` đo thời gian truy vấn, không bảo đảm có kết quả (tìm theo tên luồng).

> **Số hiện hành 23/11/2026:** §4.1–§4.3 dưới đây là bản đo lịch sử trên `5237841`/`72dc4ec`. Con số dùng để tuyên bố NFR nằm ở [số đo lại 23/11](2026-11-23-nfr-va-do-lai.md): tầng L index **85,2 s** sau #53 (500,5 s là **trước** #53), refresh **0,50 s**, RAM cả cây **917 MB**; tầng XL `hermes-agent` index **146,5 s**, refresh **1,54 s**, RAM **1,52 GB**; **không có tầng M**. Đặc biệt, 4.729 ms của `hermes-agent` là số **trước tối ưu** `353c083` — không dùng làm số hiện hành.

### 4.1 Tầng S (≤ 1.000 tệp), trung vị [min–max] của 3 lần lặp

| Chỉ số | Mục tiêu spec §6.1 | `ecommerce-backend-nestjs` | `Bot_Albion_TNC` | `tests/fixtures/bookstore_app` | Đạt |
|---|---|---|---|---|---|
| Lập chỉ mục lần đầu (s) | < 60 s | 0,86 [0,85–1,19] | 1,52 [1,50–1,71] | 0,01 [0,01–0,01] | đạt |
| Mở lại (ms) | < 3 s | 0,90 [0,82–1,03] | 1,25 [1,25–1,41] | 0,44 [0,37–0,57] | đạt |
| Cập nhật sau khi sửa 1 tệp (ms) | — | 34,1 [33,4–35,2] | 72,7 [71,9–87,0] | 3,2 [3,0–3,5] | — |
| Dựng luồng (ms) | — | 8,6 [8,4–9,4] | 23,9 [23,0–24,6] | 0,3 [0,2–0,5] | — |
| Bản đồ, detail 400 (ms) | — | 4,0 [3,9–4,2] | 2,4 [2,4–2,6] | 0,1 [0,1–0,2] | — |
| Chu trình import (ms) | — | 1,2 [1,2–1,6] | 0,4 [0,4–0,7] | 0,0 [0,0–0,2] | — |
| Tham quan (ms) | — | 1,5 [1,5–1,7] | 2,1 [2,1–2,5] | 0,1 [0,1–0,4] | — |
| Ngữ cảnh cho AI (ms) | — | 1,1 [1,1–1,1] | 1,4 [1,3–1,4] | 1,2 [1,2–1,2] | — |
| Tìm kiếm "build" (ms) | — | 0,05 [0,04–0,20] | 0,19 [0,18–0,40] | 0,06 [0,05–0,17] | — |
| Kiến trúc, màn gốc (ms) | — | 2,2 [2,1–2,4] | 1,3 [1,3–1,6] | 0,1 [0,1–0,2] | — |
| Hàng xóm của nút bậc cao nhất (ms) | — | 0,68 [0,65–0,87] | 0,43 [0,42–0,55] | 0,09 [0,08–0,16] | — |
| RAM đỉnh của tiến trình đo (MB) | — | 79 | 88 | 70 | — |
| Kích thước `graph.db` (MB) | — | 1,6 | 2,8 | 0,2 | — |
| Số tệp / nút / cạnh | — | 268 / 1190 / 2905 | 258 / 2067 / 3695 | 9 / 35 / 53 | — |

### 4.2 Tầng L/XL (5.000–17.408 tệp): index 1 lần, các chỉ số còn lại trung vị [min–max] của 3 lần

`hermes-agent` từ 2026-11-20 thuộc **tầng XL**; cột này giữ để so lịch sử, không chấm bằng ngưỡng L (xem [số hiện hành](2026-11-23-nfr-va-do-lai.md)).

| Chỉ số | Mục tiêu spec §6.1 | Mục tiêu nội bộ H1–H3 | `hermes-agent` | `repo-reference/open-design` | Đạt (spec / nội bộ) |
|---|---|---|---|---|---|
| Lập chỉ mục lần đầu (s) | ≤ 10 phút (600 s) | ≤ 5 phút (300 s) | 125,7 | 193,3 | đạt / đạt |
| Mở lại (ms) | < 5 s | — | 149,4 [149,3–150,7] | 45,3 [45,0–45,9] | đạt / — |
| Dựng luồng (s) | — | < 60 s | 2,05 [2,04–2,09] | 0,54 [0,54–0,56] | đạt / đạt |
| Bản đồ, detail 400 (s) | — | < 5 s | 0,43 [0,43–0,44] | 0,15 [0,15–0,16] | đạt / đạt |
| RAM đỉnh sau lập chỉ mục, **chỉ tiến trình cha** (MB) | < 2 GB (2.048) | ≤ 1,5 GB (1.536) | 965 | 436 | chỉ phần cha, xem §4.3: cả cây KHÔNG đạt trên `hermes-agent` |
| Chu trình import (ms) | — | — | 121,5 [111,0–123,1] | 36,8 [35,9–45,9] | — |
| Tham quan (ms) | — | — | 385,0 [383,8–397,4] | 133,8 [133,7–135,7] | — |
| Ngữ cảnh cho AI (ms) | — | — | 5,1 [5,0–5,1] | 4,6 [4,3–4,9] | — |
| Tìm kiếm "build" (ms) | — | — | 4,83 [4,78–6,02] | 1,58 [1,53–2,22] | — |
| Kiến trúc, màn gốc (ms) | — | — | 389,6 [384,9–400,2] | 126,5 [125,5–127,7] | — |
| Hàng xóm của nút bậc cao nhất (ms) | — | — | 129,7 [128,3–143,9] | 96,6 [95,3–109,3] | — |
| Kích thước `graph.db` (MB) | — | — | 295,6 | 101,3 | — |
| Số tệp / nút / cạnh / tham chiếu chưa nối | — | — | 17260 / 215015 / 684003 / 840309 | 5672 / 55343 / 213417 / 417391 | — |

Dòng “cập nhật sau khi sửa 1 tệp” không còn trong bảng chính: số 4.729,3 ms của `hermes-agent` là bản đo lịch sử **trước tối ưu** `353c083` (xem §4.4 và [số hiện hành](2026-11-23-nfr-va-do-lai.md): 1,54 s).

### 4.3 RAM của cả cây tiến trình (tầng L)

Đo bằng cách lấy mẫu tổng RSS của tiến trình cha và mọi tiến trình con mỗi 0,5 s trong lúc lập chỉ mục (`ps`); RSS cộng dồn tính trùng các trang chia sẻ nên hơi cao hơn bộ nhớ thật.

| Dự án | Tiến trình con (`NEXGRAPH_INDEX_WORKERS`) | Thời gian lập chỉ mục | RSS đỉnh cả cây | RSS đỉnh tiến trình cha (`ru_maxrss`) | Đạt < 2 GB / ≤ 1,5 GB |
|---|---|---|---|---|---|
| `hermes-agent` | 8 (mặc định) | 132 s | 4.821 MB | 965 MB | KHÔNG / KHÔNG |
| `hermes-agent` | 4 | 163 s | 3.956 MB | — | KHÔNG / KHÔNG |
| `hermes-agent` | 2 | 298 s | 3.530 MB | — | KHÔNG / KHÔNG |
| `open-design` | 8 (mặc định) | 198 s | 1.482 MB | 436 MB | đạt / đạt (sát ngưỡng 1.536) |

Mỗi tiến trình con lớn nhất đạt 1.008 MB trên `hermes-agent` (232 MB trên `open-design`). **Mục tiêu RAM < 2 GB của tầng L không đạt trên `hermes-agent` ở mọi cấu hình đã thử**; giảm số tiến trình con chỉ giảm RAM từ 4,8 xuống 3,5 GB và kéo thời gian lên gấp 2,3 lần. Số 939 MB H1 báo (và 965 MB ở bảng 4.2) chỉ là tiến trình cha; trong tài liệu H1 cần hiểu đúng như vậy. Nguyên nhân chưa phân tích sâu (không có hồ sơ bộ nhớ của tiến trình con). Thời gian 132 s ở đây là chạy `index_to.py` riêng, khác 141 s trong `bench_all` do chạy trong tiến trình có thêm phần đo. Lưu ý phân tầng: `hermes-agent` là **XL**, không chấm bằng ngưỡng L; đo 23/11 cả cây còn **1,52 GB** — dưới 2 GB (xem [số hiện hành](2026-11-23-nfr-va-do-lai.md)).

**Cập nhật 2026-11-20, đã sửa:** nguyên nhân là `lru_cache(maxsize=2048)` `_parse_python_tree_cached` của bộ trích xuất vendored giữ cây cú pháp Python của tới 2.048 tệp trong mỗi tiến trình con. NexGraph gọi bộ trích xuất theo từng tệp nên cache chỉ có ích trong một lần gọi; `generic.py` nay xoá cache đầu mỗi lần gọi. Đo lại `hermes-agent` (17.260 tệp, 8 tiến trình con, M3 Pro, `scripts/engine/ram_index.py` của workspace): RSS đỉnh cả cây **4.634 → 1.236 MB**, tiến trình con lớn nhất 816 → 173 MB, thời gian 138 → 114 s, số nút và cạnh không đổi (215.015 / 693.526). Tiến trình cha còn khoảng 950 MB. Từ 2026-11-20 `hermes-agent` thuộc tầng XL (> 15.000 tệp, chỉ đo).

### 4.4 Đạt / không đạt và nguyên nhân

- **Tầng S đạt hết**: lập chỉ mục lần đầu ≤ 1.52 s (mục tiêu < 60 s), mở lại ≈ 1 ms (mục tiêu < 3 s).
- **Tầng L: lập chỉ mục và mở lại đạt** (`open-design` 193,3 s so với 600 s; mục tiêu nội bộ 300 s cũng đạt; `hermes-agent` 125,7 s là tầng **XL**, chỉ tham chiếu). Sau #53 đo lại `open-design` còn **85,2 s** (xem [số hiện hành](2026-11-23-nfr-va-do-lai.md)). Dựng luồng và bản đồ đạt mục tiêu nội bộ với biên lớn.
- **Tầng L: cập nhật 1 tệp đạt** — `open-design` **0,50 s** (đo 23/11; bảng cũ 1,23 s). Với `hermes-agent` (tầng **XL**), số 4,73 s là **trước tối ưu** `353c083`; đo 23/11 còn **1,54 s**, đạt nếu áp ngưỡng L. Nguyên nhân cũ đã xác định bằng cProfile: dựng lại toàn bộ luồng 3,7 s, nối tham chiếu 1,7 s, quét thư mục có `.gitignore` 1,6 s — đã xử lý bằng luồng cục bộ, không còn "chưa làm".
- **Lỗi hiệu năng tìm thấy và đã sửa nhờ phép đo này** (commit `d2d4ee5`): bước đồng bộ `TESTED_BY` quét cả bảng tạm cho mỗi cạnh (DELETE 41 s + UPDATE 41 s với 62.321 cạnh), làm mỗi lần refresh trên `hermes-agent` mất **84 s** (lần đo đầu, 3 lần lặp 83,8–85,0 s). Thêm chỉ mục cho bảng tạm đưa về 4.73 s. Bài kiểm tra hồi quy `test_derivation_scales_linearly_with_edge_count` đỏ trước sửa (16,4 s), xanh sau (< 1 s). H1 chỉ đo refresh trên NestJS nên không bắt được lỗi này.
- **Lỗi chặn lập chỉ mục tìm thấy trên `open-design`** (commit `6d30c9e`): hàm cùng tên cùng dòng trong tệp JS rút gọn (`three.min.js`, chunk Next.js) làm hai nút trùng `id_nut`, lập chỉ mục kết thúc ở trạng thái `loi` (`UNIQUE constraint failed: nut.id_nut`). Lần đo đầu trên `open-design` thất bại vì lỗi này. Đã sửa, có test.


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




## 7. Kịch bản demo và năm kịch bản lỗi (spec §1.2, §6.3)

**Phạm vi:** bằng chứng dưới đây là **engine thật qua HTTP** (`tools/bench/demo_check.py`, `data/scenario-check.py`) và **test tự động**. **Chưa có lần nào bấm trên cửa sổ Electron**, chưa có ảnh `docs/screenshots/h6/`, chưa có đồng hồ bấm tay. Kết luận "kịch bản chạy trọn 3 lần liên tiếp trên macOS" **chưa đạt được ở mức giao diện**; ở mức engine thì có.

### 7.1 Kịch bản demo ≤ 5 phút (`docs/demo-script.md`), mô phỏng bằng engine, 3 lần liên tiếp

Bản sao NestJS có `git init` + 1 commit, lập chỉ mục qua `POST /index`, rồi gọi đúng các API mà từng thẻ gọi. Số liệu: `data/demo-check.json`.

| Bước | Việc engine đã làm | Kết quả (3/3 lần giống nhau) | Thời gian engine, trung vị |
|---|---|---|---|
| 1–2 | lập chỉ mục, `/architecture`, `/map` | đồ thị dựng xong; kiến trúc gốc có `src`, `test` và 2 tệp cấu hình; bản đồ 268 nút | 1.13 s + 0.02 s |
| 3 | `/flows` → luồng `signIn`, `/context` | 8 bước đúng: `AuthController.signIn` → `AuthService.signIn` → `UsersService.getUser` → `StringUtilService.compare` → `getUserRoleType` → `getUserPermissions` → `createToken` → `UsersService.getUserRoleType`; `/context` trả 24 mục | 0.014 s |
| 4 | sửa `compare`, `/changes` | nút đổi: `StringUtilService`, `StringUtilService.compare`; vùng ảnh hưởng gồm `AuthService.signIn`, `AuthController.signIn` và các module import `StringUtilModule` (10 mục); test liên quan: `order.service.spec.ts`, `users.service.spec.ts`, `string-util.service.spec.ts`; `stale` = false sau refresh | 0.101 s |
| 5 | slide | không thuộc engine | — |

Tổng thời gian engine: 1.27, 1.27, 1.31 s (trung vị 1.27 s). Phần còn lại của 5 phút là thời gian người nói và thao tác giao diện, **chưa đo**.

### 7.2 Năm kịch bản lỗi

| # | Kịch bản (spec §6.3) | Bằng chứng | Kết quả | Chưa kiểm |
|---|---|---|---|---|
| 1 | Chưa cấu hình AI: mọi thẻ dùng được, chat hiện hướng dẫn | test `ChatPanel.test.tsx` "chưa cấu hình: hiện thông báo và nút Mở Cài đặt, không có ô nhập" (jsdom, xanh) | đạt (test) | cửa sổ Electron thật |
| 2 | Mở dự án lớn chưa lập chỉ mục: hộp thoại, chọn thư mục con | engine: `/scan` trên bản sao `hermes-agent` trả `large = true` (17260 tệp, ngưỡng 5000); lập chỉ mục thư mục con `scripts` xong ở trạng thái `done` sau 6.9 s (192 tệp, 2072 nút); test hộp thoại dự án lớn trong bộ test desktop | đạt (engine + test) | hộp thoại trên Electron thật |
| 3 | Dự án Go/Java nhỏ: lập chỉ mục được ở mức chung, không lỗi | **lỗi thật được tìm thấy**: trước H6 Go và Java không nằm trong `LANGUAGE_BY_EXT`, dự án chỉ có Go/Java lập chỉ mục "thành công" với **0 tệp, 1 nút** (không báo gì). Đã sửa: thêm `.go`/`.java` ở mức chung, Tổng quan hiện dòng "Ngôn ngữ ở mức chung…". Sau sửa: bản sao 35 tệp Go → 220 nút, 380 cạnh (0.4 s); 11 tệp Java → 108 nút, 113 cạnh (0.1 s) | đạt sau sửa (engine + test) | Electron thật; chất lượng cạnh Go/Java **chưa chấm** |
| 4 | Mất mạng: dự án đã lập chỉ mục mở bình thường, chat báo `ai_unreachable` | test `ai-chat.test.ts` (`TypeError: fetch failed` → `ai_unreachable`); phần "mở dự án đã lập chỉ mục" là đọc CSDL cục bộ, không gọi mạng | đạt (test) | tắt Wi-Fi thật trên Electron |
| 5 | Không có Git: vẫn mở, vùng ảnh hưởng so với lần lập chỉ mục trước | engine: bản sao NestJS không `.git`, sửa `compare`, `/changes` trả `base = last_index`, note "Không có Git: so với lần lập chỉ mục trước", 1 tệp đổi, 44 mục ảnh hưởng, 3 test; test `test_changes_without_git_uses_last_index` | đạt (engine + test) | thẻ Thay đổi trên Electron thật |


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

