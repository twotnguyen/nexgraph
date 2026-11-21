# Checklist bấm tay: tương đương graphify (spec F10 §3)

Mỗi dòng ứng với một dòng của bảng đối chiếu trong spec F10 §3 (`docs/superpowers/specs/2026-11-13-nexgraph-graphify-parity-design.md` của workspace). Chạy trên app thật, bản build từ mã nguồn hoặc bộ cài. Tích ô **macOS** và **Windows** khi đạt. Không đạt thì ghi hiện tượng, commit và ảnh vào cột Ghi chú. Phần so sánh tự động (số tệp, cặp node có cạnh, community, seed `query`, `path`, `graph.json` nạp bằng `graphify-mcp`) nằm ở [graphify-parity.md](graphify-parity.md). Checklist này chỉ kiểm chỗ bấm và kết quả hiện trên giao diện.

**Ghi lần chạy:** người thử · ngày · commit · bản build (mã nguồn / bộ cài + SHA-256) · máy.

**Chuẩn bị**

- Dự án thử:
  - `engine/tests/fixtures/polyglot` (nhiều ngôn ngữ);
  - `engine/tests/fixtures/docs_app` (tài liệu);
  - một kho Git có remote GitHub, có `gh auth login` (tab Pull request);
  - hai dự án TS nhỏ `engine/tests/fixtures/global_ts_app` và `global_ts_lib` (graph chung).
- Chép fixture ra một thư mục ngoài repo trước khi mở, để thư mục `.nexgraph/` không rơi vào repo.
- Dùng hồ sơ dữ liệu riêng (`NEXGRAPH_DATA_DIR`) để không lẫn với dữ liệu đang dùng.
- AI: một tài khoản AI đã kết nối trong Cài đặt (đường A), và một endpoint tương thích OpenAI, ví dụ Ollama cục bộ (đường B).

Ký hiệu: ☐ chưa thử · ☑ đạt · ☒ không đạt (ghi lý do).

## §3.1 Dựng và cập nhật graph

| # | graphify | Nơi bấm trên NexGraph | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 1.1 | `update` | Trang tổng quan dự án → **Index lại** | Sửa một tệp rồi bấm. Số node/cạnh ở thẻ trạng thái cập nhật, không báo lỗi. | ☐ | ☐ | |
| 1.2 | `watch` | Công tắc **Tự cập nhật khi file đổi** | Bật công tắc, thêm một hàm mới rồi lưu. Vài giây sau tìm thấy hàm đó. | ☐ | ☐ | |
| 1.3 | `extract --code-only/--force/--exclude/--max-workers` | **Tuỳ chọn index** | Bỏ qua một thư mục, chọn số tiến trình và "Index lại từ đầu", rồi bấm **Index lại với tuỳ chọn này**. Thư mục bị bỏ qua không còn trong Cây. | ☐ | ☐ | |
| 1.4 | `.graphifyrc language.*` | Tệp `.graphifyrc` trong dự án | Thêm `language: {".inc": "php"}` rồi index lại. Tệp `.inc` hiện ngôn ngữ PHP. | ☐ | ☐ | Không có bảng sửa trong app |
| 1.5 | `extract --mode deep` / trích xuất ngữ nghĩa | Thẻ **Phân tích ngữ nghĩa bằng AI** → Phân tích sâu | Bật AI cho dự án `docs_app`. Màn ước tính hiện model, danh sách tệp và token. Chạy xong có node/cạnh mang nhãn "Suy luận bởi AI". | ☐ | ☐ | |
| 1.6 | `cluster-only` | **Gom cụm lại** | Bấm. Thẻ Kiến trúc vẽ lại cụm, không index lại. | ☐ | ☐ | |
| 1.7 | `label` | **Đặt tên cụm bằng AI** | Chạy với AI tắt: tên cụm vẫn sinh theo node trung tâm. Chạy với AI bật: tên mới hiện ở Kiến trúc và vẫn giữ sau khi index lại. | ☐ | ☐ | |
| 1.8 | `hook install/uninstall/status` | Thẻ **Tự cập nhật theo Git** | Xem trước khối hook, cài, rồi commit một thay đổi. Graph tự cập nhật và `<data_dir>/logs/refresh.log` có dòng mới. Gỡ hook: khối hook biến mất, phần hook sẵn có còn nguyên. | ☐ | ☐ | |
| 1.9 | `check-update` | Huy hiệu **Graph cũ hơn mã nguồn** | Tắt watcher, sửa một tệp. Huy hiệu hiện; index lại thì huy hiệu tắt. | ☐ | ☐ | |
| 1.10 | `--postgres`, `--cargo`, SCIP, MCP ingest, manifest | **Tuỳ chọn index → Nguồn bổ sung (nâng cao)** | Bật Cargo trên một workspace Rust và nạp một tệp SCIP JSON. Mỗi nguồn hiện thành một tệp ảo `nguon://…`. Ô PostgreSQL bị khoá khi máy chưa có `psycopg`. | ☐ | ☐ | |

