# NexGraph — Kế hoạch con 3: Search & kiến trúc (Tuần 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tìm kiếm ký hiệu và từ khoá (F4), bản đồ kiến trúc theo khối có mũi tên kèm bằng chứng (F2), và cảnh báo project quá lớn kèm chọn thư mục con (UC01 ngoại lệ b), có đủ giao diện: thanh tìm kiếm, thẻ Kiến trúc, hộp thoại chọn thư mục con.

**Architecture:**
- Engine thêm `index/keywords.py` + nạp FTS5 khi ghi nút, `store/search.py`, `arch/` (cộng đồng, bộ dựng khối và mũi tên, bằng chứng) và các route `/search`, `/architecture`, `/architecture/evidence`, `/scan`. Khối kiến trúc **tính khi truy vấn từ cây thư mục** (quy tắc Task 5); cộng đồng (Louvain) lưu ở `khoi_kien_truc` chỉ được dùng khi một thư mục có quá nhiều tệp rời.
- Mũi tên giữa hai khối là tổng hợp **cạnh `IMPORTS` và `CALLS` thật** giữa các tệp thuộc hai khối; không có cạnh thì không có mũi tên. Mỗi mũi tên mở ra danh sách `tệp:dòng`.
- Desktop thêm thanh hoạt động + panel Tìm kiếm, thẻ Kiến trúc (React Flow + ELK Worker có sẵn), hộp thoại project lớn. Không có AI trong kế hoạch này.

**Tech Stack:** Python 3.12 + sqlite3 FTS5 + `networkx` (Louvain, đã là phụ thuộc của Graphify) + FastAPI + pytest · Electron 44 + React 19 + `@xyflow/react` + `elkjs` + vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-18-nexgraph-desktop-design.md` (§5.5, §5.7, §5.9, §6.1, §6.3) · **CSDL:** `design/database/graph.sql` (`nut_fts`, `khoi_kien_truc`, `nut.ma_khoi`) · **UC:** `docs/srs/use-cases/UC01.md`, `UC02.md`, `UC04.md` · **Kế hoạch tổng:** `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md` (hợp đồng API, JSON v1) · **Kế hoạch con 2:** `2026-10-27-nexgraph-p2-index-schema.md`.

## Global Constraints

- Hệ điều hành bắt buộc: macOS và Windows. `rel_path` luôn dùng `/`; engine chỉ nghe `127.0.0.1`, mọi route `/v1/*` cần `Authorization: Bearer <token>` và Host hợp lệ; lỗi dạng `{"error": {"code", "message"}}`. Đổi hợp đồng thì sửa roadmap trong cùng PR.
- **Gộp đồ thị thành các khối, tối đa khoảng 9–12 khối mỗi màn** (hằng `MAX_BLOCKS = 12`). Bấm khối để đi sâu.
- **Mũi tên giữa khối = tổng hợp cạnh `IMPORTS`/`CALLS` thật. Không có cạnh thật thì không vẽ.** Bấm mũi tên → danh sách điểm gọi `tệp:dòng`. Không cần AI.
- Tìm kiếm: toàn văn trên nhãn, tên đầy đủ, chữ ký, tài liệu và từ khoá đã tách camelCase/snake_case (spec §5.3, CSDL `nut_fts`); ưu tiên trùng tên chính xác.
- Giao diện: tiếng Việt mặc định, thuật ngữ kỹ thuật giữ tiếng Anh; không bao giờ vẽ cả đồ thị (thẻ Graph ≤ ~2.000 nút); chú thích thẻ Kiến trúc: "Mũi tên = quan hệ có thật trong code" và "Số trên mũi tên = số bằng chứng" (mockup `workspace.html`).
- Dữ liệu suy ra từ mã nguồn ở `.nexgraph/graph.db`; không sửa tệp mã nguồn; SQLite ≥ 3.43; mọi kết nối `PRAGMA foreign_keys = ON`.
- Mục tiêu tầng S (≤ 1.000 tệp): lập chỉ mục lần đầu < 60 s, mở lại < 3 s. Kế hoạch này không được làm hỏng mục tiêu đó: đo lại ở Task 11.
- Không telemetry. Commit message không có dòng `Co-Authored-By`. Python `>=3.12,<3.13`, Node ≥ 22.

## Quyết định thiết kế cho kế hoạch này (đã chốt, người cài đặt không đổi)

- **Hoãn sang kế hoạch con 4:** cache theo mã băm và lập chỉ mục tăng dần cùng bộ theo dõi tệp. Lý do: lập chỉ mục đầy đủ 428 tệp chỉ mất 1,3 s (đo ở kế hoạch con 2); chỉ cần lưu mọi tham chiếu (kể cả đã phân giải) thì mới nối lại được cạnh đi vào tệp đổi, nghĩa là đổi lược đồ CSDL đã nộp ở báo cáo tuần 2. Làm một lần, đúng chỗ, ở kế hoạch con 4. Parse song song để tuần 8 theo số đo tầng L.
- **Ngưỡng project lớn:** `LARGE_FILE_COUNT = 5_000` tệp mã (cận dưới của tầng L). Vượt ngưỡng thì giao diện cảnh báo và cho chọn thư mục con; không chặn.
- **Id khối:** `dir:<rel_path>`, `file:<rel_path>`, `com:<ma_khoi>`, `more:<id khối cha hoặc rỗng>`. Id tự mô tả đủ để lấy lại danh sách tệp của khối mà không cần ngữ cảnh.
- **Cạnh dùng cho mũi tên:** chỉ `IMPORTS` và `CALLS` giữa hai tệp khác nhau (đúng spec §5.7). `INHERITS`/`IMPLEMENTS`, `NAVIGATES_TO`, `COMPOSES` thêm ở kế hoạch con 6.
- **Khối không lưu:** chỉ cộng đồng nằm trong `khoi_kien_truc` (chuẩn hoá ở báo cáo tuần 2); khối thư mục tính khi truy vấn. Mô tả khối do AI (`nguon_mo_ta = 'ai'`) để kế hoạch con 5.
- **Tìm kiếm mặc định** bao mọi loại nút trừ `repository`; `kinds` thu hẹp.

## Hình dạng JSON bổ sung (ghi vào roadmap ở Task 6)

```
SearchHit  = {node: Node, score: float}                          # GET /search → [SearchHit], giảm dần theo score
Block      = {id, label, kind: "directory"|"community"|"file"|"group", size, symbols, drillable}
Link       = {from, to, count, types: {"CALLS": n, "IMPORTS": m}}
ArchView   = {parent: {id, label} | null, blocks: [Block], links: [Link]}
Evidence   = {edge: Edge, file, line}                            # GET /architecture/evidence → [Evidence]
Scan       = {files, by_language: {...}, large: bool, threshold: 5000, top_dirs: [{path, files}]}
```

`size` là số tệp, `symbols` là số nút ký hiệu trong các tệp đó (không tính nút tệp).

## Review Focus

1. **Chuỗi tìm kiếm có ký tự đặc biệt** (`"`, `*`, `-`, `(`, `AND`, `OR`, `NEAR`, dấu `:`), chuỗi chỉ gồm dấu, rất dài, có dấu tiếng Việt và `đ`: không bao giờ ném lỗi cú pháp FTS5; trả mảng (có thể rỗng) với `200`; chuỗi rỗng hoặc chỉ khoảng trắng trả `400 bad_param`. *Test: Task 2 `test_special_characters_never_break_query`, `test_blank_query_is_400`, `test_vietnamese_diacritics`.*
2. **Thư mục phẳng 30 tệp rời** và **thư mục có 20 thư mục con**: khối ≤ 12, **không mất tệp nào** (tổng `size` bằng số tệp trong phạm vi), có khối `group` "Khác (N mục)" đi sâu được. *Test: Task 5 `test_flat_directory_uses_communities_and_stays_under_limit`, `test_many_subdirs_merge_into_group`, `test_sizes_are_conserved`.*
3. **Mũi tên chỉ khi có cạnh thật**: hai khối không có cạnh nào nối thì không có `Link`; `count` bằng đúng số mục bằng chứng; hai chiều là hai `Link` riêng; không có mũi tên từ khối vào chính nó. *Test: Task 5 `test_links_only_where_real_edges_exist`, Task 6 `test_link_count_equals_evidence_total`.*
4. **Thư mục con để lập chỉ mục không hợp lệ**: `..`, đường dẫn tuyệt đối, symlink trỏ ra ngoài, thư mục không tồn tại, là tệp; `.gitignore` của thư mục cha vẫn áp dụng cho thư mục con. *Test: Task 3 `test_subdir_rejects_escape_and_missing`, `test_parent_gitignore_applies_to_subdir`.*
5. **Project rất nhỏ hoặc không có cạnh**: 0 tệp, 1 tệp, nhiều tệp không liên quan nhau: thẻ Kiến trúc và phát hiện cộng đồng trả kết quả hợp lý (rỗng hoặc toàn khối tệp), không chia cho 0, không ném lỗi. *Test: Task 4 `test_no_links_no_communities`, Task 5 `test_empty_and_single_file_projects`.*

---

### Task 1: Tách từ khoá, nạp FTS5, trích chú thích tài liệu Dart

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/index/keywords.py`
- Modify: `engine/src/nexgraph_engine/store/graph_store.py` (`add_nodes` nạp `nut_fts`), `engine/src/nexgraph_engine/dart/extractor.py` (điền `Node.doc`)
- Test: `engine/tests/test_keywords.py`, `engine/tests/test_graph_store.py` (mở rộng), `engine/tests/test_dart_extractor.py` (mở rộng)

**Interfaces:**
- Produces:
  - `split_identifier(name: str) -> list[str]`: tách camelCase, PascalCase, snake_case, kebab-case, chữ viết tắt và chữ số, bỏ gạch dưới đầu, chữ thường. `"LoginScreen"` → `["login","screen"]`; `"HTTPServer"` → `["http","server"]`; `"_authService"` → `["auth","service"]`; `"parse_json2Dart"` → `["parse","json","2","dart"]`; `"x"` → `["x"]`; `""` → `[]`.
  - `search_keywords(label: str, qualified_name: str) -> str`: các phần tách của nhãn và tên đầy đủ, bỏ trùng, nối bằng dấu cách.
  - `GraphStore.add_nodes` ghi thêm một dòng `nut_fts(rowid = ma_nut, nhan, ten_day_du, chu_ky, tai_lieu, tu_khoa)` cho mọi nút trừ `repository`.
  - Dart: `Node.doc` = nội dung các `documentation_comment` liền kề ngay trước khai báo (mỗi dòng `///` là một nút; bỏ tiền tố `///`, `/**`, `*/`, ` * `), nối bằng `\n`, cắt ở 2.000 ký tự; chú thích thường `//` không tính; khoảng trống giữa chú thích và khai báo thì không tính.

