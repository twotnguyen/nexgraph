# Đối chiếu NexGraph với graphify

Sinh bởi `scripts/parity/compare_graphify.py` của workspace (không nằm trong repo); chạy lại cho cùng nội dung. Công cụ so: graphify 0.9.120 (`graphify extract --code-only`, `GRAPHIFY_BACKEND=none`, môi trường không có khoá API) và NexGraph engine (đường lập chỉ mục mặc định của app: pipeline vendor rồi nạp vào `graph.db`; `graph.json` xuất qua cầu nối như nút Xuất JSON). Không gọi LLM, không gọi mạng. Node so theo khoá (tệp, tên đã bỏ `.` đầu và `()` cuối) vì spec F10 §4.6 không đòi khớp id; cạnh so theo cặp node vô hướng, không theo số cạnh tuyệt đối. Lệch "chưa rõ" là lệch chưa có lý do đã chốt, cần controller xem.

| Corpus | Mục | graphify | NexGraph | Kết quả | Lý do |
|---|---|---|---|---|---|
| mixed_corpus | Số tệp theo ngôn ngữ | 3 | 3 | khớp |  |
| mixed_corpus | Số node có tệp (khoá tệp + tên) | 41 (+6 không tệp) | 41 | khớp |  |
| mixed_corpus | Node không tệp và cạnh tới chúng | 6 node, 25 cạnh | 6 node, 25 cạnh | khớp |  |
| mixed_corpus | Số cặp node có cạnh | 59 | 59 (chung 59) | khớp |  |
| mixed_corpus | Tập community (theo tệp) | 3 nhóm | 3 nhóm, trùng hẳn 3, Rand 1.00 trên 3 tệp | khớp |  |
| mixed_corpus | Seed của 10 câu `query` |  | 9/10 khớp | lệch | Do đồ thị, không do thuật toán (dòng dưới khớp 10/10). Hạt giống lệch theo nhóm: state (1): id node khác: graphify cộng điểm cho node tệp có id trùng từ hỏi (`build`), nên có hai node sát điểm và báo tên mơ hồ; NexGraph không có id đó nên chọn được một node. |
| mixed_corpus | Seed `query` — thuật toán (graphify chạy trên `graph.json` NexGraph) |  | 10/10 khớp | khớp |  |
| mixed_corpus | `path` có đường (10 cặp: cạnh và chiều ngược) |  | 5/10 khớp | lệch | tìm đường NexGraph chỉ đi qua cạnh thật (`PATH_TYPES`, bỏ DEFINES/CONTAINS, spec gốc §5.8) và tối đa 4 hop; graphify đi qua cả cạnh `contains` (ngược chiều, ví dụ `f() <--contains-- tệp --contains--> g()`) |
| mixed_corpus | `graph.json` NexGraph nạp bằng `graphify-mcp` (`graph_stats`) |  | Nodes: 47, Edges: 84, Communities: 10 | khớp |  |
| polyglot | Số tệp theo ngôn ngữ | 17 | 17 | khớp |  |
| polyglot | Số node có tệp (khoá tệp + tên) | 39 (+3 không tệp) | 39 | khớp |  |
| polyglot | Node không tệp và cạnh tới chúng | 3 node, 3 cạnh | 3 node, 3 cạnh | khớp |  |
| polyglot | Số cặp node có cạnh | 31 | 31 (chung 31) | khớp |  |
| polyglot | Tập community (theo tệp) | 9 nhóm | 9 nhóm, trùng hẳn 9, Rand 1.00 trên 17 tệp | khớp |  |
| polyglot | Seed của 10 câu `query` |  | 8/10 khớp | lệch | Do đồ thị, không do thuật toán (dòng dưới khớp 10/10). Hạt giống lệch theo nhóm: score (4): id node khác: graphify đặt id node tệp theo tên (`build`), NexGraph đặt id riêng (`build.py#file`); `query` của graphify cộng điểm khi từ hỏi trùng id và xếp các node bằng điểm theo thứ tự trong đồ thị. Đổi id NexGraph sang id graphify thì kết quả trùng. |
| polyglot | Seed `query` — thuật toán (graphify chạy trên `graph.json` NexGraph) |  | 10/10 khớp | khớp |  |
| polyglot | `path` có đường (10 cặp: cạnh và chiều ngược) |  | 10/10 khớp | khớp |  |
| polyglot | `graph.json` NexGraph nạp bằng `graphify-mcp` (`graph_stats`) |  | Nodes: 42, Edges: 34, Communities: 9 | khớp |  |
| dự án NestJS mẫu | Số tệp theo ngôn ngữ | 286 | 286 | khớp |  |
| dự án NestJS mẫu | Số node có tệp (khoá tệp + tên) | 1614 (+392 không tệp) | 1614 | khớp |  |
| dự án NestJS mẫu | Node không tệp và cạnh tới chúng | 392 node, 597 cạnh | 392 node, 597 cạnh | khớp |  |
| dự án NestJS mẫu | Số cặp node có cạnh | 4619 | 4619 (chung 4619) | khớp |  |
| dự án NestJS mẫu | Tập community (theo tệp) | 96 nhóm | 103 nhóm, trùng hẳn 41, Rand 0.98 trên 286 tệp | lệch | NexGraph giữ nguyên cụm của bước `cluster-only` của vendor (so theo id, không cụm nào bị tách). Engine không cài extra `leiden` của graphify (`graspologic`) nên vendor dùng Louvain của networkx như graphify cài mặc định; graphify dùng để so cài `[all]` nên chạy Leiden. Gọi `graphify.cluster.cluster` trên cùng đồ thị NestJS: có `graspologic` 135 cụm, chặn `graspologic` 145 cụm, đúng bằng NexGraph |
| dự án NestJS mẫu | Seed của 10 câu `query` |  | 9/10 khớp | lệch | Do đồ thị, không do thuật toán (dòng dưới khớp 10/10). Hạt giống lệch theo nhóm: score (2): id node khác: graphify đặt id node tệp theo tên (`build`), NexGraph đặt id riêng (`build.py#file`); `query` của graphify cộng điểm khi từ hỏi trùng id và xếp các node bằng điểm theo thứ tự trong đồ thị. Đổi id NexGraph sang id graphify thì kết quả trùng. |
| dự án NestJS mẫu | Seed `query` — thuật toán (graphify chạy trên `graph.json` NexGraph) |  | 10/10 khớp | khớp |  |
| dự án NestJS mẫu | `path` có đường (10 cặp: cạnh và chiều ngược) |  | 10/10 khớp | khớp |  |
| dự án NestJS mẫu | `graph.json` NexGraph nạp bằng `graphify-mcp` (`graph_stats`) |  | Nodes: 2032, Edges: 5226, Communities: 145 | khớp |  |