## §3.2 Nguồn dữ liệu ngoài thư mục

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 2.1 | `clone <github-url>` | Projects → **Mở từ URL…** | Dán URL `https://github.com/…` của một kho nhỏ. Tiến độ chạy, có nút Hủy. Kho được mở và index như thư mục thường. URL `http://` hoặc host khác bị từ chối. | ☐ | ☐ | |
| 2.2 | `add <url>` | Dự án → **Nguồn từ URL** → **Thêm** | Thêm một trang web và một PDF. Nội dung hiện trong đồ thị dưới `sources/`, thư mục dự án không có tệp mới. URL tới IP nội bộ bị từ chối. | ☐ | ☐ | |
| 2.3 | Google Workspace | Tuỳ chọn index → Tài liệu (cần `gws`) | Có lối tắt `.gdoc` và có `gws`: nội dung lối tắt hiện trong đồ thị. Không có `gws`: lối tắt bị bỏ qua, không báo lỗi. | ☐ | ☐ | |
| 2.4 | Tài liệu md/docx/xlsx/PDF/html/yaml | Tuỳ chọn index → Gồm tài liệu / Tệp cấu hình | Index `docs_app`. Mỗi heading thành một node tài liệu. **Đọc mục** hiện đúng đoạn. | ☐ | ☐ | |
| 2.5 | Audio/video, ảnh | Tuỳ chọn index → Media | Có `faster-whisper`: bản chép lời hiện thành tài liệu. Thiếu công cụ: thẻ báo "Cần cài …". | ☐ | ☐ | |

## §3.3 Xem và truy vấn

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 3.1 | `graph.html` | Tab **Graph** | Mở được. Dự án lớn (trên 2.000 node) được gộp, app không treo. | ☐ | ☐ | |
| 3.2 | `tree` | Tab **Cây** | Cây thư mục → tệp → symbol, thu gọn được. Bấm symbol mở Inspector. | ☐ | ☐ | |
| 3.3 | `GRAPH_REPORT.md` | Tab **Báo cáo** | Có node trung tâm, community, câu hỏi gợi ý, cạnh bất ngờ, Import cycles, Freshness, Knowledge gaps. Bấm câu hỏi gợi ý thì chạy Hỏi graph. | ☐ | ☐ | |
| 3.4 | `query` | Tìm kiếm → chế độ **Hỏi graph** | Hỏi "main calls helper" trên `polyglot`: vùng con được tô lên graph. Hỏi tên trùng ("helper"): hiện danh sách ứng viên, không chọn bừa. | ☐ | ☐ | |
| 3.5 | `explain` | Inspector → **Giải thích** | Hiện bậc, cụm, láng giềng nhóm theo loại cạnh (tối đa 20 mỗi nhóm). | ☐ | ☐ | |
| 3.6 | `path` | Chuột phải node → **Tìm đường tới…** | Chọn `main` → `helper` (cùng ngôn ngữ): đường được tô, có độ tin cậy. Chiều ngược: báo không có đường. | ☐ | ☐ | |
| 3.7 | `affected` | Chuột phải node → **Vùng ảnh hưởng nếu sửa** | Danh sách và tô các node phụ thuộc. | ☐ | ☐ | |
| 3.8 | `god-nodes`, `benchmark` | Tab Báo cáo | Node trung tâm không chứa test. Có mức giảm token. | ☐ | ☐ | |
| 3.9 | `section` / `get_section` | Inspector node tài liệu → **Đọc mục** | Mục có dòng `api_key = "sk-…"` hiện bản đã che. | ☐ | ☐ | |
| 3.10 | Tìm kiếm | Thanh Tìm kiếm | Gõ tên hàm: kết quả mở đúng `tệp:dòng` trong Monaco. | ☐ | ☐ | |