- [ ] **Step 1: Viết test (đang fail)**
  - `test_keywords.py`: bảng ví dụ ở trên (parametrize), thêm `"đăng_nhậpScreen"` → `["đăng","nhập","screen"]`, `search_keywords("LoginScreen", "lib/a.dart::LoginScreen")` chứa `"login"` và `"screen"` đúng một lần.
  - `test_graph_store.py::test_fts_rows_follow_nodes`: thêm 3 nút, `SELECT count(*) FROM nut_fts` bằng 3 (không tính `repository`); xoá tệp bằng `clear_graph()` thì `nut_fts` rỗng (trigger `trg_nut_fts_xoa`).
  - `test_dart_extractor.py::test_doc_comments`: lớp có hai dòng `///` có `doc == "Dịch vụ đăng nhập.\nGọi API xác thực."`; phương thức có `///` có `doc` riêng; hàm sau `// thường` không có `doc`; `/** block doc */` cho `"block doc"`; chú thích cách khai báo một dòng trống thì `doc is None`.
- [ ] **Step 2: Chạy** `cd engine && uv run pytest tests/test_keywords.py tests/test_graph_store.py tests/test_dart_extractor.py -q`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `keywords.py` bằng `re` (không phụ thuộc mới); `add_nodes` thêm câu `INSERT INTO nut_fts`; extractor duyệt anh em liền trước của nút khai báo trong `program`, `class_body`, `enum_body`, `extension_body`.
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): identifier keywords, FTS5 population and dart doc comments`.

---

### Task 2: Tìm kiếm và route `/search`

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/store/search.py`
- Modify: `engine/src/nexgraph_engine/api/routes_graph.py` (route), `engine/src/nexgraph_engine/api/serialize.py`
- Test: `engine/tests/test_search.py`, `engine/tests/test_api_search.py`

