# Checklist bấm tay: tương đương graphify (spec F10 §3)

Mỗi dòng ứng với một dòng của bảng đối chiếu trong spec F10 §3 (`docs/superpowers/specs/2026-11-13-nexgraph-graphify-parity-design.md` của workspace). Chạy trên app thật, bản build từ mã nguồn hoặc bộ cài. Tích ô **macOS** và **Windows** khi đạt. Không đạt thì ghi hiện tượng, commit và ảnh vào cột Ghi chú.

Phần so sánh tự động nằm ở [graphify-parity.md](graphify-parity.md): số tệp, node, cặp node có cạnh, community, seed `query`, `path`, và `graph.json` nạp bằng `graphify-mcp`. Checklist này chỉ kiểm chỗ bấm và kết quả hiện trên giao diện. Chữ in đậm là nhãn đúng như trên giao diện (`apps/desktop/src/renderer/src/strings.ts`).

**Ghi lần chạy:** người thử · ngày · commit · bản build (mã nguồn / bộ cài + SHA-256) · máy.

**Chuẩn bị**

- Dự án thử:
  - `engine/tests/fixtures/polyglot` (nhiều ngôn ngữ);
  - `engine/tests/fixtures/docs_app` (tài liệu);
  - một kho Git có remote GitHub, đã chạy `gh auth login` (tab Pull request);
  - hai dự án TS nhỏ `engine/tests/fixtures/global_ts_app` và `global_ts_lib` (graph chung).
- Chép fixture ra một thư mục ngoài repo trước khi mở, để thư mục `.nexgraph/` không rơi vào repo. Trên ít nhất một máy, đặt bản chép trong thư mục có khoảng trắng và dấu tiếng Việt, ví dụ `Đồ án/thử nghiệm` (xem mục OS).
- Dùng hồ sơ dữ liệu riêng (`NEXGRAPH_DATA_DIR`) để không lẫn với dữ liệu đang dùng.
- AI: một model đã kết nối trong **Cài đặt AI** (đường A) và một provider tương thích OpenAI, ví dụ Ollama cục bộ (đường B).

Ký hiệu: ☐ chưa thử · ☑ đạt · ☒ không đạt (ghi lý do).

## §3.1 Dựng và cập nhật graph