*Bảng 1. Kết quả đối chiếu NexGraph với graphify theo corpus*

**Tổng:** 22 khớp · 5 lệch có lý do · 0 lệch chưa rõ.

## mixed_corpus

Nguồn: `engine/tests/fixtures/mixed_corpus/raw`.

Tệp theo đuôi (graphify/NexGraph): `.py` 3/3.
Node chỉ graphify có (0): không.
Node chỉ NexGraph có (0): không.
Node không tệp của graphify (6): `Graph (code)`, `networkx (concept)`, `sys (concept)`, `validate (concept)`.
Cặp chỉ graphify có (0): không.
Cặp chỉ NexGraph có (0): không.
Nhóm tệp lệch (dấu `57284d2451`; tệp NexGraph không vào cụm nào tính là nhóm một tệp): chỉ graphify không; chỉ NexGraph không.
- query `how does cluster split a community`: graphify [_cross_community_surprises, _split_community, cluster] · NexGraph [_cross_community_surprises, _split_community, cluster] · graphify trên graph NexGraph [_cross_community_surprises, _split_community, cluster]
- query `god nodes`: graphify [god_nodes] · NexGraph [god_nodes] · graphify trên graph NexGraph [god_nodes]
- query `surprising connections`: graphify [surprising_connections] · NexGraph [surprising_connections] · graphify trên graph NexGraph [surprising_connections]
- query `build graph from json`: graphify [Graph, build, build_from_json, build_graph] · NexGraph [Graph, build, build_from_json, build_graph] · graphify trên graph NexGraph [Graph, build, build_from_json, build_graph]
- query `cohesion score`: graphify [cohesion_score, score_all] · NexGraph [cohesion_score, score_all] · graphify trên graph NexGraph [cohesion_score, score_all]
- query `suggest questions`: graphify [suggest_questions] · NexGraph [suggest_questions] · graphify trên graph NexGraph [suggest_questions]
- query `graph diff`: graphify [Graph, graph_diff] · NexGraph [Graph, graph_diff] · graphify trên graph NexGraph [Graph, graph_diff]
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
Cặp chỉ NexGraph có (0): không.
Nhóm tệp lệch (dấu `57284d2451`; tệp NexGraph không vào cụm nào tính là nhóm một tệp): chỉ graphify không; chỉ NexGraph không.
- query `main calls helper`: graphify [Main, helper, main] · NexGraph [Main, helper, main] · graphify trên graph NexGraph [Main, helper, main]
- query `java Main`: graphify [Main, Main.java, main] · NexGraph [Main, Main.java, main] · graphify trên graph NexGraph [Main, Main.java, main]
- query `rust helper`: graphify [helper, helper, main] · NexGraph [helper, helper, main] · graphify trên graph NexGraph [helper, helper, main]
- query `Util helper`: graphify [Util, helper, helper] · NexGraph [Util, helper, helper] · graphify trên graph NexGraph [Util, helper, helper]
- query `kotlin main`: graphify [Main, Util, main] · NexGraph [Main, Util, main] · graphify trên graph NexGraph [Main, Util, main]
- query `swift run`: graphify [main.swift, run] · NexGraph [Util.swift, run] · graphify trên graph NexGraph [Util.swift, run]
- query `php run`: graphify [main.php, run] · NexGraph [Util.php, run] · graphify trên graph NexGraph [Util.php, run]
- query `ruby Util`: graphify [Util] · NexGraph [Util] · graphify trên graph NexGraph [Util]
- query `go Helper`: graphify [helper, helper, helper] · NexGraph [helper, helper, helper] · graphify trên graph NexGraph [helper, helper, helper]
- query `cpp main`: graphify [Main, main, main.cpp] · NexGraph [Main, main, main.cpp] · graphify trên graph NexGraph [Main, main, main.cpp]
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

