# Đối chiếu NexGraph với graphify

Sinh bởi `scripts/parity/compare_graphify.py` của workspace (không nằm trong repo); chạy lại cho cùng nội dung. Công cụ so: graphify 0.9.115 (`graphify extract --code-only`, `GRAPHIFY_BACKEND=none`, môi trường không có khoá API) và NexGraph engine (index mặc định, chỉ code; `graph.json` xuất qua cầu nối như nút Xuất JSON). Không gọi LLM, không gọi mạng. Node so theo khoá (tệp, tên đã bỏ `.` đầu và `()` cuối) vì spec F10 §4.6 không đòi khớp id; cạnh so theo cặp node vô hướng, không theo số cạnh tuyệt đối. Lệch "chưa rõ" là lệch chưa có lý do đã chốt, cần controller xem.

| Corpus | Mục | graphify | NexGraph | Kết quả | Lý do |
|---|---|---|---|---|---|
| mixed_corpus | Số tệp theo ngôn ngữ | 3 | 3 | khớp |  |
| mixed_corpus | Số node có tệp (khoá tệp + tên) | 41 (+6 không tệp) | 23 | lệch | Chỉ graphify: rationale (18): node `rationale` (docstring, `TODO`, chú thích) graphify tách thành node; NexGraph không có loại node này. |
| mixed_corpus | Node không tệp và cạnh tới chúng | 6 node, 25 cạnh | 0 node; tham chiếu chưa phân giải: CALLS 177, IMPORTS 5 | lệch | Cạnh graphify theo quan hệ: references (16): kiểu, decorator hoặc hàm dựng sẵn/của thư viện ngoài; NexGraph không tạo node ngoài dự án, tham chiếu nằm ở `tham_chieu_chua_phan_giai` (ví dụ `Graph`); calls (4): hàm của thư viện ngoài hoặc dựng sẵn; NexGraph để lời gọi ở `tham_chieu_chua_phan_giai` (ví dụ `networkx`); imports (4): module ngoài dự án; NexGraph không tạo node ngoài dự án (ví dụ `networkx`, `sys`); imports_from (1): module/gói ngoài dự án; NexGraph không tạo node ngoài dự án (ví dụ `validate`). |
| mixed_corpus | Số cặp node có cạnh | 59 | 41 (chung 40) | lệch | Chỉ graphify: missing (18): một đầu là node NexGraph không có (dòng node ở trên), nên cặp không thể có; imports (1): graphify thêm cạnh tệp → symbol được import (`from m import f`, `import { AuthService }`); NexGraph ghi IMPORTS mức tệp → tệp (hợp đồng enum ở roadmap) và cặp tệp–tệp đó đã khớp. Chỉ NexGraph: DEFINES (1): NexGraph gắn hàm lồng và bảng SQL vào tệp/cha bằng DEFINES. |
| mixed_corpus | Tập community (theo tệp) | 3 nhóm | 2 nhóm, trùng hẳn 1, Rand 0.67 trên 3 tệp | lệch | graphify tách `analyze.py` và `cluster.py` thành hai cụm node (Leiden trên cả 18 node rationale); NexGraph gộp hai tệp vì có IMPORTS/CALLS giữa chúng. NexGraph gom cụm theo tệp (Louvain trên đồ thị tệp IMPORTS+CALLS, chỉ giữ cụm ≥ 2 tệp, seed 42; kế hoạch P3 Task 4, `2026-10-27-nexgraph-p3-search-architecture.md`), graphify gom node bằng Leiden. Spec F10 §4.6 chỉ đòi so tập cụm, không đòi trùng thuật toán |
| mixed_corpus | Seed của 10 câu `query` |  | 7/10 khớp | lệch | Do đồ thị, không do thuật toán (dòng dưới khớp 10/10). Hạt giống lệch theo nhóm: no_file (2): graphify chọn node không tệp (dòng node không tệp), NexGraph không có node này; score (1): node có ở cả hai đồ thị nhưng điểm khác: nhãn method `.f()` so với `f`, số node cùng từ khoá (IDF) và cạnh khác nhau; state (1): một bên báo tên mơ hồ hoặc không khớp vì đồ thị bên kia có thêm hoặc thiếu node cùng tên. |
| mixed_corpus | Seed `query` — thuật toán (graphify chạy trên `graph.json` NexGraph) |  | 10/10 khớp | khớp |  |
| mixed_corpus | `path` có đường (10 cặp: cạnh và chiều ngược) |  | 5/10 khớp | lệch | tìm đường NexGraph chỉ đi qua cạnh thật (`PATH_TYPES`, bỏ DEFINES/CONTAINS, spec gốc §5.8) và tối đa 4 hop; graphify đi qua cả cạnh `contains` (ngược chiều, ví dụ `f() <--contains-- tệp --contains--> g()`) |
| mixed_corpus | `graph.json` NexGraph nạp bằng `graphify-mcp` (`graph_stats`) |  | Nodes: 23, Edges: 41, Communities: 2 | khớp |  |
| polyglot | Số tệp theo ngôn ngữ | 17 | 17 | khớp |  |
| polyglot | Số node có tệp (khoá tệp + tên) | 39 (+3 không tệp) | 39 | khớp |  |
| polyglot | Node không tệp và cạnh tới chúng | 3 node, 3 cạnh | 0 node; tham chiếu chưa phân giải: CALLS 6, IMPORTS 1 | lệch | Cạnh graphify theo quan hệ: references (2): kiểu, decorator hoặc hàm dựng sẵn/của thư viện ngoài; NexGraph không tạo node ngoài dự án, tham chiếu nằm ở `tham_chieu_chua_phan_giai` (ví dụ `Int`); in_project (1): graphify không nối được import tới tệp trong dự án, chỉ ra node khái niệm (Rust `use crate::util::helper` → `helper`); NexGraph cũng thiếu cạnh `main.rs → util.rs`, Ruling "không sửa" ở `2026-11-21-nexgraph-gfy-fix-cpp-include.md` (ví dụ `helper`). |
| polyglot | Số cặp node có cạnh | 31 | 32 (chung 31) | lệch | Chỉ NexGraph: CALLS (1): resolver NexGraph (import + kiểu biến, lượt cả lô của W2 Task 4b) nối được lời gọi graphify bỏ sót, hoặc ghi lớp dùng như giá trị (`NestFactory.create(AppModule)`) thành CALLS INFERRED; mẫu ở mục chi tiết. |
| polyglot | Tập community (theo tệp) | 9 nhóm | 8 nhóm, trùng hẳn 7, Rand 0.99 trên 17 tệp | lệch | `kotlin/Main.kt` và `kotlin/Util.kt` chung cụm ở NexGraph vì NexGraph có cạnh CALLS `main → Util.helper` mà graphify bỏ sót (dòng cặp cạnh); các nhóm còn lại trùng hẳn. NexGraph gom cụm theo tệp (Louvain trên đồ thị tệp IMPORTS+CALLS, chỉ giữ cụm ≥ 2 tệp, seed 42; kế hoạch P3 Task 4, `2026-10-27-nexgraph-p3-search-architecture.md`), graphify gom node bằng Leiden. Spec F10 §4.6 chỉ đòi so tập cụm, không đòi trùng thuật toán |
| polyglot | Seed của 10 câu `query` |  | 0/10 khớp | lệch | Do đồ thị, không do thuật toán (dòng dưới khớp 10/10). Hạt giống lệch theo nhóm: score (10): node có ở cả hai đồ thị nhưng điểm khác: nhãn method `.f()` so với `f`, số node cùng từ khoá (IDF) và cạnh khác nhau; no_file (4): graphify chọn node không tệp (dòng node không tệp), NexGraph không có node này. |
| polyglot | Seed `query` — thuật toán (graphify chạy trên `graph.json` NexGraph) |  | 10/10 khớp | khớp |  |
| polyglot | `path` có đường (10 cặp: cạnh và chiều ngược) |  | 10/10 khớp | khớp |  |
| polyglot | `graph.json` NexGraph nạp bằng `graphify-mcp` (`graph_stats`) |  | Nodes: 39, Edges: 32, Communities: 8 | khớp |  |
| dự án NestJS mẫu | Số tệp theo ngôn ngữ | 288 | 280 | lệch | `.json` 6/0 (6): graphify `--code-only` coi `.json` là code; NexGraph chỉ index khi bật "Tệp cấu hình" mặc định tắt (W2 Task 3, `include_config`, `2026-11-20-nexgraph-gfy-w2-ngon-ngu.md`); `.yml` 2/0 (2): graphify `--code-only` coi `.yml` là code; NexGraph chỉ index khi bật "Tệp cấu hình" mặc định tắt (W2 Task 3, `include_config`, `2026-11-20-nexgraph-gfy-w2-ngon-ngu.md`) |
| dự án NestJS mẫu | Số node có tệp (khoá tệp + tên) | 1614 (+392 không tệp) | 1124 | lệch | Chỉ graphify: config (237): khoá trong tệp cấu hình; "Tệp cấu hình" mặc định tắt (W2 Task 3, `include_config`, `2026-11-20-nexgraph-gfy-w2-ngon-ngu.md`); legacy (204): hằng, biến, thành viên enum của 7 ngôn ngữ có trước W2 giữ cách lọc cũ để index mặc định không đổi số node/cạnh (ràng buộc chung của kế hoạch tổng; `index/generic.py` `_LEGACY_LANGUAGES`, `_keep`); concept (74): node gói phụ thuộc lấy từ `package.json`/manifest; NexGraph chỉ có khi bật "Tệp cấu hình" mặc định tắt (W2 Task 3, `include_config`, `2026-11-20-nexgraph-gfy-w2-ngon-ngu.md`); sql (30): graphify 0.9.115 đã có extra `[sql]` (khác lượt 0.9.112) và đặt tên bảng **có schema** (`"public"."User"`) trong khi NexGraph đặt tên **không schema** (`"User"`), nên 30 khoá lệch 1:1 dù cùng 11 tệp `.sql`; rationale (1): node `rationale` (docstring, `TODO`, chú thích) graphify tách thành node; NexGraph không có loại node này. Chỉ NexGraph: sql (30): cùng 11 tệp `.sql` nhưng tên bảng không schema, xem mục sql ở trên. |
| dự án NestJS mẫu | Node không tệp và cạnh tới chúng | 392 node, 597 cạnh | 0 node; tham chiếu chưa phân giải: CALLS 2194, IMPLEMENTS 37, IMPORTS 460, INHERITS 51 | lệch | Cạnh graphify theo quan hệ: references (551): kiểu, decorator hoặc hàm dựng sẵn/của thư viện ngoài; NexGraph không tạo node ngoài dự án, tham chiếu nằm ở `tham_chieu_chua_phan_giai` (ví dụ `Body`, `Catch`, `Controller`, `Cron` …); imports_from (46): module/gói ngoài dự án; NexGraph không tạo node ngoài dự án (ví dụ `ref_crypto`, `ref_express`, `ref_fs`, `ref_jest_mock` …). |
| dự án NestJS mẫu | Số cặp node có cạnh | 4619 | 2377 (chung 2300) | lệch | Chỉ graphify: missing (1184): một đầu là node NexGraph không có (dòng node ở trên), nên cặp không thể có; imports (586): graphify thêm cạnh tệp → symbol được import (`from m import f`, `import { AuthService }`); NexGraph ghi IMPORTS mức tệp → tệp (hợp đồng enum ở roadmap) và cặp tệp–tệp đó đã khớp; references (549): tham chiếu kiểu (tham số constructor, DTO, decorator) của 7 ngôn ngữ có trước W2 giữ cách lọc cũ để index mặc định không đổi số node/cạnh (ràng buộc chung của kế hoạch tổng; `index/generic.py` `_LEGACY_LANGUAGES`, `_keep`); ngôn ngữ mức chung thì NexGraph giữ (REFERENCES). Chỉ NexGraph: missing (56): một đầu là node graphify không có (dòng node ở trên); CALLS (21): resolver NexGraph (import + kiểu biến, lượt cả lô của W2 Task 4b) nối được lời gọi graphify bỏ sót, hoặc ghi lớp dùng như giá trị (`NestFactory.create(AppModule)`) thành CALLS INFERRED; mẫu ở mục chi tiết. |
| dự án NestJS mẫu | Tập community (theo tệp) | 91 nhóm | 33 nhóm, trùng hẳn 14, Rand 0.90 trên 280 tệp | lệch | Nhóm lệch (dấu `19d0e7562b`) gồm hai phần đã xem tay: (1) các tệp `prisma/migrations/*/migration.sql` — graphify gộp chung một cụm, NexGraph để mỗi tệp một cụm vì file graph không có cạnh giữa các migration; (2) cụm khởi động `app.module.ts`, `main.ts`, `init.ts`, middleware và swagger helper — graphify tách khác vì đồ thị node của nó có thêm config/legacy/concept và cạnh import tệp → symbol, còn NexGraph gom cụm trên đồ thị **tệp** IMPORTS+CALLS (Louvain, cụm ≥ 2 tệp, seed 42; kế hoạch P3 Task 4, `2026-10-27-nexgraph-p3-search-architecture.md`). Khác thuật toán và khác tập node, không phải thiếu cạnh; spec F10 §4.6 chỉ đòi so tập cụm, không đòi trùng thuật toán |
| dự án NestJS mẫu | Seed của 10 câu `query` |  | 1/10 khớp | lệch | Do đồ thị, không do thuật toán (dòng dưới khớp 10/10). Hạt giống lệch theo nhóm: score (9): node có ở cả hai đồ thị nhưng điểm khác: nhãn method `.f()` so với `f`, số node cùng từ khoá (IDF) và cạnh khác nhau; g_only (5): graphify chọn node mà NexGraph không có (dòng node); no_file (1): graphify chọn node không tệp (dòng node không tệp), NexGraph không có node này; state (1): một bên báo tên mơ hồ hoặc không khớp vì đồ thị bên kia có thêm hoặc thiếu node cùng tên. |
| dự án NestJS mẫu | Seed `query` — thuật toán (graphify chạy trên `graph.json` NexGraph) |  | 10/10 khớp | khớp |  |
| dự án NestJS mẫu | `path` có đường (10 cặp: cạnh và chiều ngược) |  | 10/10 khớp | khớp |  |
| dự án NestJS mẫu | `graph.json` NexGraph nạp bằng `graphify-mcp` (`graph_stats`) |  | Nodes: 1124, Edges: 2377, Communities: 11 | khớp |  |