## §3.4 Export

Mở hộp thoại **Xuất…**, chọn phạm vi toàn bộ, vùng đang xem và một community. Thư mục đích mặc định không phải thư mục dự án.

| # | graphify | Định dạng | Kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 4.1 | `export html` | HTML | Mở bằng trình duyệt, tương tác được. | ☐ | ☐ | |
| 4.2 | `export callflow-html` | HTML luồng gọi | Sơ đồ Mermaid hiện. | ☐ | ☐ | |
| 4.3 | `export obsidian` | Obsidian | Mở vault bằng Obsidian, có `graph.canvas`. | ☐ | ☐ | |
| 4.4 | `export wiki` | Wiki | Mỗi community một bài Markdown. | ☐ | ☐ | |
| 4.5 | `export svg` | SVG | Mở được. | ☐ | ☐ | |
| 4.6 | `export graphml` | GraphML | Mở được bằng yEd hoặc Gephi. | ☐ | ☐ | |
| 4.7 | `export neo4j/falkordb` | Cypher; **Đẩy lên Neo4j** | Tệp Cypher nạp được. Đẩy lên Neo4j cục bộ với mật khẩu: số node khớp. URI `http://` bị từ chối. | ☐ | ☐ | |
| 4.8 | `graph.json` | JSON | `graphify-mcp <tệp>` nạp được (script so sánh đã kiểm tự động). | ☐ | ☐ | |
| 4.9 | (F9) | PNG / Báo cáo Markdown | Mở được. | ☐ | ☐ | |

## §3.5 MCP và tích hợp trợ lý AI

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 5.1 | `graphify-mcp` stdio | Thẻ MCP → sao chép lệnh `nexgraph-engine mcp --project …` | Thêm vào Claude Code. `tools/list` đủ tool, `resources/list` có 6 resource `nexgraph://…`. Gọi được `get_section`, `tests_for`, `get_callers`, `find`. | ☐ | ☐ | |
| 5.2 | HTTP có API key | Công tắc **MCP qua HTTP** | Bật. Chỉ nghe `127.0.0.1`. Gọi không có key: bị từ chối. | ☐ | ☐ | |
| 5.3 | Tool PR (`list_prs`, `get_pr_impact`, `triage_prs`) | MCP | Trên kho có `gh`: trả danh sách PR. Không có `gh`: báo lỗi rõ ràng. | ☐ | ☐ | |
| 5.4 | `install --platform` (21 nền tảng), `uninstall` | Thẻ **Tích hợp trợ lý AI** | Chọn Claude Code, Cursor, Codex. Xem trước tệp sẽ ghi, cài, rồi Gỡ: dự án trở về như cũ (chỉ còn tệp `{}` nếu có). Nút "Sao chép cấu hình" dùng được. | ☐ | ☐ | |
| 5.5 | `hook-guard` | Tích hợp trợ lý AI → Hook nhắc dùng graph (chế độ nghiêm) | Trong Claude Code, đọc tệp trước khi hỏi graph: thấy lời nhắc. Chế độ nghiêm chặn đúng một lần mỗi phiên. | ☐ | ☐ | |