**Interfaces:**
- Consumes: `split_identifier` (Task 1), `GraphStore`, `node_json`.
- Produces:
  - `build_match_query(q: str) -> str | None`: lấy tối đa 8 từ khớp `\w+` (Unicode); mỗi từ thành `"t"*` nếu không tách được, ngược lại `("t"* OR ("p1" AND "p2" …))` với `p` là các phần của `split_identifier(từ gốc)`; các từ nối bằng `AND`; không có từ nào thì trả `None`. Mọi từ đều nằm trong ngoặc kép nên toán tử FTS trong dữ liệu người dùng không có nghĩa.
  - `search(conn: sqlite3.Connection, q: str, *, kinds: set[NodeKind] | None = None, limit: int = 20) -> list[tuple[Node, float]]`: lấy tối đa `min(limit * 5, 500)` ứng viên theo `bm25(nut_fts, 10, 4, 3, 1, 5)` (cột `nhan, ten_day_du, chu_ky, tai_lieu, tu_khoa`), loại `repository`, rồi xếp lại: nhãn trùng hoàn toàn (`casefold`) trước, nhãn bắt đầu bằng chuỗi tìm kiếm sau, còn lại theo `bm25`; `score = bậc (2,0 / 1,0 / 0,0) + 1/(1 + thứ hạng bm25)`; trả đủ `limit` mục.
  - `GET /v1/projects/{pid}/search?q&kinds&limit=20` → `[{node, score}]`; `limit` 1–100; `kinds` là danh sách `NodeKind` phân cách bằng dấu phẩy; `q` rỗng hoặc chỉ khoảng trắng hoặc không có từ nào → `400 bad_param`; loại nút lạ → `400 bad_param`.

- [ ] **Step 1: Viết test (đang fail)** (dựng đồ thị bằng `index_project` trên fixture `bookstore_app` và một dự án nhỏ viết trong test):
  - `test_search.py::test_exact_name_first`: tìm `"AuthService"` có `AuthService#class` đứng đầu, trước `AuthService.login`.
  - `test_prefix_and_camel_parts`: `"authserv"` tìm thấy `AuthService`; `"login"` tìm thấy `AuthService.login`, `LoginScreen`, `login_screen.dart`; `"auth service"` (hai từ) tìm thấy `AuthService`.
  - `test_kinds_filter_and_limit`: `kinds={METHOD}` chỉ ra phương thức; `limit=2` trả tối đa 2; `repository` không bao giờ có trong kết quả.
  - `test_search_in_doc_comments_and_signature`: từ chỉ có trong `///` hoặc trong chữ ký vẫn tìm thấy.
  - `test_vietnamese_diacritics`: nút có chú thích `/// Đăng nhập` tìm được bằng `"đăng"` và `"đang"` (tokenizer `unicode61` bỏ dấu `ă` nhưng **không** gập `đ` thành `d`, nên `"dang"` không bắt buộc khớp; ghi rõ giới hạn này ở UC04).
  - `test_special_characters_never_break_query`: `'"'`, `'"unclosed'`, `"*"`, `"-login"`, `"login AND"`, `"a OR"`, `"NEAR(a b)"`, `"login:"`, `"((("`, `"\\"`, chuỗi 5.000 ký tự: không ném ngoại lệ, kết quả là `list`.
  - `test_api_search.py`: `200` với `[{node, score}]` đúng khoá, giảm dần theo `score`; `test_blank_query_is_400` (`q=`, `q=%20%20`, `q=%22%22`); `kinds=nope` → `400`; `limit=0`/`101` → `400`; cần token và Host như mọi route.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_search.py tests/test_api_search.py -q`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `search.py` và route; `bm25()` trả số âm, càng nhỏ càng tốt nên `ORDER BY bm25(...)` tăng dần; route mở kết nối chỉ đọc như các route khác.
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): fts5 search with exact-match ranking and /v1 search route`.

---

### Task 3: Quét sơ bộ và lập chỉ mục một thư mục con

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/index/scan.py`
- Modify: `engine/src/nexgraph_engine/index/discovery.py` (`subdir`), `index/indexer.py` (`subdir`), `index/jobs.py` (`start_index(..., subdir=None)`), `api/routes_projects.py` (route `/scan`, thân `POST /index`)
- Test: `engine/tests/test_scan.py`, `engine/tests/test_discovery.py` (mở rộng), `engine/tests/test_api_projects.py` (mở rộng)

**Interfaces:**
- Produces:
  - `LARGE_FILE_COUNT = 5_000`; `@dataclass(frozen=True) ScanInfo(files: int, by_language: dict[str, int], top_dirs: list[tuple[str, int]], large: bool)`; `scan_project(root: Path) -> ScanInfo`: dùng `discover`, đếm theo ngôn ngữ; `top_dirs` là thư mục độ sâu 1 và 2 (`"a"`, `"a/b"`) kèm số tệp, giảm dần theo số tệp rồi theo tên, tối đa 20.
  - `resolve_subdir(root: Path, subdir: str) -> str`: trả `rel_path` chuẩn hoá (`/`, không có `/` cuối); ném `ProjectPathError` (đã có ở `store/projects.py`) nếu rỗng, tuyệt đối, có `..` hoặc `\`, không phải thư mục tồn tại, hoặc sau `resolve()` nằm ngoài `root`.
  - `discover(root, *, max_file_bytes=2_000_000, subdir: str | None = None)`: với `subdir`, chỉ trả tệp nằm trong thư mục đó nhưng `rel_path` **vẫn tính từ `root`**; `.gitignore` của các thư mục cha vẫn áp dụng.
  - `Indexer(..., subdir: str | None = None)`; `JobManager.start_index(project_id: str, *, subdir: str | None = None) -> str`.
  - `GET /v1/projects/{pid}/scan` → `{files, by_language, large, threshold, top_dirs: [{path, files}]}`; `POST /v1/projects/{pid}/index` nhận thân tuỳ chọn `{"subdir": "lib/features"}` (thân rỗng như cũ); `subdir` sai → `400 bad_path`.

- [ ] **Step 1: Viết test (đang fail)**
  - `test_scan.py`: dự án 3 ngôn ngữ cho `by_language` đúng; `files` khớp `len(list(discover(...)))`; `large` đổi khi `LARGE_FILE_COUNT` bị hạ bằng `monkeypatch` còn 2; `top_dirs` có `"lib"` và `"lib/screens"`, sắp đúng thứ tự; dự án 0 tệp trả `files == 0`, `top_dirs == []`, không ném lỗi.
  - `test_discovery.py::test_subdir_keeps_rel_paths_from_root` (`lib/a.dart` khi `subdir="lib"`, không có `test/…`); `test_parent_gitignore_applies_to_subdir` (`.gitignore` gốc chứa `lib/generated/` thì `subdir="lib"` vẫn bỏ nó).
  - `test_subdir_rejects_escape_and_missing`: `resolve_subdir` ném lỗi với `".."`, `"../x"`, `"/etc"`, `"lib/../.."`, `"nope"`, tên một tệp, symlink trỏ ra ngoài (bỏ qua trên Windows nếu không tạo được symlink).
  - `test_api_projects.py::test_index_with_subdir`: index `subdir="lib/services"` chỉ tạo nút của hai tệp trong đó; `stats.files == 2`; id nút vẫn là `lib/services/…`; `POST` với `subdir="../x"` → `400 bad_path` và không tạo job; `GET /scan` trả `large: false`, `threshold: 5000`.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_scan.py tests/test_discovery.py tests/test_api_projects.py -q`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt.** `discover` cắt tỉa: ở cấp thư mục nằm trên đường đi tới `subdir` chỉ vào đúng thư mục con tiếp theo và không lấy tệp ở cấp đó; trong `subdir` đi bình thường.
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): project scan, large-project threshold and subdirectory indexing`.

---

### Task 4: Phát hiện cộng đồng (Louvain) và lưu khối

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/arch/__init__.py`, `arch/communities.py`
- Modify: `engine/src/nexgraph_engine/store/graph_store.py` (đọc/ghi khối), `index/indexer.py` (gọi sau giai đoạn 2)
- Test: `engine/tests/test_communities.py`