graphify quét 288 tệp (`manifest.json`), 286 tệp có node hoặc cạnh; bảng đếm tệp có node hoặc cạnh ở cả hai bên.
Tệp theo đuôi (graphify/NexGraph): `.json` 4/4, `.mjs` 2/2, `.ps1` 1/1, `.sql` 11/11, `.ts` 266/266, `.yml` 2/2.
Node chỉ graphify có (0): không.
Node chỉ NexGraph có (0): không.
Node không tệp của graphify (392): `Body (code)`, `Catch (code)`, `Controller (code)`, `Cron (code)`, `Delete (code)`, `Get (code)`, `Global (code)`, `HealthCheck (code)` ….
Cặp chỉ graphify có (0): không.
Cặp chỉ NexGraph có (0): không.
Nhóm tệp lệch (dấu `1dcfdc0e30`; tệp NexGraph không vào cụm nào tính là nhóm một tệp): chỉ graphify `['src/apps/app.module.ts', 'src/common/helpers/swagger.helper.ts', 'src/common/middleware/common.middleware.ts', 'src/init.ts', 'src/main.ts']`, `['src/apps/auth/auth.controller.ts']`, `['src/apps/auth/auth.decorator.ts', 'src/apps/order-items/order-items.controller.ts', 'src/apps/orders/dto/update-order.dto.ts', 'src/apps/orders/orders.controller.ts', 'src/apps/product-images/dto/create-product-images.dto.ts', 'src/apps/product-variants/consts/vendor-product-variant.const.ts', 'src/apps/products/consts/product.const.ts', 'src/apps/user-vendor-roles/const/vendor-member.const.ts', 'src/apps/user-vendor-roles/dto/add-members.dto.ts', 'src/apps/users/user-profile.controller.ts', 'src/common/decorators/user.decorator.ts', 'src/common/interceptors/excel-response/excel-response.interceptor.spec.ts', 'src/common/interceptors/excel-response/excel-response.interceptor.ts', 'src/common/pipes/parse-params-pagination.pipe.spec.ts', 'src/common/pipes/parse-params-pagination.pipe.ts', 'src/common/query/options.interface.ts', 'src/common/utils/excel-util/dto/excel-util.interface.ts']` …; chỉ NexGraph `['src/apps/app.module.ts', 'src/apps/carts/carts.module.ts', 'src/common/interceptors/excel-response/excel-response.interceptor.ts', 'src/common/prisma/prisma.module.ts', 'src/common/utils/date-util/date-util.module.ts', 'src/common/utils/date-util/date-util.service.spec.ts', 'src/common/utils/date-util/date-util.service.ts', 'src/common/utils/string-util/string-util.module.ts']`, `['src/apps/auth/auth.controller.ts', 'src/apps/auth/dto/password.dto.ts']`, `['src/apps/auth/auth.decorator.ts', 'src/apps/orders/dto/update-order.dto.ts', 'src/apps/orders/orders.controller.ts', 'src/common/decorators/user.decorator.ts']` ….
- query `sign in`: graphify [SignInDto, SignUpDto, sign.dto.ts] · NexGraph [SignInDto, SignUpDto, sign.dto.ts] · graphify trên graph NexGraph [SignInDto, SignUpDto, sign.dto.ts]
- query `auth service`: graphify [Auth, auth.service.ts, services] · NexGraph [Auth, auth.service.ts, services] · graphify trên graph NexGraph [Auth, auth.service.ts, services]
- query `create product`: graphify [CREATE, Product, create-product-images.dto.ts, create-product-variant.dto.ts, create-product.dto.ts] · NexGraph [CREATE, Product, create-product-images.dto.ts, create-product-variant.dto.ts, create-product.dto.ts] · graphify trên graph NexGraph [CREATE, Product, create-product-images.dto.ts, create-product-variant.dto.ts, create-product.dto.ts]
- query `cart items`: graphify [Cart, OrderItemsService, cart-items.controller.ts, cart-items.module.ts, cart-items.service.ts] · NexGraph [Cart, OrderItemsService, cart-items.controller.ts, cart-items.module.ts, cart-items.service.ts] · graphify trên graph NexGraph [Cart, OrderItemsService, cart-items.controller.ts, cart-items.module.ts, cart-items.service.ts]
- query `payments`: graphify [PaymentsController, PaymentsModule, PaymentsService, payments.service.ts] · NexGraph [PaymentsModule, PaymentsService, payments.module.ts, payments.service.ts] · graphify trên graph NexGraph [PaymentsModule, PaymentsService, payments.module.ts, payments.service.ts]
- query `role permissions`: graphify [Role, permissions.service.ts, role-permissions.controller.ts, role-permissions.module.ts, role-permissions.service.ts] · NexGraph [Role, permissions.service.ts, role-permissions.controller.ts, role-permissions.module.ts, role-permissions.service.ts] · graphify trên graph NexGraph [Role, permissions.service.ts, role-permissions.controller.ts, role-permissions.module.ts, role-permissions.service.ts]
- query `prisma service`: graphify [prisma, prisma.service.ts, services] · NexGraph [prisma, prisma.service.ts, services] · graphify trên graph NexGraph [prisma, prisma.service.ts, services]
- query `jwt guard`: graphify [JWTEnvs, JWTToken, JWT_SECRET, access-control.guard.ts, jwt.const.ts] · NexGraph [JWTEnvs, JWTToken, JWT_SECRET, access-control.guard.ts, jwt.const.ts] · graphify trên graph NexGraph [JWTEnvs, JWTToken, JWT_SECRET, access-control.guard.ts, jwt.const.ts]
- query `vendors controller`: graphify [Controller, vendors.controller.ts, vendors.service.ts] · NexGraph [Controller, vendors.controller.ts, vendors.service.ts] · graphify trên graph NexGraph [Controller, vendors.controller.ts, vendors.service.ts]
- query `promotion`: graphify [Promotion] · NexGraph [Promotion] · graphify trên graph NexGraph [Promotion]
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

Chạy ngày 2026-11-28 trên NexGraph `e048463`.