| # | graphify | Nơi bấm trên NexGraph | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 1.1 | `update` | Trang tổng quan dự án → **Index lại** | Sửa một tệp rồi bấm. Thẻ **Trạng thái graph** cập nhật số tệp · node · cạnh, không báo lỗi. | ☐ | ☐ | |
| 1.2 | `watch` | Không có công tắc: app tự theo dõi khi workspace của dự án đang mở | Mở workspace (bất kỳ tab nào), thêm một hàm mới vào một tệp rồi lưu. Vài giây sau tìm thấy hàm đó ở **Tìm kiếm**. Đóng workspace thì app ngừng theo dõi. | ☐ | ☐ | |
| 1.3 | `extract --code-only/--force/--exclude/--max-workers` | **Tuỳ chọn index** | Nhập một dòng vào **Mẫu bỏ qua**, điền **Số tiến trình**, tick **Index lại từ đầu (bỏ bộ nhớ đệm phân tích cú pháp)**, rồi bấm **Index lại với tuỳ chọn này**. Thư mục bị bỏ qua không còn trong tab **Cây**. | ☐ | ☐ | |
| 1.4 | `.graphifyrc language.*` | Tệp `.graphifyrc` ở gốc dự án | Thêm `language.inc = php` (theo gợi ý trong Tuỳ chọn index) rồi index lại. Tệp `.inc` hiện ngôn ngữ PHP. | ☐ | ☐ | Không có bảng sửa trong app |
| 1.5 | `extract --mode deep` (đường A) | Thẻ **Phân tích ngữ nghĩa bằng AI** → **Bật AI cho dự án** | Trên `docs_app` (đã bật **Gồm tài liệu**): chọn **Dùng tài khoản AI của ứng dụng (model đang chọn trong Cài đặt)**, tick **Tôi đồng ý gửi tài liệu của dự án này tới nhà cung cấp AI đã chọn**. Chọn **Phân tích sâu tài liệu (thêm quan hệ suy luận)**. Màn ước tính hiện **Tệp sẽ gửi** và số token. Bấm **Đồng ý và chạy**: xong có node/cạnh mang nhãn "Suy luận bởi AI". | ☐ | ☐ | |
| 1.6 | trích xuất ngữ nghĩa (đường B) | Như 1.5, chọn **Engine gọi trực tiếp API tương thích OpenAI (Ollama, nhà cung cấp tuỳ chỉnh có API key)** | Chạy mục **Tài liệu (Markdown, Word, PDF, bản chép lời)** với Ollama cục bộ. Kết quả như 1.5. **Huỷ** giữa chừng: job dừng, không ghi dở. Chạy lại lần hai: các khối đã có kết quả không gọi model nữa. | ☐ | ☐ | |
| 1.7 | ảnh, gộp khái niệm | Như 1.5: **Ảnh (cần model đọc được ảnh)**; **Gộp khái niệm trùng (chạy trên máy, không gọi AI)** | Ảnh chỉ chạy với model đọc được ảnh. Gộp trùng xong báo số khái niệm đã gộp. | ☐ | ☐ | |
| 1.8 | `cluster-only` | **Gom cụm lại** | Bấm. Thẻ Kiến trúc vẽ lại cụm, không index lại. | ☐ | ☐ | |
| 1.9 | `label` | **Đặt tên cụm bằng AI** | AI tắt: tên cụm vẫn sinh theo node trung tâm. AI bật: chỉ gửi tên node, không gửi mã. Tên mới hiện ở Kiến trúc và vẫn giữ sau khi index lại. | ☐ | ☐ | |
| 1.10 | `hook install/uninstall/status` | Thẻ **Tự cập nhật theo Git** → **Bật** / **Tắt** | Xem trước khối hook, bấm **Bật**, rồi commit một thay đổi. Graph tự cập nhật và `<data_dir>/logs/refresh.log` có dòng mới. Bấm **Tắt**: khối hook biến mất, phần hook sẵn có còn nguyên. | ☐ | ☐ | Windows: xem mục OS |
| 1.11 | `check-update` | Huy hiệu **Graph cũ hơn mã nguồn** | Đóng workspace (ngừng theo dõi), sửa một tệp bằng trình soạn thảo khác, rồi mở lại trang tổng quan: huy hiệu hiện. Index lại: huy hiệu tắt. | ☐ | ☐ | |
| 1.12 | `--postgres`, `--cargo`, SCIP, MCP ingest, manifest | **Tuỳ chọn index** → **Nguồn bổ sung (nâng cao)** | Bật **Cargo workspace (crate và phụ thuộc giữa các crate)** trên một workspace Rust và **Thêm tệp SCIP…** (JSON). Mỗi nguồn hiện thành một tệp ảo `nguon://…`. Máy chưa có `psycopg` thì ô PostgreSQL bị khoá kèm dòng **Cần cài psycopg vào môi trường engine (bản cài chưa gồm)**. | ☐ | ☐ | |

*Bảng 1. Checklist §3.1 Dựng và cập nhật graph*

## §3.2 Nguồn dữ liệu ngoài thư mục

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 2.1 | `clone <github-url>` | Màn **Dự án** → **Mở từ URL…** | Dán URL `https://github.com/…` của một kho nhỏ rồi bấm **Tải về và mở**. Có tiến độ và nút **Hủy**. Kho được mở và index như thư mục thường. URL `http://` hoặc host khác GitHub/GitLab bị từ chối. | ☐ | ☐ | |
| 2.2 | `add <url>` | Trang tổng quan → khung **Nguồn từ URL** → **Thêm** | Thêm một trang web và một PDF. Nội dung hiện trong đồ thị dưới `sources/`, thư mục dự án không có tệp mới. URL trỏ tới IP nội bộ bị từ chối. | ☐ | ☐ | |
| 2.3 | Google Workspace | **Tuỳ chọn index** → **Gồm tài liệu (Markdown, txt, Word, Excel, PDF)** (cần `gws`) | Có lối tắt `.gdoc` và có `gws`: nội dung lối tắt hiện trong đồ thị. Không có `gws`: lối tắt bị bỏ qua, không báo lỗi. | ☐ | ☐ | |
| 2.4 | Tài liệu md/docx/xlsx/PDF/html/yaml | **Gồm tài liệu (…)**, **Tệp cấu hình (package.json, tsconfig, YAML, pyproject.toml, cấu hình MCP)** | Index `docs_app`. Mỗi heading thành một node tài liệu. Inspector → **Đọc mục** hiện đúng đoạn. | ☐ | ☐ | |
| 2.5 | Audio/video | **Gồm audio/video (chép lời trên máy, cần faster-whisper; lần đầu tải model)** | Máy có `faster-whisper`: bản chép lời hiện thành tài liệu. Bản cài (không có faster-whisper): ô bị khoá kèm dòng **Cần faster-whisper: chạy engine từ mã nguồn với extra media (bản cài chưa gồm)**. | ☐ | ☐ | |