**Interfaces:**
- Consumes: `GraphStore`, bảng `khoi_kien_truc`, cột `nut.ma_khoi`.
- Produces:
  - `file_graph(conn: sqlite3.Connection) -> networkx.Graph`: nút là `rel_path` của tệp; cạnh vô hướng có `weight` = số cạnh `IMPORTS` + `CALLS` giữa hai tệp khác nhau (cả hai chiều cộng lại); bỏ tệp không có cạnh nào.
  - `detect_communities(store: GraphStore) -> int`: chạy `networkx.community.louvain_communities(G, weight="weight", seed=42)`; chỉ lưu cộng đồng có **≥ 2 tệp**; ghi `khoi_kien_truc(ten, do_gan_ket, mo_ta = NULL, nguon_mo_ta = NULL, ma_khoi_cha = NULL)` và gán `nut.ma_khoi` cho nút tệp **và mọi nút thuộc tệp đó**; trả số cộng đồng đã lưu; chạy lại thì xoá khối cũ trước. `do_gan_ket` = trọng số cạnh trong cộng đồng / (trọng số cạnh trong + cạnh đi ra), thuộc [0, 1].
  - Tên khối: đoạn cuối của **tiền tố thư mục chung dài nhất** của các tệp nếu có (ví dụ `lib/services` → `services`); nếu không (tệp nằm lẫn nhiều thư mục) thì `"Cụm " + nhãn tệp có tổng trọng số lớn nhất`; trùng tên thì thêm ` 2`, ` 3`…
  - `GraphStore.communities() -> list[dict]` (`{id: ma_khoi, name, cohesion, files: [rel_path]}`) và `GraphStore.file_community(rel_path: str) -> int | None`.
  - `Indexer.run` gọi `detect_communities` sau `resolve_references` (trước `hoan_tat`); lỗi trong bước này **không làm job thất bại**: ghi cảnh báo qua `ProgressEvent.message` và bỏ qua.

- [ ] **Step 1: Viết test (đang fail)**
  - `test_two_clusters_found`: dựng project nhỏ gồm hai nhóm 3 tệp import chặt lẫn nhau, nối nhau bằng một import: `detect_communities` trả 2; mỗi nhóm cùng một `ma_khoi`; nút ký hiệu của tệp có cùng `ma_khoi` với tệp.
  - `test_deterministic`: chạy hai lần cho cùng phân hoạch và cùng tên.
  - `test_cohesion_in_range_and_naming` (`do_gan_ket ∈ [0,1]`; nhóm trong `lib/services/` tên `services`; hai nhóm cùng tên thì có hậu tố ` 2`).
  - `test_no_links_no_communities`: 5 tệp không import nhau và dự án 0 hoặc 1 tệp: trả 0, không ngoại lệ, `khoi_kien_truc` rỗng.
  - `test_reindex_replaces_communities`: index hai lần cho cùng số khối (khối cũ bị xoá cùng `clear_graph`).
  - `test_failure_does_not_fail_job`: `monkeypatch` `detect_communities` ném `RuntimeError` thì lần chạy vẫn `hoan_tat`.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_communities.py -q`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `communities.py`; `networkx` đã có trong phụ thuộc (không thêm gì vào `pyproject.toml`).
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): louvain communities stored as architecture blocks`.

---