## §3.6 Nhiều repo

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 6.1 | `global add/remove/list` | Projects → **Graph chung** | Thêm `global_ts_app` và `global_ts_lib` vào graph chung, rồi gỡ một dự án. **Tìm trong graph chung** trả kết quả từ cả hai. | ☐ | ☐ | |
| 6.2 | `merge-graphs` | Chọn hai dự án → **Xem chung** | Đồ thị gộp chỉ đọc, có cạnh liên repo giữa app và lib. **Xuất graph.json gộp** được. | ☐ | ☐ | |

## §3.7 Bộ nhớ làm việc và Pull request

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 7.1 | `save-result` | Dưới câu trả lời AI: **Hữu ích / Ngõ cụt / Đã sửa** | Đánh giá ba câu trả lời. Đánh giá được lưu, mở lại app vẫn còn. | ☐ | ☐ | |
| 7.2 | `reflect` | Tab Báo cáo → **Bài học** | Hiện nguồn tin cậy và ngõ cụt đã biết từ các đánh giá ở 7.1. | ☐ | ☐ | |
| 7.3 | `prs` | Tab **Pull request** | Có remote GitHub và `gh` đã đăng nhập: danh sách PR đang mở, trạng thái CI/review, xung đột. Không có `gh`: tab ẩn hoặc báo rõ. | ☐ | ☐ | |

## §3.8 Dòng bổ sung sau rà soát 2026-11-20

| # | graphify | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 8.1 | ~40 họ ngôn ngữ | Index `polyglot` | Tổng quan liệt kê đủ 9 ngôn ngữ, có dòng "Ngôn ngữ ở mức chung". Lời gọi `main → helper` có ở cả 8 ngôn ngữ. | ☐ | ☐ | Script đối chiếu: `#include` C/C++ chưa thành cạnh IMPORTS |
| 8.2 | Bản vendor 0.9.112 | Về NexGraph / `THIRD_PARTY_LICENSES.md` | Ghi đúng 0.9.112. | ☐ | ☐ | |
| 8.3 | Resource MCP `report`, `stats`, `god-nodes`, `surprises`, `audit`, `questions` | MCP `resources/read` | Đọc được cả 6 resource. | ☐ | ☐ | |
| 8.4 | Chấm điểm `query` | Hỏi graph | Như 3.4. | ☐ | ☐ | |
| 8.5 | Import Cycles, Freshness, Knowledge Gaps | Tab Báo cáo | Như 3.3. | ☐ | ☐ | |
| 8.6 | Che secret | Đọc mục, nguồn từ URL | Secret trong tài liệu hoặc trang tải về hiện bản đã che. | ☐ | ☐ | |

## §3.9 Bản cục bộ của tính năng cloud

| # | Cloud | Nơi bấm | Cách thử, kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|---|
| 9.1 | PR review có ngữ cảnh graph | Tab Pull request → **Xem review của PR #n** | Có vùng ảnh hưởng, symbol đổi mà thiếu test, tài liệu cũ, code không còn ai gọi, tác động sang repo khác khi dự án ở trong graph chung. Nút "Sao chép nhận xét" dùng được. | ☐ | ☐ | |
| 9.2 | Test impact | Review PR | Có danh sách test bị ảnh hưởng và lệnh chạy gợi ý. PR thêm tệp mới thì báo chạy toàn bộ. | ☐ | ☐ | |
| 9.3 | Memory `remember`/`recall` | Inspector → **Ghi nhớ**; MCP `remember`, `recall` | Ghi một Bài học neo vào node qua MCP. Ghi nhớ đó hiện trong Inspector của node. | ☐ | ☐ | |
| 9.4 | `graphify_callers`, `tests_for`, `find`, `trace` | MCP | Như 5.1. | ☐ | ☐ | |

## Kịch bản demo và hiệu năng (spec gốc §6.1)

| # | Việc | Kết quả mong đợi | macOS | Windows | Ghi chú |
|---|---|---|---|---|---|
| D.1 | Kịch bản demo 5 phút | Chạy trọn vẹn, không chậm hơn trước W1. | ☐ | ☐ | |
| D.2 | Index dự án NestJS (khoảng 270 tệp) | Thời gian không vượt ngưỡng spec §6.1. Ghi số giây. | ☐ | ☐ | |