*Bảng 1. Kết quả đối chiếu NexGraph với graphify theo corpus*

Lượt này chạy lại toàn bộ trên `83e49b7` bằng graphify 0.9.115 (lượt W12 dùng 0.9.112). Đây là mốc duy nhất dùng trong tệp, đúng commit mà `--stamp` ghi vào bảng; `a4dbe39` (8 commit sau, chỉ đổi tài liệu) có mã `engine`/`apps` giống hệt — `git diff --stat 83e49b7..a4dbe39 -- engine apps` rỗng — nên không dùng làm mốc riêng. Khác biệt chính: 0.9.115 đã có extra `[sql]` nên 11 tệp `.sql` của NestJS vào graph và tên bảng có schema; vì vậy hai dòng `Số node có tệp` và `Tập community` của NestJS đổi số và được giải thích lại ở trên, không phải hồi quy của NexGraph.

**Tổng:** 11 khớp · 16 lệch có lý do · 0 lệch chưa rõ.

## mixed_corpus

Nguồn: `engine/tests/fixtures/mixed_corpus/raw`.

Tệp theo đuôi (graphify/NexGraph): `.py` 3/3.
Node chỉ graphify có (18): rationale: `('analyze.py', "Return True if this node is a file-level hub node (e.g. 'cli")`, `('analyze.py', 'Compare two graph snapshots and return what changed. Returns')`, `('analyze.py', 'Cross-file edges between real code/doc entities, ranked by a')` ….
Node chỉ NexGraph có (0): không.
Node không tệp của graphify (6): `Graph (code)`, `networkx (concept)`, `sys (concept)`, `validate (concept)`.
Cặp chỉ graphify có (19): imports: `(('analyze.py', 'analyze.py'), ('cluster.py', 'cohesion_score'))`; missing: `(('analyze.py', "Return True if this node is a file-level hub node (e.g. 'client', 'models') or…"), ('analyze.py', '_is_file_node'))`, `(('analyze.py', 'Compare two graph snapshots and return what changed. Returns: { "new_nodes":…'), ('analyze.py', 'graph_diff'))`, `(('analyze.py', 'Cross-file edges between real code/doc entities, ranked by a composite surprise…'), ('analyze.py', '_cross_file_surprises'))` ….
Cặp chỉ NexGraph có (1): DEFINES: `(('analyze.py', 'analyze.py'), ('analyze.py', 'edge_key'))`.
Nhóm tệp lệch (dấu `ba2fd19b55`; tệp NexGraph không vào cụm nào tính là nhóm một tệp): chỉ graphify `['analyze.py']`, `['cluster.py']`; chỉ NexGraph `['analyze.py', 'cluster.py']`.
- query `how does cluster split a community`: graphify [_cross_community_surprises, _split_community, cluster] · NexGraph [_cross_community_surprises, _split_community, cluster] · graphify trên graph NexGraph [_cross_community_surprises, _split_community, cluster]
- query `god nodes`: graphify [god_nodes] · NexGraph [god_nodes] · graphify trên graph NexGraph [god_nodes]
- query `surprising connections`: graphify [surprising_connections] · NexGraph [surprising_connections] · graphify trên graph NexGraph [surprising_connections]
- query `build graph from json`: graphify [Graph, build, build_from_json, build_graph] · NexGraph [build, build_from_json, build_graph, graph_diff] · graphify trên graph NexGraph [build, build_from_json, build_graph, graph_diff]
- query `cohesion score`: graphify [cohesion_score, score_all] · NexGraph [cohesion_score, score_all] · graphify trên graph NexGraph [cohesion_score, score_all]
- query `suggest questions`: graphify [suggest_questions] · NexGraph [suggest_questions] · graphify trên graph NexGraph [suggest_questions]
- query `graph diff`: graphify [Graph, graph_diff] · NexGraph [graph_diff] · graphify trên graph NexGraph [graph_diff]
- query `what calls cluster`: graphify [cluster] · NexGraph [cluster] · graphify trên graph NexGraph [cluster]
- query `file category`: graphify [_file_category] · NexGraph [_file_category] · graphify trên graph NexGraph [_file_category]
- query `build`: graphify báo tên mơ hồ · NexGraph [build] · graphify trên graph NexGraph [build]
- path `_cross_community_surprises` (analyze.py) → `_is_file_node` (analyze.py): graphify có · NexGraph có
- path `_cross_community_surprises` (analyze.py) → `_node_community_map` (analyze.py): graphify có · NexGraph có
- path `_cross_file_surprises` (analyze.py) → `_cross_community_surprises` (analyze.py): graphify có · NexGraph có
- path `_cross_file_surprises` (analyze.py) → `_is_concept_node` (analyze.py): graphify có · NexGraph có
- path `_cross_file_surprises` (analyze.py) → `_is_file_node` (analyze.py): graphify có · NexGraph có
- path `_is_file_node` (analyze.py) → `_cross_community_surprises` (analyze.py): graphify có · NexGraph không
- path `_node_community_map` (analyze.py) → `_cross_community_surprises` (analyze.py): graphify có · NexGraph không
- path `_cross_community_surprises` (analyze.py) → `_cross_file_surprises` (analyze.py): graphify có · NexGraph không
- path `_is_concept_node` (analyze.py) → `_cross_file_surprises` (analyze.py): graphify có · NexGraph không
- path `_is_file_node` (analyze.py) → `_cross_file_surprises` (analyze.py): graphify có · NexGraph không