### Task 5: Bộ dựng khối kiến trúc và mũi tên

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/arch/builder.py`
- Test: `engine/tests/test_arch_builder.py`

**Interfaces:**
- Consumes: `GraphStore.communities()`, bảng `tep`, `nut`, `canh`.
- Produces:
  - `MAX_BLOCKS = 12`; `@dataclass(frozen=True) Block(id: str, label: str, kind: str, size: int, symbols: int, drillable: bool)`; `@dataclass(frozen=True) Link(source: str, target: str, count: int, types: dict[str, int])`; `@dataclass(frozen=True) ArchView(parent: tuple[str, str] | None, blocks: list[Block], links: list[Link])`.
  - `build_view(conn: sqlite3.Connection, parent: str | None = None) -> ArchView`; `files_of_block(conn: sqlite3.Connection, block_id: str) -> list[str]` (dùng ở Task 6); `class UnknownBlock(KeyError)` khi id không dựng lại được.

**Quy tắc chia khối** (`partition(files, base)`; tệp được so theo `rel_path`):
1. Nhóm tệp theo thành phần đầu tiên bên dưới `base`: thư mục con → mục `dir:<base/seg>`, tệp nằm ngay trong `base` → mục `file:<rel_path>`.
2. **Thu gọn:** nếu chỉ có đúng một mục và nó là thư mục thì đi tiếp vào đó (đặt `base` mới), lặp lại. (Dự án Flutter: `lib` được thu gọn ở gốc.)
3. Nếu số mục ≤ `MAX_BLOCKS` thì xong.
4. Ngược lại, nếu có **≥ 8 tệp rời** và có dữ liệu cộng đồng thì thay các mục `file:` rời bằng các khối `com:<ma_khoi>` theo cộng đồng của từng tệp (tệp không thuộc cộng đồng nào vẫn là `file:`).
5. Nếu vẫn > `MAX_BLOCKS`: giữ **11 mục lớn nhất** (theo số tệp giảm dần, hòa thì theo nhãn), gộp phần còn lại thành một khối `more:<id khối cha hoặc rỗng>` nhãn `Khác (N mục)`, `kind = "group"`. Đi sâu vào `more:<X>` ra phần mục còn lại của `X`, áp dụng lại quy tắc 3–5 trên tập đó.
- Đi sâu `dir:<p>` → `partition(tệp dưới p, base = p)`; `com:<id>` → `partition(tệp của cộng đồng, base = tiền tố thư mục chung dài nhất)`; `file:` không đi sâu được (`drillable = False`).
- Nhãn: thư mục = tên thư mục cuối; tệp = tên tệp; cộng đồng = `ten` đã lưu. Sắp xếp khối: số tệp giảm dần, hòa thì nhãn tăng dần.
- **Mũi tên:** với mọi cạnh `IMPORTS`/`CALLS` có nút nguồn và nút đích thuộc hai tệp khác nhau cùng nằm trong phạm vi của `parent`, ánh xạ mỗi tệp tới khối chứa nó ở màn này; bỏ cạnh nếu một đầu ngoài phạm vi hoặc hai đầu cùng khối; cộng `count` và `types` theo cặp có hướng (`source → target`).

- [ ] **Step 1: Viết test (đang fail)** (dựng project trong `tmp_path` rồi `index_project`; helper `view(store, parent=None)`):
  - `test_bookstore_root_collapses_lib`: gốc của `bookstore_app` thu gọn `lib`, cho các khối `models`, `screens`, `services`, `widgets` và hai khối `file:` (`main.dart`, `router.dart`, `broken.dart`); tất cả `drillable` đúng; `parent is None`.
  - `test_links_only_where_real_edges_exist`: có `Link(screens → services)` (login_screen import auth_service) với `count >= 1`, `types` chứa `IMPORTS` và `CALLS`; **không** có `Link(models → screens)`; không có `Link` có `source == target`; hai chiều là hai `Link` khác nhau nếu cả hai có cạnh.
  - `test_drill_into_directory`: `parent="dir:lib/services"` ra hai khối `file:` và các mũi tên giữa hai tệp, `parent == ("dir:lib/services", "services")`.
  - `test_flat_directory_uses_communities_and_stays_under_limit`: 30 tệp trong `lib/` chia thành 3 nhóm import chặt: số khối ≤ 12, có khối `kind == "community"`.
  - `test_many_subdirs_merge_into_group`: 20 thư mục con mỗi thư mục 2 tệp: đúng 12 khối, khối cuối `kind == "group"` nhãn `Khác (9 mục)`; đi sâu `more:` ra 9 khối.
  - `test_sizes_are_conserved`: ở mọi màn, tổng `size` của `blocks` bằng số tệp trong phạm vi (gốc: tổng số tệp; `parent`: số tệp của khối cha), kể cả sau khi gộp `group`.
  - `test_empty_and_single_file_projects`: 0 tệp → `blocks == []`, `links == []`; 1 tệp → một khối `file:`; không ném lỗi.
  - `test_unknown_block_raises`: `parent="dir:nope"`, `"zzz:1"`, `"com:99999"` ném `UnknownBlock`; id chứa Unicode và khoảng trắng (`dir:lib/màn hình`) vẫn dựng lại được.
  - `test_deterministic_ordering`: hai lần gọi cho cùng danh sách.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_arch_builder.py -q`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `builder.py`. Nạp danh sách tệp và nút→tệp bằng hai truy vấn SQL (không nạp từng cạnh qua `GraphStore.neighbors`); cạnh lấy bằng một `JOIN` `canh`–`nut`–`tep` hai lần với `loai_canh IN ('IMPORTS','CALLS')`.
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): architecture blocks and aggregated evidence-backed links`.

---

### Task 6: Bằng chứng của mũi tên và route kiến trúc

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/arch/evidence.py`, `engine/src/nexgraph_engine/api/routes_arch.py`
- Modify: `engine/src/nexgraph_engine/api/app.py` (đăng ký router), `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md` (thêm "Hình dạng JSON bổ sung")
- Test: `engine/tests/test_arch_evidence.py`, `engine/tests/test_api_arch.py`

**Interfaces:**
- Consumes: `build_view`, `files_of_block`, `UnknownBlock` (Task 5), `edge_json`.
- Produces:
  - `evidence_between(conn: sqlite3.Connection, source_block: str, target_block: str, *, limit: int = 50) -> list[StoredEdge]`: các cạnh `IMPORTS`/`CALLS` có nút nguồn thuộc tệp của `source_block` và nút đích thuộc tệp của `target_block` (hai tệp khác nhau), sắp theo `tệp bằng chứng`, `dòng`, `ma_canh`; cắt ở `limit` (1–200).
  - `GET /v1/projects/{pid}/architecture?parent=` → `ArchView` JSON (`parent` rỗng hoặc vắng = gốc; id lạ → `404 unknown_block`). Khi tuần tự hoá, `Link.source`/`Link.target` thành khoá `from`/`to`, và `ArchView.parent` thành `{id, label}` hoặc `null`.
  - `GET /v1/projects/{pid}/architecture/evidence?from&to&limit=50` → `[Evidence]` (`{edge, file, line}`); `from`/`to` lạ → `404 unknown_block`; thiếu tham số hoặc `limit` ngoài khoảng → `400 bad_param`.

