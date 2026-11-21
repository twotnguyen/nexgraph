# Đối chiếu NexGraph với graphify — 2026-11-21

Sinh bởi `scripts/parity/compare_graphify.py` của workspace (không nằm trong repo), NexGraph tại `8832612`. Công cụ so: graphify 0.9.112 (`graphify extract --code-only`, `GRAPHIFY_BACKEND=none`, môi trường không có khoá API) và NexGraph engine (index mặc định, chỉ code; `graph.json` xuất qua cầu nối như nút Xuất JSON). Không gọi LLM, không gọi mạng. Node so theo khoá (tệp, tên đã bỏ `.` đầu và `()` cuối) vì spec F10 §4.6 không đòi khớp id; cạnh so theo cặp node vô hướng, không theo số cạnh tuyệt đối. Lệch "chưa rõ" là lệch chưa có lý do đã chốt, cần controller xem.

| Corpus | Mục | graphify | NexGraph | Kết quả | Lý do |
|---|---|---|---|---|---|
| mixed_corpus | Số tệp theo ngôn ngữ | 3 | 3 | khớp |  |
| mixed_corpus | Số node có tệp (khoá tệp + tên) | 41 (+6 không tệp) | 23 | lệch | Chỉ graphify: rationale (18): node `rationale` (docstring, `TODO`, chú thích) graphify tách thành node; NexGraph không có loại node này. |
| mixed_corpus | Số cặp node có cạnh | 59 | 41 (chung 40) | lệch | Chỉ graphify: missing (18): một đầu là node NexGraph không có (dòng node ở trên), nên cặp không thể có; imports (1): graphify thêm cạnh tệp → symbol được import (`from m import f`, `import { AuthService }`); NexGraph ghi IMPORTS mức tệp → tệp (hợp đồng enum ở roadmap) và cặp tệp–tệp đó đã khớp. Chỉ NexGraph: DEFINES (1): NexGraph gắn hàm lồng và bảng SQL vào tệp/cha bằng DEFINES. |
| mixed_corpus | Tập community (theo tệp) | 3 nhóm | 2 nhóm, trùng hẳn 1, Rand 0.67 trên 3 tệp | lệch | NexGraph gom cụm **theo tệp** (Louvain trên đồ thị tệp IMPORTS+CALLS, chỉ giữ cụm ≥ 2 tệp, seed 42; kế hoạch P3 Task 4, `2026-10-27-nexgraph-p3-search-architecture.md`), graphify gom theo node trên đồ thị khác (thêm node cấu hình, rationale). Spec F10 §4.6 chỉ đòi so tập cụm, không đòi trùng thuật toán. Tệp NexGraph không xếp vào cụm nào được tính là một nhóm một tệp; Rand là tỉ lệ cặp tệp được xếp giống nhau |
| mixed_corpus | Seed của 10 câu `query` |  | 7/10 khớp | lệch | hai bên dùng cùng hàm chọn hạt giống của graphify (`_score_query`, `_pick_seeds`; W3) nhưng trên hai đồ thị khác nhau (node rationale/cấu hình/hằng, nhãn method `.f()` so với `f`), nên IDF và hạt giống khác; dòng "thuật toán" bên dưới chạy graphify trên chính `graph.json` NexGraph để tách hai nguyên nhân |
| mixed_corpus | Seed `query` — thuật toán (graphify chạy trên `graph.json` NexGraph) |  | 10/10 khớp | khớp |  |
| mixed_corpus | `path` có đường (10 cặp: cạnh và chiều ngược) |  | 5/10 khớp | lệch | tìm đường NexGraph chỉ đi qua cạnh thật (`PATH_TYPES`, bỏ DEFINES/CONTAINS, spec gốc §5.8) và tối đa 4 hop; graphify đi qua cả cạnh `contains` (ngược chiều, ví dụ `f() <--contains-- tệp --contains--> g()`) |
| mixed_corpus | `graph.json` NexGraph nạp bằng `graphify-mcp` (`graph_stats`) |  | Nodes: 23, Edges: 41, Communities: 2 | khớp |  |
| polyglot | Số tệp theo ngôn ngữ | 17 | 17 | khớp |  |
| polyglot | Số node có tệp (khoá tệp + tên) | 39 (+3 không tệp) | 39 | khớp |  |
| polyglot | Số cặp node có cạnh | 31 | 30 (chung 29) | lệch | **chưa rõ** — Chỉ graphify: imports (ngôn ngữ mức chung) (2): **chưa rõ**. Chỉ NexGraph: CALLS (1): resolver NexGraph nối lời gọi graphify bỏ sót: hàm top-level Kotlin gọi method lớp khác tệp (W2 Task 4b), lời gọi ở cấp tệp/callback (`describe`), lớp dùng như giá trị (`NestFactory.create(AppModule)`, `imports: [AppModule]`) ghi CALLS INFERRED. |
| polyglot | Tập community (theo tệp) | 9 nhóm | 9 nhóm, trùng hẳn 6, Rand 0.98 trên 17 tệp | lệch | NexGraph gom cụm **theo tệp** (Louvain trên đồ thị tệp IMPORTS+CALLS, chỉ giữ cụm ≥ 2 tệp, seed 42; kế hoạch P3 Task 4, `2026-10-27-nexgraph-p3-search-architecture.md`), graphify gom theo node trên đồ thị khác (thêm node cấu hình, rationale). Spec F10 §4.6 chỉ đòi so tập cụm, không đòi trùng thuật toán. Tệp NexGraph không xếp vào cụm nào được tính là một nhóm một tệp; Rand là tỉ lệ cặp tệp được xếp giống nhau |
| polyglot | Seed của 10 câu `query` |  | 0/10 khớp | lệch | hai bên dùng cùng hàm chọn hạt giống của graphify (`_score_query`, `_pick_seeds`; W3) nhưng trên hai đồ thị khác nhau (node rationale/cấu hình/hằng, nhãn method `.f()` so với `f`), nên IDF và hạt giống khác; dòng "thuật toán" bên dưới chạy graphify trên chính `graph.json` NexGraph để tách hai nguyên nhân |
| polyglot | Seed `query` — thuật toán (graphify chạy trên `graph.json` NexGraph) |  | 10/10 khớp | khớp |  |
| polyglot | `path` có đường (10 cặp: cạnh và chiều ngược) |  | 10/10 khớp | khớp |  |
| polyglot | `graph.json` NexGraph nạp bằng `graphify-mcp` (`graph_stats`) |  | Nodes: 39, Edges: 30, Communities: 9 | khớp |  |
| nestjs | Số tệp theo ngôn ngữ | 277 | 280 | lệch | `.sql` 0/11 (11): graphify cài bằng `uv tool` thiếu extra `[sql]` (`tree_sitter_sql`), nên tệp `.sql` trích lỗi và không vào graph; NexGraph đóng gói grammar SQL (W2). Lệch do môi trường của công cụ đối chiếu; `.json` 6/0 (6): graphify `--code-only` coi `.json` là code; NexGraph chỉ index khi bật "Tệp cấu hình" mặc định tắt (W2 Task 3, `include_config`, `2026-11-20-nexgraph-gfy-w2-ngon-ngu.md`); `.yml` 2/0 (2): graphify `--code-only` coi `.yml` là code; NexGraph chỉ index khi bật "Tệp cấu hình" mặc định tắt (W2 Task 3, `include_config`, `2026-11-20-nexgraph-gfy-w2-ngon-ngu.md`) |
| nestjs | Số node có tệp (khoá tệp + tên) | 1565 (+392 không tệp) | 1124 | lệch | Chỉ graphify: config (237): khoá trong tệp cấu hình; "Tệp cấu hình" mặc định tắt (W2 Task 3, `include_config`, `2026-11-20-nexgraph-gfy-w2-ngon-ngu.md`); legacy (204): hằng, biến, thành viên enum của 7 ngôn ngữ có trước W2 giữ cách lọc cũ để index mặc định không đổi số node/cạnh (ràng buộc chung của kế hoạch tổng; `index/generic.py` `_LEGACY_LANGUAGES`, `_keep`); concept (75): node gói phụ thuộc lấy từ `package.json`/manifest; NexGraph chỉ có khi bật "Tệp cấu hình" mặc định tắt (W2 Task 3, `include_config`, `2026-11-20-nexgraph-gfy-w2-ngon-ngu.md`); rationale (1): node `rationale` (docstring, `TODO`, chú thích) graphify tách thành node; NexGraph không có loại node này. Chỉ NexGraph: sql (50): bảng/tệp `.sql`: graphify cài bằng `uv tool` thiếu extra `[sql]` (`tree_sitter_sql`), nên tệp `.sql` trích lỗi và không vào graph; NexGraph đóng gói grammar SQL (W2). Lệch do môi trường của công cụ đối chiếu. |
| nestjs | Số cặp node có cạnh | 4536 | 2377 (chung 2300) | lệch | Chỉ graphify: missing (1101): một đầu là node NexGraph không có (dòng node ở trên), nên cặp không thể có; imports (586): graphify thêm cạnh tệp → symbol được import (`from m import f`, `import { AuthService }`); NexGraph ghi IMPORTS mức tệp → tệp (hợp đồng enum ở roadmap) và cặp tệp–tệp đó đã khớp; references (549): tham chiếu kiểu (tham số constructor, DTO, decorator) của 7 ngôn ngữ có trước W2 giữ cách lọc cũ để index mặc định không đổi số node/cạnh (ràng buộc chung của kế hoạch tổng; `index/generic.py` `_LEGACY_LANGUAGES`, `_keep`); ngôn ngữ mức chung thì NexGraph giữ (REFERENCES). Chỉ NexGraph: missing (56): một đầu là node graphify không có (dòng node ở trên); CALLS (21): resolver NexGraph nối lời gọi graphify bỏ sót: hàm top-level Kotlin gọi method lớp khác tệp (W2 Task 4b), lời gọi ở cấp tệp/callback (`describe`), lớp dùng như giá trị (`NestFactory.create(AppModule)`, `imports: [AppModule]`) ghi CALLS INFERRED. |
| nestjs | Tập community (theo tệp) | 88 nhóm | 22 nhóm, trùng hẳn 5, Rand 0.89 trên 269 tệp | lệch | NexGraph gom cụm **theo tệp** (Louvain trên đồ thị tệp IMPORTS+CALLS, chỉ giữ cụm ≥ 2 tệp, seed 42; kế hoạch P3 Task 4, `2026-10-27-nexgraph-p3-search-architecture.md`), graphify gom theo node trên đồ thị khác (thêm node cấu hình, rationale). Spec F10 §4.6 chỉ đòi so tập cụm, không đòi trùng thuật toán. Tệp NexGraph không xếp vào cụm nào được tính là một nhóm một tệp; Rand là tỉ lệ cặp tệp được xếp giống nhau |
| nestjs | Seed của 10 câu `query` |  | 1/10 khớp | lệch | hai bên dùng cùng hàm chọn hạt giống của graphify (`_score_query`, `_pick_seeds`; W3) nhưng trên hai đồ thị khác nhau (node rationale/cấu hình/hằng, nhãn method `.f()` so với `f`), nên IDF và hạt giống khác; dòng "thuật toán" bên dưới chạy graphify trên chính `graph.json` NexGraph để tách hai nguyên nhân |
| nestjs | Seed `query` — thuật toán (graphify chạy trên `graph.json` NexGraph) |  | 10/10 khớp | khớp |  |
| nestjs | `path` có đường (10 cặp: cạnh và chiều ngược) |  | 10/10 khớp | khớp |  |
| nestjs | `graph.json` NexGraph nạp bằng `graphify-mcp` (`graph_stats`) |  | Nodes: 1124, Edges: 2377, Communities: 11 | khớp |  |