## polyglot

Nguồn: `engine/tests/fixtures/polyglot`.

Tệp theo đuôi (graphify/NexGraph): `.cpp` 2/2, `.go` 2/2, `.h` 1/1, `.java` 2/2, `.kt` 2/2, `.php` 2/2, `.rb` 2/2, `.rs` 2/2, `.swift` 2/2.
Node chỉ graphify có (0): không.
Node chỉ NexGraph có (0): không.
Node không tệp của graphify (3): `Int (code)`, `helper (concept)`.
Cặp chỉ graphify có (0): không.
Cặp chỉ NexGraph có (1): CALLS: `(('kotlin/Main.kt', 'main'), ('kotlin/Util.kt', 'helper'))`.
Nhóm tệp lệch (dấu `c35e2f4ec1`; tệp NexGraph không vào cụm nào tính là nhóm một tệp): chỉ graphify `['kotlin/Main.kt']`, `['kotlin/Util.kt']`; chỉ NexGraph `['kotlin/Main.kt', 'kotlin/Util.kt']`.
- query `main calls helper`: graphify [Main, helper, main] · NexGraph [helper, main] · graphify trên graph NexGraph [helper, main]
- query `java Main`: graphify [Main, Main.java, main] · NexGraph [Main, Main.java] · graphify trên graph NexGraph [Main, Main.java]
- query `rust helper`: graphify [helper, helper, main] · NexGraph [helper, main] · graphify trên graph NexGraph [helper, main]
- query `Util helper`: graphify [Util, helper, helper] · NexGraph [Util, helper] · graphify trên graph NexGraph [Util, helper]
- query `kotlin main`: graphify [Main, Util, main] · NexGraph [main] · graphify trên graph NexGraph [main]
- query `swift run`: graphify [main.swift, run] · NexGraph [Util.swift, run] · graphify trên graph NexGraph [Util.swift, run]
- query `php run`: graphify [main.php, run] · NexGraph [Util.php, run] · graphify trên graph NexGraph [Util.php, run]
- query `ruby Util`: graphify [Util] · NexGraph [Util, run] · graphify trên graph NexGraph [Util, run]
- query `go Helper`: graphify [helper, helper, helper] · NexGraph [helper] · graphify trên graph NexGraph [helper]
- query `cpp main`: graphify [Main, main, main.cpp] · NexGraph [main, main.cpp] · graphify trên graph NexGraph [main, main.cpp]
- path `main` (cpp/main.cpp) → `helper` (cpp/util.cpp): graphify có · NexGraph có
- path `main` (go/main.go) → `Helper` (go/util.go): graphify có · NexGraph có
- path `main` (java/Main.java) → `helper` (java/Util.java): graphify có · NexGraph có
- path `run` (php/main.php) → `helper` (php/Util.php): graphify có · NexGraph có
- path `run` (ruby/main.rb) → `helper` (ruby/util.rb): graphify có · NexGraph có
- path `helper` (cpp/util.cpp) → `main` (cpp/main.cpp): graphify không · NexGraph không
- path `Helper` (go/util.go) → `main` (go/main.go): graphify không · NexGraph không
- path `helper` (java/Util.java) → `main` (java/Main.java): graphify không · NexGraph không
- path `helper` (php/Util.php) → `run` (php/main.php): graphify không · NexGraph không
- path `helper` (ruby/util.rb) → `run` (ruby/main.rb): graphify không · NexGraph không