- [ ] **Step 1: Viết test (đang fail)**
  - `test_arch_evidence.py::test_evidence_matches_link_count`: với mọi `Link` của gốc `bookstore_app`, số mục bằng chứng (limit tối đa) bằng `Link.count`; mọi mục có `file` và `line`, dòng nằm trong tệp thật.
  - `test_evidence_is_ordered_and_limited`: `limit=1` trả 1 mục, là mục đầu theo `(file, line)`; hai lần gọi cho cùng thứ tự.
  - `test_evidence_between_group_block`: bằng chứng của khối `more:` (dự án 20 thư mục) gồm đúng các cạnh của các thư mục bị gộp.
  - `test_api_arch.py`: `GET /architecture` trả `{parent: null, blocks, links}` đúng khoá; `parent=dir:lib/services` trả `parent {id,label}`; `parent=dir:nope` → `404 unknown_block`; **`test_link_count_equals_evidence_total`** qua API; `evidence` thiếu `to` → `400`; cần token và Host; id có Unicode đi qua URL mã hoá đúng.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_arch_evidence.py tests/test_api_arch.py -q`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `evidence.py` và `routes_arch.py`; `Evidence.file` là tệp của nút nguồn (cũng là `StoredEdge.file`), `line` là `dong_bang_chung`. Cập nhật roadmap.
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Kiểm bản đóng gói:** build lại PyInstaller (`networkx` đã gói theo Graphify), chạy `serve`, mở `tests/fixtures/bookstore_app`, index, `GET /architecture`. Kỳ vọng: có khối `services` và `screens`.
- [ ] **Step 6: Commit** `feat(engine): architecture and evidence routes`.

---

### Task 7: Client engine, kiểu và IPC cho tìm kiếm, kiến trúc, quét

**Người:** P2

**Files:**
- Modify: `apps/desktop/src/shared/graph-types.ts`, `shared/api.ts`, `main/engine/api.ts`, `main/ipc.ts`, `preload/index.ts`, `test/fixtures/fake-engine.mjs`
- Test: `apps/desktop/test/engine-api.test.ts` (mở rộng)

**Interfaces:**
- Consumes: JSON ở "Hình dạng JSON bổ sung" và các route Task 2, 3, 6.
- Produces:
  - Kiểu: `SearchHit {node: GraphNode; score: number}`, `Block`, `Link {from: string; to: string; count: number; types: Record<string, number>}`, `ArchView {parent: {id: string; label: string} | null; blocks: Block[]; links: Link[]}`, `ArchEvidence {edge: GraphEdge; file: string; line: number}`, `ScanInfo {files: number; by_language: Record<string, number>; large: boolean; threshold: number; top_dirs: {path: string; files: number}[]}`.
  - `EngineApi`: `search(pid: string, q: string, o?: {kinds?: string[]; limit?: number}): Promise<SearchHit[]>`, `architecture(pid: string, parent?: string): Promise<ArchView>`, `archEvidence(pid: string, from: string, to: string, limit?: number): Promise<ArchEvidence[]>`, `scan(pid: string): Promise<ScanInfo>`; `startIndex(pid: string, o?: {subdir?: string})` gửi thân JSON khi có `subdir`.
  - `NexGraphApi`: `graph.search`, `graph.architecture`, `graph.archEvidence`, `index.scan(projectId)`, và `index.start(projectId, opts?: {subdir?: string})`. Kênh IPC: `graph:search`, `graph:architecture`, `graph:arch-evidence`, `index:scan`; `index:start` nhận thêm `opts`.

- [ ] **Step 1: Mở rộng `fake-engine.mjs`** (tuyến cho `p1`): `/search` trả hai `SearchHit` theo `q` (`q=nope` trả `[]`, `q=%22` trả `400 bad_param`), `/architecture` trả hai khối và một `Link` (`parent=dir:nope` → `404 unknown_block`), `/architecture/evidence` trả hai mục, `/scan` trả `large: true` với hai `top_dirs`, và `POST /index` ghi lại thân nhận được vào phản hồi (`{job_id, received_body}`).
- [ ] **Step 2: Viết test (đang fail)**: `search` mã hoá `q` có dấu tiếng Việt và khoảng trắng nguyên vẹn, nối `kinds` bằng dấu phẩy; `architecture` không gửi `parent` khi vắng và mã hoá `dir:lib/màn hình` khi có; `archEvidence` gửi `from`, `to`, `limit`; `scan` trả `top_dirs`; `startIndex(pid, {subdir: "lib/Đồ án"})` gửi đúng thân JSON; lỗi `unknown_block` giữ nguyên `code`.
- [ ] **Step 3: Chạy** `pnpm --filter @nexgraph/desktop vitest run test/engine-api.test.ts`. Kỳ vọng: FAIL.
- [ ] **Step 4: Cài đặt** các phần ở mục Files. Lỗi vẫn đi qua `toIpcResult` và preload ném đối tượng `{name, code, message}` (đã làm ở kế hoạch con 2).
- [ ] **Step 5: Chạy** `pnpm --filter @nexgraph/desktop typecheck && pnpm --filter @nexgraph/desktop test`. Kỳ vọng: PASS.
- [ ] **Step 6: Commit** `feat(desktop): search, architecture and scan in engine client and ipc`.

---

### Task 8: Bố cục Workspace: thanh hoạt động, panel Tìm kiếm, hai thẻ

**Người:** P2

**Files:**
- Create: `apps/desktop/src/renderer/src/components/layout/ActivityBar.tsx`, `components/search/SearchPanel.tsx`, `state/useDebounced.ts`
- Modify: `renderer/src/screens/WorkspaceScreen.tsx`, `components/graph/GraphCanvas.tsx` (nhận `focusNodeId`), `strings.ts`, `styles.css`
- Test: `renderer/src/components/search/SearchPanel.test.tsx`, `renderer/src/screens/WorkspaceScreen.test.tsx`

**Interfaces:**
- Consumes: `window.nexgraph.graph.search` (Task 7), `GraphCanvas`, `NodeInspector` (kế hoạch con 2).
- Produces:
  - `ActivityBar({ items: {id: string; title: string; icon: ReactNode}[]; active: string | null; onToggle: (id: string) => void })`: nút có `aria-pressed`, bấm lại nút đang bật thì thu panel.
  - `SearchPanel({ projectId: string; onOpen: (node: GraphNode) => void })`: ô nhập (`aria-label="Tìm kiếm"`), chờ 200 ms sau lần gõ cuối rồi gọi `graph.search(projectId, q, { limit: 30 })`; chuỗi rỗng không gọi; kết quả là danh sách nút bấm được hiện `label`, loại nút (màu theo `kindStyle`) và `file:line_start`; Enter mở kết quả đầu; trạng thái "Không có kết quả" và hiển thị lỗi bằng `role="alert"`; kết quả của lần gõ cũ đến muộn bị bỏ.
  - `GraphCanvas` thêm prop `focusNodeId?: string | null`: khi đổi giá trị thì chuyển tâm sang nút đó; "Về gốc" vẫn về `.#repository`.
  - `WorkspaceScreen`: thanh hoạt động (mục "Tìm kiếm"), panel trái thu gọn được, hai thẻ "Kiến trúc" (mặc định) và "Graph"; mở một kết quả tìm kiếm chuyển sang thẻ Graph với `focusNodeId` và `NodeInspector` hiện nút đó. Thẻ Kiến trúc là chỗ giữ chỗ tới Task 9.

- [ ] **Step 1: Viết test (đang fail)** (`vi.useFakeTimers` cho debounce):
  - `SearchPanel`: gõ `"login"` không gọi ngay, sau 200 ms gọi đúng một lần; gõ liên tiếp chỉ gọi lần cuối; chuỗi rỗng không gọi và xoá kết quả; hiển thị `label` và `file:line`; bấm kết quả gọi `onOpen` với nút; Enter mở kết quả đầu; kết quả rỗng hiện "Không có kết quả"; lỗi `bad_param` hiện `role="alert"`; kết quả của truy vấn cũ đến sau không ghi đè kết quả mới.
  - `WorkspaceScreen`: bấm nút "Tìm kiếm" của thanh hoạt động bật/tắt panel; chọn một kết quả chuyển sang thẻ Graph và gọi `graph.neighbors` với nút đó; thẻ mặc định là "Kiến trúc".