**Tổng:** 11 khớp · 12 lệch có lý do · 1 lệch chưa rõ.

## mixed_corpus

Nguồn: `engine/tests/fixtures/mixed_corpus/raw`.

Tệp theo đuôi (graphify/NexGraph): `.py` 3/3.
Node chỉ graphify có (18): rationale: `('analyze.py', "Return True if this node is a file-level hub node (e.g. 'cli")`, `('analyze.py', 'Compare two graph snapshots and return what changed. Returns')`, `('analyze.py', 'Cross-file edges between real code/doc entities, ranked by a')` ….
Node chỉ NexGraph có (0): không.
Cặp chỉ graphify có (19): imports: `(('analyze.py', 'analyze.py'), ('cluster.py', 'cohesion_score'))`; missing: `(('analyze.py', "Return True if this node is a file-level hub node (e.g. 'client', 'models') or…"), ('analyze.py', '_is_file_node'))`, `(('analyze.py', 'Compare two graph snapshots and return what changed. Returns: { "new_nodes":…'), ('analyze.py', 'graph_diff'))`, `(('analyze.py', 'Cross-file edges between real code/doc entities, ranked by a composite surprise…'), ('analyze.py', '_cross_file_surprises'))` ….
Cặp chỉ NexGraph có (1): DEFINES: `(('analyze.py', 'analyze.py'), ('analyze.py', 'edge_key'))`.
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
Cặp chỉ graphify có (2): imports (ngôn ngữ mức chung): `(('cpp/main.cpp', 'main.cpp'), ('cpp/util.h', 'util.h'))`, `(('cpp/util.cpp', 'util.cpp'), ('cpp/util.h', 'util.h'))`.
Cặp chỉ NexGraph có (1): CALLS: `(('kotlin/Main.kt', 'main'), ('kotlin/Util.kt', 'helper'))`.
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