## dự án NestJS mẫu

Nguồn: ngoài repo.

Tệp theo đuôi (graphify/NexGraph): `.json` 6/0, `.mjs` 2/2, `.ps1` 1/1, `.sql` 11/11, `.ts` 266/266, `.yml` 2/0.
Node chỉ graphify có (546): concept: `('package.json', '@commitlint/cli')`, `('package.json', '@commitlint/config-conventional')`, `('package.json', '@eslint/eslintrc')` …; config: `('.github/workflows/ci.yml', 'DATABASE_URL')`, `('.github/workflows/ci.yml', 'DIRECT_URL')`, `('.github/workflows/ci.yml', 'NODE_ENV')` …; legacy: `('src/apps/auth/auth.decorator.ts', 'IS_SKIP_AUTH')`, `('src/apps/auth/auth.decorator.ts', 'IS_SKIP_PERMISSION')`, `('src/apps/auth/auth.decorator.ts', 'ROLES_KEY')` …; rationale: `('src/apps/payments/payments.service.ts', 'TODO: Gọi API refund của VNPay')`; sql: `('prisma/migrations/20260529192433_init/migration.sql', '"public"."User"')`, `('prisma/migrations/20260529192433_init/migration.sql', '20260529192433_init/migration.sql')`, `('prisma/migrations/20260531023807_init/migration.sql', '"public"."Permission"')` ….
Node chỉ NexGraph có (30): sql: `('prisma/migrations/20260529192433_init/migration.sql', '"User"')`, `('prisma/migrations/20260529192433_init/migration.sql', 'migration.sql')`, `('prisma/migrations/20260531023807_init/migration.sql', '"Permission"')` ….
Node không tệp của graphify (392): `Body (code)`, `Catch (code)`, `Controller (code)`, `Cron (code)`, `Delete (code)`, `Get (code)`, `Global (code)`, `HealthCheck (code)` ….
Cặp chỉ graphify có (2319): imports: `(('src/apps/app.controller.ts', 'app.controller.ts'), ('src/apps/app.service.ts', 'AppService'))`, `(('src/apps/app.module.ts', 'AppModule'), ('src/main.ts', 'main.ts'))`, `(('src/apps/auth/auth.controller.ts', 'auth.controller.ts'), ('src/apps/auth/auth.decorator.ts', 'SkipAuth'))` …; references: `(('src/apps/app.controller.ts', 'constructor'), ('src/apps/app.service.ts', 'AppService'))`, `(('src/apps/auth/auth.controller.ts', 'constructor'), ('src/apps/auth/auth.service.ts', 'AuthService'))`, `(('src/apps/auth/auth.controller.ts', 'forgotPassword'), ('src/apps/auth/auth.decorator.ts', 'SkipAuth'))` …; missing: `(('.github/workflows/ci.yml', 'DATABASE_URL'), ('.github/workflows/ci.yml', 'env'))`, `(('.github/workflows/ci.yml', 'DIRECT_URL'), ('.github/workflows/ci.yml', 'env'))`, `(('.github/workflows/ci.yml', 'NODE_ENV'), ('.github/workflows/ci.yml', 'env'))` ….
Cặp chỉ NexGraph có (77): CALLS: `(('src/apps/app.module.ts', 'AppModule'), ('src/main.ts', 'bootstrap'))`, `(('src/apps/app.module.ts', 'AppModule'), ('test/app.e2e-spec.ts', 'app.e2e-spec.ts'))`, `(('src/apps/cart-items/cart-items.service.spec.ts', 'cart-items.service.spec.ts'), ('src/testing/auto-mocking/auto-mocking.module.ts', 'createTestingModule'))` …; missing: `(('prisma/migrations/20260529192433_init/migration.sql', '"User"'), ('prisma/migrations/20260529192433_init/migration.sql', 'migration.sql'))`, `(('prisma/migrations/20260529192433_init/migration.sql', 'User_email_key'), ('prisma/migrations/20260529192433_init/migration.sql', 'migration.sql'))`, `(('prisma/migrations/20260531023807_init/migration.sql', '"Permission"'), ('prisma/migrations/20260531023807_init/migration.sql', '"RolePermission"'))` ….
Nhóm tệp lệch (dấu `19d0e7562b`; tệp NexGraph không vào cụm nào tính là nhóm một tệp): chỉ graphify `['prisma/migrations/20260529192433_init/migration.sql', 'prisma/migrations/20260531023807_init/migration.sql', 'prisma/migrations/20260606112141_init/migration.sql', 'prisma/migrations/20260704211433_add_payment_table/migration.sql']`, `['src/apps/app.controller.spec.ts', 'src/apps/app.controller.ts', 'src/apps/app.service.ts']`, `['src/apps/app.module.ts', 'src/common/helpers/swagger.helper.ts', 'src/common/middleware/common.middleware.ts', 'src/init.ts', 'src/main.ts']` …; chỉ NexGraph `['prisma/migrations/20260529192433_init/migration.sql']`, `['prisma/migrations/20260531023807_init/migration.sql']`, `['prisma/migrations/20260606112141_init/migration.sql']` ….
- query `sign in`: graphify [SignInDto, SignUpDto, sign.dto.ts] · NexGraph [SignInDto, SignUpDto, sign.dto.ts] · graphify trên graph NexGraph [SignInDto, SignUpDto, sign.dto.ts]
- query `auth service`: graphify [Auth, auth.service.ts, services] · NexGraph [Auth, auth.service.ts, prisma.service.ts] · graphify trên graph NexGraph [Auth, auth.service.ts, prisma.service.ts]
- query `create product`: graphify [CREATE, Product, create-product-images.dto.ts, create-product-variant.dto.ts, create-product.dto.ts] · NexGraph [Product, create-product-images.dto.ts, create-product-variant.dto.ts, create-product.dto.ts] · graphify trên graph NexGraph [Product, create-product-images.dto.ts, create-product-variant.dto.ts, create-product.dto.ts]
- query `cart items`: graphify [Cart, OrderItemsService, cart-items.controller.ts, cart-items.module.ts, cart-items.service.ts] · NexGraph [Cart, CartItemsService, cart-items.controller.ts, cart-items.module.ts, cart-items.service.ts] · graphify trên graph NexGraph [Cart, CartItemsService, cart-items.controller.ts, cart-items.module.ts, cart-items.service.ts]
- query `payments`: graphify [PaymentsController, PaymentsModule, PaymentsService, payments.service.ts] · NexGraph [PaymentsController, PaymentsModule, PaymentsService] · graphify trên graph NexGraph [PaymentsController, PaymentsModule, PaymentsService]
- query `role permissions`: graphify [Role, permissions.service.ts, role-permissions.controller.ts, role-permissions.module.ts, role-permissions.service.ts] · NexGraph [PermissionsService, Role, role-permissions.controller.ts, role-permissions.module.ts, role-permissions.service.ts] · graphify trên graph NexGraph [PermissionsService, Role, role-permissions.controller.ts, role-permissions.module.ts, role-permissions.service.ts]
- query `prisma service`: graphify [prisma, prisma.service.ts, services] · NexGraph [prisma.service.ts] · graphify trên graph NexGraph [prisma.service.ts]
- query `jwt guard`: graphify [JWTEnvs, JWTToken, JWT_SECRET, access-control.guard.ts, jwt.const.ts] · NexGraph [JWTEnvs, JWTToken, access-control.guard.ts, jwt.const.ts] · graphify trên graph NexGraph [JWTEnvs, JWTToken, access-control.guard.ts, jwt.const.ts]
- query `vendors controller`: graphify [Controller, vendors.controller.ts, vendors.service.ts] · NexGraph [vendor-product.controller.ts, vendors.controller.ts, vendors.module.ts] · graphify trên graph NexGraph [vendor-product.controller.ts, vendors.controller.ts, vendors.module.ts]
- query `promotion`: graphify [Promotion] · NexGraph báo tên mơ hồ · graphify trên graph NexGraph báo tên mơ hồ
- path `getHello` (src/apps/app.controller.ts) → `getHello` (src/apps/app.service.ts): graphify có · NexGraph có
- path `forgotPassword` (src/apps/auth/auth.controller.ts) → `forgotPassword` (src/apps/auth/auth.service.ts): graphify có · NexGraph có
- path `refreshToken` (src/apps/auth/auth.controller.ts) → `refreshToken` (src/apps/auth/auth.service.ts): graphify có · NexGraph có
- path `resetPassword` (src/apps/auth/auth.controller.ts) → `resetPassword` (src/apps/auth/auth.service.ts): graphify có · NexGraph có
- path `signIn` (src/apps/auth/auth.controller.ts) → `signIn` (src/apps/auth/auth.service.ts): graphify có · NexGraph có
- path `getHello` (src/apps/app.service.ts) → `getHello` (src/apps/app.controller.ts): graphify không · NexGraph không
- path `forgotPassword` (src/apps/auth/auth.service.ts) → `forgotPassword` (src/apps/auth/auth.controller.ts): graphify không · NexGraph không
- path `refreshToken` (src/apps/auth/auth.service.ts) → `refreshToken` (src/apps/auth/auth.controller.ts): graphify không · NexGraph không
- path `resetPassword` (src/apps/auth/auth.service.ts) → `resetPassword` (src/apps/auth/auth.controller.ts): graphify không · NexGraph không
- path `signIn` (src/apps/auth/auth.service.ts) → `signIn` (src/apps/auth/auth.controller.ts): graphify không · NexGraph không

Chạy ngày 2026-11-23 trên NexGraph `83e49b7` (mốc của `--stamp`; mã `engine`/`apps` trùng `a4dbe39`).