- [ ] **Step 2: Chạy** `pnpm --filter @nexgraph/desktop vitest run src/renderer/src/components/search src/renderer/src/screens/WorkspaceScreen.test.tsx`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** các thành phần; `useDebounced<T>(value: T, ms: number): T`.
- [ ] **Step 4: Chạy** `pnpm --filter @nexgraph/desktop typecheck && pnpm --filter @nexgraph/desktop test`. Kỳ vọng: PASS (các test thẻ Graph cũ vẫn PASS).
- [ ] **Step 5: Commit** `feat(desktop): activity bar, search panel and workspace tabs`.

---

### Task 9: Thẻ Kiến trúc

**Người:** P2

**Files:**
- Create: `apps/desktop/src/renderer/src/components/architecture/ArchitectureCanvas.tsx`, `architecture/EvidencePopover.tsx`, `architecture/blockStyle.ts`
- Modify: `renderer/src/screens/WorkspaceScreen.tsx`, `strings.ts`, `styles.css`
- Test: `renderer/src/components/architecture/ArchitectureCanvas.test.tsx`, `EvidencePopover.test.tsx`

**Interfaces:**
- Consumes: `graph.architecture`, `graph.archEvidence` (Task 7), `layoutGraph` (kế hoạch con 2).
- Produces:
  - `ArchitectureCanvas({ projectId: string; onOpenNode: (nodeId: string) => void })`: nạp `architecture(projectId, parent)`; mỗi khối là một nút React Flow có nhãn, `N tệp` và viền theo `kind` (`blockStyle`); mũi tên có chiều, nhãn là `count` (độ dày theo `log(count)`); chú thích "Mũi tên = quan hệ có thật trong code" và "Số trên mũi tên = số bằng chứng"; đường dẫn (breadcrumb) `Dự án › … ` bấm được để quay lại; bấm khối `drillable` thì đi sâu (đẩy vào breadcrumb); bấm khối `file:` gọi `onOpenNode("<rel_path>#file")`; bấm mũi tên mở `EvidencePopover` rồi gọi `graph.archEvidence(projectId, from, to, 50)`.
  - `EvidencePopover({ items: ArchEvidence[]; loading: boolean; error: string | null; onOpenNode: (id: string) => void; onClose: () => void })`: danh sách `tệp:dòng` kèm loại cạnh và `nhãn nguồn → nhãn đích`; bấm một mục gọi `onOpenNode(edge.source)`; Escape đóng.
  - Khối gộp `group` ("Khác (N mục)") đi sâu được như khối thường. Hiển thị thông báo khi `blocks` rỗng ("Chưa có dữ liệu, hãy lập chỉ mục") và khi lỗi.

- [ ] **Step 1: Viết test (đang fail)** (giả `layoutGraph` như `GraphCanvas.test.tsx`; dùng `fireEvent.click` vì d3-zoom của React Flow lỗi với `userEvent` trong jsdom, xem ghi chú ở test kế hoạch con 2):
  - `ArchitectureCanvas`: 4 khối và 2 mũi tên cho 4 nút và 2 cạnh React Flow, nhãn cạnh đúng `count`; bấm khối thư mục gọi `architecture(pid, "dir:…")` và breadcrumb có thêm một mục, bấm mục đầu của breadcrumb quay về gốc (gọi lại không `parent`); bấm khối `file:lib/a.dart` gọi `onOpenNode("lib/a.dart#file")` và **không** gọi `architecture` lần nữa; bấm mũi tên gọi `archEvidence(pid, from, to, 50)` và hiện danh sách; `blocks` rỗng hiện thông báo; lỗi `unknown_block` hiện `role="alert"`; khối `group` đi sâu được.
  - `EvidencePopover`: hiển thị `lib/a.dart:12` và loại cạnh; bấm mục gọi `onOpenNode` với nút nguồn; Escape gọi `onClose`; trạng thái `loading` và `error`.
- [ ] **Step 2: Chạy** `pnpm --filter @nexgraph/desktop vitest run src/renderer/src/components/architecture`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** các thành phần; breadcrumb là mảng `{id: string | null; label: string}`; dùng `key` theo `parent` để React Flow tự căn khung nhìn sau mỗi lần đi sâu (bài học kế hoạch con 2).
- [ ] **Step 4: Chạy** `pnpm --filter @nexgraph/desktop typecheck && pnpm --filter @nexgraph/desktop test && pnpm --filter @nexgraph/desktop build`. Kỳ vọng: PASS.
- [ ] **Step 5: Kiểm tay trên app thật** (CDP như kế hoạch con 2: `electron-vite dev -- --remote-debugging-port=9333`, mở `bookstore_app`, qua màn hình Dự án gần đây): thẻ Kiến trúc hiện các khối `screens`, `services`, `widgets`, `models`; có mũi tên `screens → services`; bấm mũi tên thấy `login_screen.dart:<dòng>`; bấm mục đó chuyển sang thẻ Graph. Chụp ảnh trang bằng `Page.captureScreenshot` rồi xem. Chạy thêm `electron-vite preview` (tải từ `file://`) để chắc Worker hoạt động ở bản build.
- [ ] **Step 6: Commit** `feat(desktop): architecture tab with drill-down and evidence popover`.

---

### Task 10: Cảnh báo project lớn và chọn thư mục con

**Người:** P2

**Files:**
- Create: `apps/desktop/src/renderer/src/screens/LargeProjectScreen.tsx`
- Modify: `renderer/src/App.tsx`, `renderer/src/state/useIndexJob.ts` (nhận `subdir`), `renderer/src/screens/IndexingScreen.tsx` (prop `subdir`), `strings.ts`, `main/ipc.ts`
- Test: `renderer/src/screens/LargeProjectScreen.test.tsx`, `renderer/src/screens/IndexingScreen.test.tsx` (mở rộng), `renderer/src/App.test.tsx`

**Interfaces:**
- Consumes: `index.scan`, `index.start(pid, {subdir})` (Task 7).
- Produces:
  - `LargeProjectScreen({ project: ProjectSummary; scan: ScanInfo; onChoose: (subdir: string | null) => void; onCancel: () => void })`: nêu số tệp và ngưỡng ("Dự án có 12.345 tệp mã, vượt ngưỡng 5.000"), liệt kê `top_dirs` (đường dẫn và số tệp) để chọn một thư mục, nút "Lập chỉ mục toàn bộ", nút "Hủy" (về màn hình Dự án).
  - `useIndexJob(projectId, subdir?)` truyền `subdir` vào `index.start`; `IndexingScreen` nhận `subdir?: string | null` và ghi "Thư mục con: lib/features" khi có.
  - `App`: sau khi mở project, gọi `index.scan`; `large` là `true` thì hiện `LargeProjectScreen`, ngược lại vào thẳng `IndexingScreen`; lỗi khi quét **không chặn**: coi như không lớn và vào lập chỉ mục.