## nestjs

Nguồn: `ecommerce-backend-nestjs`.

Tệp theo đuôi (graphify/NexGraph): `.json` 6/0, `.mjs` 2/2, `.ps1` 1/1, `.sql` 0/11, `.ts` 266/266, `.yml` 2/0.
Node chỉ graphify có (517): concept: `('package.json', '@commitlint/cli')`, `('package.json', '@commitlint/config-conventional')`, `('package.json', '@eslint/eslintrc')` …; config: `('.github/workflows/ci.yml', 'DATABASE_URL')`, `('.github/workflows/ci.yml', 'DIRECT_URL')`, `('.github/workflows/ci.yml', 'NODE_ENV')` …; legacy: `('src/apps/auth/auth.decorator.ts', 'IS_SKIP_AUTH')`, `('src/apps/auth/auth.decorator.ts', 'IS_SKIP_PERMISSION')`, `('src/apps/auth/auth.decorator.ts', 'ROLES_KEY')` …; rationale: `('src/apps/payments/payments.service.ts', 'TODO: Gọi API refund của VNPay')`.
Node chỉ NexGraph có (50): sql: `('NestJS Ecommerce.session.sql', 'NestJS Ecommerce.session.sql')`, `('prisma/migrations/20260529192433_init/migration.sql', '"User"')`, `('prisma/migrations/20260529192433_init/migration.sql', 'User_email_key')` ….
Cặp chỉ graphify có (2236): imports: `(('src/apps/app.controller.ts', 'app.controller.ts'), ('src/apps/app.service.ts', 'AppService'))`, `(('src/apps/app.module.ts', 'AppModule'), ('src/main.ts', 'main.ts'))`, `(('src/apps/auth/auth.controller.ts', 'auth.controller.ts'), ('src/apps/auth/auth.decorator.ts', 'SkipAuth'))` …; references: `(('src/apps/app.controller.ts', 'constructor'), ('src/apps/app.service.ts', 'AppService'))`, `(('src/apps/auth/auth.controller.ts', 'constructor'), ('src/apps/auth/auth.service.ts', 'AuthService'))`, `(('src/apps/auth/auth.controller.ts', 'forgotPassword'), ('src/apps/auth/auth.decorator.ts', 'SkipAuth'))` …; missing: `(('.github/workflows/ci.yml', 'DATABASE_URL'), ('.github/workflows/ci.yml', 'env'))`, `(('.github/workflows/ci.yml', 'DIRECT_URL'), ('.github/workflows/ci.yml', 'env'))`, `(('.github/workflows/ci.yml', 'NODE_ENV'), ('.github/workflows/ci.yml', 'env'))` ….
Cặp chỉ NexGraph có (77): CALLS: `(('src/apps/app.module.ts', 'AppModule'), ('src/main.ts', 'bootstrap'))`, `(('src/apps/app.module.ts', 'AppModule'), ('test/app.e2e-spec.ts', 'app.e2e-spec.ts'))`, `(('src/apps/cart-items/cart-items.service.spec.ts', 'cart-items.service.spec.ts'), ('src/testing/auto-mocking/auto-mocking.module.ts', 'createTestingModule'))` …; missing: `(('prisma/migrations/20260529192433_init/migration.sql', '"User"'), ('prisma/migrations/20260529192433_init/migration.sql', 'migration.sql'))`, `(('prisma/migrations/20260529192433_init/migration.sql', 'User_email_key'), ('prisma/migrations/20260529192433_init/migration.sql', 'migration.sql'))`, `(('prisma/migrations/20260531023807_init/migration.sql', '"Permission"'), ('prisma/migrations/20260531023807_init/migration.sql', '"RolePermission"'))` ….
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