*Bảng 2. Checklist §3.2 Nguồn dữ liệu ngoài thư mục*

## §3.3 Xem và truy vấn

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 3.1 | `graph.html` | Tab **Graph** | Mở được. Dự án lớn (trên 2.000 node) được gộp, app không treo. | ☐ | ☐ | |
| 3.2 | `tree` | Tab **Cây** | Thư mục → tệp → lớp → hàm, **Mở**/**Thu gọn** được. **Mở mã** mở đúng dòng. | ☐ | ☐ | |
| 3.3 | `GRAPH_REPORT.md` | Tab **Báo cáo** | Có node trung tâm, cộng đồng, kết nối bất ngờ, câu hỏi gợi ý, vòng import, **Độ mới của graph**, **Lỗ hổng tri thức**, **Mức giảm token**. Bấm một câu hỏi gợi ý thì chạy Hỏi graph. | ☐ | ☐ | |
| 3.4 | `query` | **Tìm kiếm** → chế độ **Hỏi graph** | Hỏi "main calls helper" trên `polyglot`: có **Điểm bắt đầu** và **Xem trên graph**. Hỏi "helper": hiện **Câu hỏi trùng với … node cùng tên ở các tệp khác nhau. Chọn một node:**, không chọn bừa. | ☐ | ☐ | |
| 3.5 | `explain` | Inspector → **Giải thích** | Hiện số liên kết, cụm và láng giềng nhóm theo loại cạnh; phần vượt gom theo tệp. | ☐ | ☐ | |
| 3.6 | `path` | Chuột phải node → **Tìm đường tới…** | `main` → `helper` cùng ngôn ngữ: **Đường đi 1 bước · tin cậy: …**, đường được tô. Chiều ngược: **Không tìm thấy liên kết trực tiếp trong graph**. | ☐ | ☐ | |
| 3.7 | `affected` | Chuột phải node → **Vùng ảnh hưởng nếu sửa** | Khung **Ảnh hưởng nếu sửa …** liệt kê và tô các node phụ thuộc, kèm **Test liên quan** nếu có. | ☐ | ☐ | |
| 3.8 | `god-nodes`, `benchmark` | Tab Báo cáo | Node trung tâm không chứa test. Dòng **Mức giảm token** có số lần giảm. | ☐ | ☐ | |
| 3.9 | `section` / `get_section` | Inspector node tài liệu → **Đọc mục** | Mục có dòng `api_key = "sk-…"` hiện bản đã che. | ☐ | ☐ | |
| 3.10 | Tìm kiếm | **Tìm kiếm** → **Tìm symbol** | Gõ tên hàm: kết quả mở đúng `tệp:dòng` trong trình soạn thảo. | ☐ | ☐ | |

*Bảng 3. Checklist §3.3 Xem và truy vấn*

## §3.4 Export

Mở hộp thoại **Xuất…**, lần lượt chọn **Phạm vi**: **Toàn bộ dự án**, **Quanh node đang chọn**, **Cộng đồng …**. Thư mục đích mặc định không phải thư mục dự án. Bấm **Chọn thư mục và xuất**.

| # | graphify | Định dạng | Kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 4.1 | `export html` | HTML | Mở bằng trình duyệt, tương tác được. | ☐ | ☐ | |
| 4.2 | `export callflow-html` | **HTML luồng gọi** | Mở bằng trình duyệt thấy "sơ đồ luồng gọi hàm theo kiến trúc": các khối kiến trúc và lời gọi giữa chúng (Mermaid). | ☐ | ☐ | |
| 4.3 | `export obsidian` | Obsidian | Mở vault bằng Obsidian, có `graph.canvas`. | ☐ | ☐ | |
| 4.4 | `export wiki` | Wiki | Mỗi cộng đồng một bài Markdown. | ☐ | ☐ | |
| 4.5 | `export svg` | SVG | Mở được. | ☐ | ☐ | |
| 4.6 | `export graphml` | GraphML | Mở được bằng yEd hoặc Gephi. | ☐ | ☐ | |
| 4.7 | `export neo4j/falkordb` | **Cypher**; **Đẩy lên Neo4j** | Tệp Cypher nạp được. Đẩy lên Neo4j cục bộ với mật khẩu: số node khớp. URI `http://` bị từ chối. | ☐ | ☐ | |
| 4.8 | `graph.json` | JSON | `graphify-mcp <tệp>` nạp được (script so sánh đã kiểm tự động). | ☐ | ☐ | |
| 4.9 | (F9) | **Ảnh PNG vùng đang xem**, **Báo cáo Markdown** | Mở được. | ☐ | ☐ | |

*Bảng 4. Checklist §3.4 Export*

## §3.5 MCP và tích hợp trợ lý AI

Số tool trên nhánh `int/dot-2` (`bc9b073`, `engine/tests/test_mcp.py`):

- `nexgraph-engine mcp --project …` có **25 tool**. 24 tool chỉ đọc (`readOnlyHint`); riêng `remember` ghi vào CSDL NexGraph.
  - `search`, `get_node`, `get_neighbors`, `get_architecture`, `get_evidence`, `get_impact`, `read_code`;
  - `query_graph`, `shortest_path`, `god_nodes`, `graph_stats`, `get_community`;
  - `list_flows`, `trace_flow`, `get_context`;
  - `get_section`, `get_callers`, `tests_for`, `find`;
  - `remember`, `recall`;
  - `list_prs`, `get_pr_impact`, `triage_prs`, `review_status`.
- Thêm `--global` thì có **26 tool**: thêm `list_repositories`, và `query_graph` nhận thêm tham số `repository` và trả `cross_repo`.
- Có **6 resource**.

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 5.1 | `graphify-mcp` stdio | Thẻ **Trợ lý AI qua MCP** → **Sao chép cấu hình MCP** | Dán cấu hình vào Claude Code. `tools/list` ra đúng 25 tool như trên. `resources/list` ra 6 resource `nexgraph://…`. | ☐ | ☐ | |
| 5.2 | Kiểm chỉ đọc | MCP | Trong `tools/list`, mọi tool có `readOnlyHint: true`, trừ `remember`. Gọi `remember` chỉ ghi vào CSDL `.nexgraph/`, không đổi tệp dự án. | ☐ | ☐ | |
| 5.3 | `query_graph`, `get_community`, `god_nodes`, `graph_stats`, `shortest_path` | MCP | Gọi từng tool trên `polyglot`. `shortest_path` `main → helper` có đường. Kết quả dài báo bị cắt. | ☐ | ☐ | |
| 5.4 | `get_section`, `get_callers`, `tests_for`, `find` | MCP | Gọi được. `get_section` trả bản đã che secret. | ☐ | ☐ | |
| 5.5 | `global` + MCP chung | `nexgraph-engine mcp --global --data-dir <D>` | Với graph chung ở 6.1: `tools/list` ra 26 tool. `list_repositories` ra hai dự án. `query_graph` với `repository` trả `cross_repo`. Thiếu `--data-dir` thì báo lỗi rõ ràng. | ☐ | ☐ | |
| 5.6 | HTTP có API key | Công tắc **MCP qua HTTP** | Bật. Có **Hiện key** / **Sao chép key**. Chỉ nghe `127.0.0.1`. Gọi không có key: bị từ chối. | ☐ | ☐ | |
| 5.7 | Tool PR (`list_prs`, `get_pr_impact`, `triage_prs`, `review_status`) | MCP | Trên kho có `gh`: trả danh sách PR và review. Không có `gh`: báo lỗi rõ ràng. | ☐ | ☐ | |
| 5.8 | `install --platform` (21 nền tảng), `uninstall` | Thẻ **Tích hợp trợ lý AI** | Chọn Claude Code, Cursor, Codex. Xem **Tệp sẽ ghi**, bấm **Ghi các tệp này**, rồi Gỡ: dự án trở về như cũ (chỉ còn tệp `{}` nếu có). Nút **Sao chép cấu hình** dùng được. | ☐ | ☐ | |
| 5.9 | `hook-guard` | Tích hợp trợ lý AI → phần **Hook nhắc dùng graph** | Trong Claude Code, đọc tệp trước khi hỏi graph: thấy lời nhắc. Tick **Chặn lần đọc tệp đầu tiên mỗi phiên khi trợ lý chưa hỏi graph (chế độ nghiêm)**: chặn đúng một lần mỗi phiên. | ☐ | ☐ | |

*Bảng 5. Checklist §3.5 MCP và tích hợp trợ lý AI*

## §3.6 Nhiều repo

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 6.1 | `global add/remove/list` | Màn **Dự án** → nút **Thêm … vào graph chung** cạnh dự án gần đây; nhóm **Graph chung** | Thêm `global_ts_app` và `global_ts_lib`, rồi **Gỡ … khỏi graph chung** một dự án. **Tìm trong graph chung** trả kết quả từ cả hai. | ☐ | ☐ | |
| 6.2 | `merge-graphs` | Chọn hai dự án → **Xem chung** | Đồ thị gộp **Chỉ đọc**, hiện **… cạnh liên repo** giữa app và lib. **Xuất graph.json gộp** được. | ☐ | ☐ | |

*Bảng 6. Checklist §3.6 Nhiều repo*

## §3.7 Bộ nhớ làm việc và Pull request

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 7.1 | `save-result` | Dưới câu trả lời của trợ lý AI: **Hữu ích** / **Ngõ cụt** / **Đã sửa** | Đánh giá ba câu trả lời. Mở lại app, các đánh giá vẫn còn. | ☐ | ☐ | |
| 7.2 | `reflect` | Tab Báo cáo → **Bài học** | Hiện nguồn tin cậy và **Ngõ cụt đã biết** từ các đánh giá ở 7.1. | ☐ | ☐ | |
| 7.3 | `prs` | Tab **Pull request** | Có remote GitHub và `gh` đã đăng nhập: bảng **Pull request đang mở** có trạng thái, CI, **Nút bị ảnh hưởng**, khung **PR có thể xung đột**. Không có `gh`: tab ẩn hoặc báo rõ. | ☐ | ☐ | |
| 7.4 | `prs` triage bằng LLM | Tab Pull request → **Xếp hạng bằng AI** | AI của dự án bật: hộp đồng ý **Tôi đồng ý gửi tiêu đề, trạng thái và tác giả của các pull request đang mở (không gửi mã nguồn)…**. Chạy xong có danh sách `#n · ưu tiên …`. AI của dự án đang tắt: hộp thoại hiện phần bật AI và đồng ý trước, chưa gửi gì. | ☐ | ☐ | |

*Bảng 7. Checklist §3.7 Bộ nhớ làm việc và Pull request*

## §3.8 Dòng bổ sung sau rà soát 2026-11-20

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 8.1 | ~40 họ ngôn ngữ | Index `polyglot` | Trang tổng quan có dòng **Ngôn ngữ ở mức chung (…)**. Lời gọi `main → helper` có ở cả 8 ngôn ngữ. `cpp/main.cpp` có cạnh IMPORTS tới `cpp/util.h`. | ☐ | ☐ | Rust `use crate::…` chưa thành cạnh tệp (Ruling "không sửa") |
| 8.2 | Bản vendor 0.9.112 | `THIRD_PARTY_LICENSES.md` / thông tin bản cài | Ghi đúng 0.9.112. | ☐ | ☐ | |
| 8.3 | Resource MCP `report`, `stats`, `god-nodes`, `surprises`, `audit`, `questions` | MCP `resources/read` | Đọc được cả 6 resource. | ☐ | ☐ | |
| 8.4 | Chấm điểm `query` | Hỏi graph | Như 3.4. | ☐ | ☐ | |
| 8.5 | Import Cycles, Freshness, Knowledge Gaps | Tab Báo cáo | Như 3.3. | ☐ | ☐ | |
| 8.6 | Che secret | **Đọc mục**, nguồn từ URL | Secret trong tài liệu hoặc trang tải về hiện bản đã che. | ☐ | ☐ | |

*Bảng 8. Checklist §3.8 Dòng bổ sung*

## §3.9 Bản cục bộ của tính năng cloud

| # | Cloud | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 9.1 | PR review có ngữ cảnh graph | Tab Pull request → **Xem review của PR #n** | Khung **Review cục bộ: PR #n** có:<br>- **Vùng ảnh hưởng (… nút)**;<br>- **Symbol đổi chưa có test**;<br>- **Tài liệu có thể đã cũ**;<br>- **Code có thể không còn ai gọi (heuristic)**;<br>- **Tác động sang repo khác** khi dự án ở trong graph chung.<br>**Sao chép nhận xét** dùng được, NexGraph không đăng gì lên GitHub. | ☐ | ☐ | |
| 9.2 | Test impact | Review PR → **Test nên chạy** | Có danh sách test và lệnh chạy gợi ý. PR thêm tệp mới thì hiện **Chưa chắc chắn, nên chạy toàn bộ test:**. | ☐ | ☐ | |
| 9.3 | Memory `remember`/`recall` | Inspector → **Ghi nhớ** → **Thêm ghi nhớ**; MCP `remember`, `recall` | Ghi một Bài học neo vào node qua MCP: ghi nhớ đó hiện trong Inspector của node. Thêm trùng: **Đã có ghi nhớ này.** | ☐ | ☐ | |
| 9.4 | `graphify_callers`, `tests_for`, `find`, `trace` | MCP | Như 5.4 và `trace_flow`. | ☐ | ☐ | |

*Bảng 9. Checklist §3.9 Bản cục bộ của tính năng cloud*

## Bước riêng theo hệ điều hành

| # | Việc | macOS | Windows | Ghi chú |
|---|---|---|---|---|
| O.1 | Lưu API key ở **Cài đặt AI** → **API key nhà cung cấp**, rồi khởi động lại app: key còn dùng được, không hiện lại. Tệp bí mật trong thư mục dữ liệu không chứa key dạng chữ thường (grep thử). | ☐ Kho khoá: Keychain Access có mục "… Safe Storage" của app | ☐ Mã hoá bằng DPAPI của tài khoản Windows (không nằm trong Credential Manager); sang tài khoản khác thì không giải mã được | Máy không có kho khoá: hiện **Kho khoá an toàn của hệ điều hành không khả dụng…** |
| O.2 | Git hook (1.10) | ☐ Commit bằng Terminal | ☐ Commit bằng Git Bash **và** bằng GitHub Desktop/VS Code; `refresh.log` có dòng cho cả hai. Ghi lại nếu commit bị chờ hoặc bật cửa sổ console | Đường dẫn engine có khoảng trắng |
| O.3 | Dự án ở đường dẫn có khoảng trắng và dấu tiếng Việt (`Đồ án/thử nghiệm`): mở, index, **Đọc mục**, Xuất, git hook, MCP stdio | ☐ | ☐ | |
| O.4 | Bộ cài chưa ký số mở được theo hướng dẫn ở `docs/release/README.md` | ☐ Gatekeeper | ☐ SmartScreen | |

*Bảng 10. Bước kiểm riêng theo hệ điều hành*

## Kịch bản demo và hiệu năng (spec gốc §6.1)

| # | Việc | Kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|
| D.1 | Kịch bản demo 5 phút | Chạy trọn vẹn, không chậm hơn trước W1. | ☐ | ☐ | |
| D.2 | Index dự án NestJS mẫu (khoảng 270 tệp) | Thời gian không vượt ngưỡng spec §6.1. Ghi số giây. | ☐ | ☐ | |

*Bảng 11. Kịch bản demo và hiệu năng*