- [ ] **Step 1: Viết test (đang fail)**: `LargeProjectScreen` hiện số tệp và ngưỡng định dạng theo `vi-VN`, bấm một thư mục gọi `onChoose("lib/features")`, bấm "Lập chỉ mục toàn bộ" gọi `onChoose(null)`, "Hủy" gọi `onCancel`; `IndexingScreen` gọi `index.start` với `{subdir}` và hiện dòng thư mục con; `App.test.tsx`: dự án nhỏ vào thẳng màn hình lập chỉ mục (không hiện cảnh báo), dự án lớn hiện cảnh báo, chọn thư mục con chuyển sang lập chỉ mục với đúng `subdir`, `scan` ném lỗi thì vẫn vào lập chỉ mục.
- [ ] **Step 2: Chạy** `pnpm --filter @nexgraph/desktop vitest run src/renderer/src/screens src/renderer/src/App.test.tsx`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt.**
- [ ] **Step 4: Chạy** `pnpm --filter @nexgraph/desktop typecheck && pnpm --filter @nexgraph/desktop test`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(desktop): large project warning and subdirectory choice`.

---

### Task 11: Tích hợp, đo và tài liệu

**Người:** P1 (đo) + P3 (Windows, test plan)

**Files:**
- Create: `engine/scripts/bench_search_arch.py`, `engine/tests/test_e2e_search_arch.py`, `docs/benchmarks/2026-10-search-architecture.md`
- Modify: `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md`, `docs/srs/use-cases/UC01.md`, `UC02.md`, `UC04.md`, `docs/install-notes.md`

**Interfaces:**
- Consumes: toàn bộ Task 1–10.
- Produces: `python scripts/bench_search_arch.py <thư-mục-project>` in thời gian lập chỉ mục (kèm FTS5 và cộng đồng), 10 truy vấn mẫu với p50/p95 (ms), thời gian `build_view` ở gốc và ở khối lớn nhất, số khối mỗi màn (kiểm ≤ 12) và số `Link`.

- [ ] **Step 1: Viết `test_e2e_search_arch.py`** (qua `api`, dự án `bookstore_app` đặt ở đường dẫn có dấu): tìm `login` ra `AuthService.login` và `LoginScreen`; đi gốc → `screens` → bằng chứng của mũi tên `screens → services` có `login_screen.dart` và dòng khớp với tệp thật; khối `file:` mở được nút bằng `GET /nodes/{id}`; index lại không đổi `stats`; index với `subdir` rồi tìm kiếm chỉ ra nút trong thư mục đó; `GET /scan` đúng.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_e2e_search_arch.py -v`. Kỳ vọng: PASS (nếu FAIL do dữ liệu thì sửa task tương ứng và thêm test hồi quy ở đó).
- [ ] **Step 3: Đo** trên `flutter-music-app` (98 tệp), `flutter-samples/compass_app` (150 tệp), toàn bộ `flutter-samples` (428 tệp) ở `spikes/dart-treesitter/corpus/`; ghi cấu hình máy, số liệu và so với **mục tiêu tầng S (< 60 s lần đầu, mở lại < 3 s)** vào `docs/benchmarks/2026-10-search-architecture.md`, kèm: số khối mỗi màn có luôn ≤ 12 không, tỉ lệ cạnh `IMPORTS`/`CALLS` bị mất khi gộp (phải bằng 0 trong phạm vi), và so sánh thời gian lập chỉ mục với số liệu kế hoạch con 2 (FTS5 và cộng đồng làm chậm bao nhiêu). **Không cam kết** số chưa đo; nếu một mục vượt mục tiêu thì ghi nút thắt.
- [ ] **Step 4: Tạo project giả cỡ lớn** (sinh 6.000 tệp Dart nhỏ trong thư mục tạm bằng một đoạn script trong `bench_search_arch.py --synthetic 6000`) để kiểm `scan.large == true` và thời gian quét; ghi vào tài liệu đo, nêu rõ đây là dữ liệu sinh, không phải project thật.
- [ ] **Step 5: Kiểm trên Windows** (P3): `uv run pytest` ở `engine/`, `pnpm --filter @nexgraph/desktop test`, mở `bookstore_app` ở đường dẫn có dấu và khoảng trắng, thử tìm kiếm, thẻ Kiến trúc và bấm mũi tên. Ghi kết quả vào `docs/install-notes.md`; lỗi thì ghi rõ và mở issue.
- [ ] **Step 6: Đồng bộ tài liệu:** UC01 (chọn thư mục con), UC02 (khối, mũi tên, bằng chứng theo cài đặt thực), UC04 (tìm kiếm, ưu tiên trùng tên); roadmap: đánh dấu cache/parse song song chuyển sang kế hoạch con 4 và tuần 8; cập nhật `docs/project/tong-quan.md` và `nhat-ky.md` ở workspace đồ án.
- [ ] **Step 7: Commit** `test(engine): e2e search and architecture; docs: benchmark`.

---

## Kết thúc sprint (tuần 4)

- [ ] Kịch bản demo bước 2 ("hiện bản đồ kiến trúc") chạy trên macOS và Windows; mũi tên mở được danh sách `tệp:dòng` thật; tìm kiếm tìm ra `AuthService.login` bằng `login`.
- [ ] `docs/benchmarks/2026-10-search-architecture.md` có số liệu thật, kể cả khi chưa đạt mục tiêu.
- [ ] CI xanh trên `main` (cần remote GitHub từ kế hoạch con 1) và bản cài vẫn qua smoke test.
- [ ] Cập nhật mục "Kế hoạch con 4" của roadmap: thêm cache/tăng dần (cần lưu mọi tham chiếu, quyết định có đổi `graph.sql` lên phiên bản 2 hay không, và nếu đổi thì sửa báo cáo CSDL tuần 2 tương ứng).
- [ ] Sprint review: ghi dòng **Tuần 4** vào phiếu theo dõi tiến độ theo nhiệm vụ GVHD giao (hiện chưa có; nội dung nội bộ: "Tìm kiếm toàn văn, bản đồ kiến trúc có bằng chứng, giao diện tìm kiếm và kiến trúc").
- [ ] Viết kế hoạch con 4 (tuần 5) chi tiết theo cùng mẫu.
