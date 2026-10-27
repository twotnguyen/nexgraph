# NexGraph — Kế hoạch con 4: Thay đổi & vùng ảnh hưởng (Tuần 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi người dùng sửa một hàm ở trình soạn thảo ngoài, NexGraph tự cập nhật đồ thị (lập chỉ mục tăng dần) và hiện **vùng ảnh hưởng** cùng **test liên quan** và **test gap** (F6, bước 4 của kịch bản demo), kèm trình xem mã mở đúng dòng.

**Architecture:**
- Engine thêm `index/refresh.py` (đối chiếu đĩa với CSDL, cập nhật **tại chỗ** từng tệp đổi: giữ id nút nên các cạnh đi vào từ tệp không đổi còn nguyên), `changes/` (đọc `git diff` chỉ đọc, hoặc so với mốc lần lập chỉ mục khi không có Git), `impact/` (ánh xạ vùng đổi sang nút, lan truyền có trọng số ngược chiều phụ thuộc, tìm test, test gap) và hai route `POST /refresh`, `GET /changes`.
- Electron main giữ bộ theo dõi tệp (`fs.watch` đệ quy, gộp sự kiện) chỉ để **báo hiệu** "có gì đó đổi"; engine tự đối chiếu toàn bộ bằng `stat` nên không phụ thuộc đường dẫn từng sự kiện. Renderer có panel "Thay đổi", tô nút ở thẻ Graph và thẻ trình xem mã.
- Quyết định lớn: **lược đồ CSDL lên phiên bản 2** (cộng thêm, tương thích ngược): hai bảng `kieu_bien`, `moc_tep` và một cột `lan_lap_chi_muc.thu_muc_con` (Task 1).

**Tech Stack:** Python 3.12 + sqlite3 + `git` CLI (chỉ đọc) + FastAPI + pytest · Electron 44 + `fs.watch` + React 19 + `@xyflow/react` + vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-18-nexgraph-desktop-design.md` (§5.4–5.6, §6.1, §6.3) · **CSDL:** `design/database/graph.sql`, `docs/superpowers/specs/2026-10-24-nexgraph-csdl-*.md` · **UC:** `docs/srs/use-cases/UC06.md`, `UC05.md` · **Kế hoạch tổng:** `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md` (hợp đồng `/changes`, enum, tham số) · **Kế hoạch con 2, 3:** `2026-10-27-nexgraph-p2-index-schema.md`, `2026-10-27-nexgraph-p3-search-architecture.md`.

## Global Constraints

- Hệ điều hành bắt buộc: macOS và Windows. `rel_path` dùng `/`; engine chỉ nghe `127.0.0.1`, mọi route `/v1/*` cần `Authorization: Bearer <token>` và Host hợp lệ; lỗi dạng `{"error": {"code", "message"}}`. Đổi hợp đồng thì sửa roadmap trong cùng PR.
- **Chỉ đọc Git, không bao giờ ghi** (spec §5.6): chỉ dùng `git rev-parse`, `git diff`, `git ls-files`, luôn với `--no-optional-locks` và `GIT_OPTIONAL_LOCKS=0`; nội dung `.git/` phải giữ nguyên từng byte sau mọi lời gọi. Không sửa tệp mã nguồn nào.
- **Tham số lan truyền ban đầu** (spec §5.6, tinh chỉnh bằng dữ liệu bộ dev ở kế hoạch con 7): `CALLS 1.0, INHERITS 0.9, TESTED_BY 0.7, IMPORTS 0.5`, decay `0.6`, độ sâu `2`. Có hướng: lan từ nút bị đổi tới nút **phụ thuộc** vào nó. Có giới hạn độ sâu và số nút.
- **Test liên quan** = `TESTED_BY` trực tiếp + test của caller trong ≤ 2 hop. Hàm đổi mà không có test nào là **test gap** (spec §5.6).
- **Project không phải Git repo vẫn mở được**: F6 so với trạng thái của lần lập chỉ mục gần nhất, dựa trên mã băm nội dung tệp; giao diện ghi rõ "Không có Git: so với lần lập chỉ mục trước" (spec §5.6, §6.3 mục 5).
- Màu ngữ nghĩa (spec §5.9, mockup): vùng ảnh hưởng `#B86E00`, test và đã xác minh `#2E7D4F`, chưa có test `#B3261E`, nút đang chọn `#1F5FBF`.
- Dữ liệu suy ra ở `<project>/.nexgraph/graph.db`; SQLite ≥ 3.43; mọi kết nối `PRAGMA foreign_keys = ON`; `.nexgraph/`, `.git/`, `build/`, `.dart_tool/`, `node_modules/` luôn bị bỏ qua khi theo dõi.
- Giao diện tiếng Việt mặc định; thẻ Graph không vẽ quá ~2.000 nút. Không telemetry. Commit message không có dòng `Co-Authored-By`. Python `>=3.12,<3.13`, Node ≥ 22.
- Mục tiêu tầng L "cập nhật sau khi lưu tệp < 2 s" chỉ **đo và báo cáo** ở kế hoạch này (Task 11), cam kết kiểm ở tuần 8.

## Quyết định thiết kế cho kế hoạch này (đã chốt, người cài đặt không đổi; **cần người dùng xác nhận mục 1**)

1. **Lược đồ lên v2, chỉ cộng thêm.** Cập nhật tại chỗ cần (a) kiểu khai báo của biến/tham số/trường (`bindings` hiện chỉ nằm trong bộ nhớ lúc lập chỉ mục) để nối lại các tham chiếu `that_bai` ở tệp không đổi khi tệp khác thêm ký hiệu mới; (b) mốc mã băm lúc lập chỉ mục đầy đủ để so sánh khi không có Git, vì cập nhật tăng dần làm `tep.ma_bam` luôn bằng đĩa; (c) phạm vi thư mục con của lần lập chỉ mục, để cập nhật không kéo cả project vào. Bảng mới: `kieu_bien(ma_nut, ten, kieu)` khoá `(ma_nut, ten)`; `moc_tep(duong_dan_tuong_doi, ma_bam)` khoá `duong_dan_tuong_doi`; cột `lan_lap_chi_muc.thu_muc_con`. Cả ba ở dạng chuẩn BCNF, các bảng đã nộp ở báo cáo tuần 2 không đổi; CSDL v1 tự nâng cấp khi mở bằng quyền ghi. Việc này **thay đổi lược đồ đã nộp ở báo cáo tuần 2** (15 lược đồ thành 17): người dùng cần chấp thuận và cập nhật sơ đồ ERD khi viết báo cáo cuối (Task 1 Step 6 chỉ cập nhật văn bản và script SQL).
2. **Cập nhật tại chỗ, không xoá-rồi-ghi:** nút giữ nguyên `id_nut` (id gồm đường dẫn và tên đầy đủ) nên chỉ cập nhật dòng, chữ ký, tài liệu; nút biến mất mới bị xoá (cạnh đi vào tự mất theo `ON DELETE CASCADE`). Mọi cạnh **đi ra** từ nút của tệp đổi bị xoá rồi dựng lại từ lần trích xuất mới. Đổi tên tệp là xoá cộng thêm.
3. **Theo dõi chỉ để báo hiệu.** `refresh` không nhận danh sách tệp: engine tự `discover` và so `kích thước + mtime` (và mã băm khi nghi ngờ) với `tep`. Một tệp có `mtime` cách hiện tại < 2 s luôn được băm lại (tránh bỏ sót sửa liên tiếp trong cùng một giây, cùng kích thước).
4. **TESTED_BY sinh ở bước phân giải:** mỗi cạnh `CALLS` từ nút thuộc tệp kiểm thử (`la_kiem_thu = 1`) tới nút không phải kiểm thử sinh một cạnh `TESTED_BY` hướng **từ nút được kiểm thử tới test**, độ tin cậy `INFERRED`, không có dòng bằng chứng (RB12 không bắt buộc cho loại này).
5. **Hướng lan truyền:** ngược chiều `CALLS`, `IMPORTS`, `INHERITS`, `IMPLEMENTS` (người gọi, người import, lớp con bị ảnh hưởng); xuôi chiều `TESTED_BY` (tới test). Điểm của đường đi dài `d` là `(tích trọng số các cạnh) × decay^(d-1)`; điểm của nút là max trên các đường; cắt dưới `MIN_SCORE = 0.2`.
6. **Chưa xử lý tác động của ký hiệu bị xoá** (người gọi nó mất cạnh khi nút biến mất): báo tệp bị xoá ở `changed_files`, không tính vùng ảnh hưởng. Ghi ở UC06.
7. **Không tô cú pháp** ở trình xem mã trong kế hoạch này (số dòng, tô khoảng dòng, cuộn tới dòng); tô cú pháp để kế hoạch con 6.

## Hình dạng JSON bổ sung (ghi vào roadmap ở Task 7)

```
Changes = {base: "git_head"|"last_index", base_commit: str|null, note: str|null,
           changed_files: [{path, status: "M"|"A"|"D"|"R", old_path: str|null}],
           changed_nodes: [Node],
           impacted: [{node: Node, score: float, hops: 1|2}],     # giảm dần theo score; không chứa nút kiểm thử
           tests: [Node], test_gaps: [Node], truncated: bool}
Refresh = {status: "ok"|"skipped", reason: "index_running"|"refresh_running"|null, added, changed, removed, seconds}
SSE: {"type": "changes_updated", "project_id": str}               # sau mỗi refresh có thay đổi
```

## Review Focus

1. **Cập nhật tăng dần phải cho cùng kết quả lập chỉ mục đầy đủ.** Sau một chuỗi thêm, sửa, xoá, đổi tên tệp (kể cả sửa làm xuất hiện ký hiệu mà một tệp **không đổi** đã gọi trước đó), đồ thị phải bằng đồ thị của một lần lập chỉ mục đầy đủ trên cây tệp cuối: cùng nút, cạnh, tham chiếu chưa phân giải. Sửa hai lần trong cùng một giây với cùng kích thước vẫn bị phát hiện. *Test: Task 4 `test_incremental_equals_full_index`, `test_new_symbol_resolves_old_unresolved_call`, `test_racy_edit_same_second_same_size`.*
2. **Git ở các tình huống khó**: tên tệp có dấu tiếng Việt và khoảng trắng, tệp đổi tên, tệp xoá, tệp chưa theo dõi, tệp nhị phân, repo chưa có commit, thư mục không phải repo, không có `git` trong `PATH`, xuống dòng CRLF, thay đổi chỉ là xoá dòng. *Test: Task 5 `test_unicode_and_space_paths`, `test_rename_delete_untracked`, `test_no_commit_falls_back`, `test_git_missing_falls_back`, `test_pure_deletion_hunk`.*
3. **Không bao giờ ghi vào Git**: thư mục `.git/` giống từng byte sau `GET /changes`. *Test: Task 5 `test_git_directory_is_byte_identical`, Task 7 `test_changes_does_not_touch_git`.*
4. **Bão sự kiện của bộ theo dõi**: 5.000 sự kiện trong một giây (`git checkout`, `flutter pub get`, build) chỉ gây **một** lần `refresh`; sự kiện trong `.git/objects`, `.nexgraph/`, `build/`, `.dart_tool/` bị bỏ qua nhưng `.git/HEAD` và `.git/refs/` thì tính; `refresh` đang chạy hoặc lập chỉ mục đầy đủ đang chạy thì không xếp hàng vô hạn. *Test: Task 8 `test_event_storm_causes_one_refresh`, `test_ignored_and_git_paths`, `test_events_during_refresh_rerun_once`; Task 7 `test_refresh_skipped_while_indexing`.*
5. **Lan truyền có biên**: đồ thị gọi vòng, đệ quy tự gọi, một hàm có 10.000 caller: kết thúc, độ sâu ≤ 2, kết quả bị cắt có cờ `truncated`. *Test: Task 6 `test_cycles_and_self_recursion_terminate`, `test_huge_fan_in_is_capped`.*

---

### Task 1: Lược đồ v2 (cộng thêm) và nâng cấp tự động

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/schema/migrate_1_to_2.sql`, `engine/tests/fixtures/graph_v1.sql` (bản chép nguyên `graph.sql` hiện tại)
- Modify: `design/database/graph.sql` và `engine/src/nexgraph_engine/schema/graph.sql` (cùng nội dung, bản đầy đủ v2), `engine/src/nexgraph_engine/schema/db.py`, `design/database/kiem_thu.py`, `docs/superpowers/specs/2026-10-24-nexgraph-csdl-tan-tu.md`, `…-chuan-hoa.md`, `…-design.md`
- Test: `engine/tests/test_schema.py` (mở rộng)

**Interfaces:**
- Produces:
  - `GRAPH_SCHEMA_VERSION = 2`, `APP_SCHEMA_VERSION = 1` (thay `SCHEMA_VERSION` dùng chung); `class SchemaOutdatedError(RuntimeError)`.
  - `open_graph_db(path, *, read_only=False)`: CSDL mới tạo ra ở v2; CSDL `user_version = 1` mở với quyền ghi thì chạy `migrate_1_to_2.sql` trong một giao dịch rồi đặt `user_version = 2`; mở chỉ đọc một CSDL v1 ném `SchemaOutdatedError` ("Mở dự án bằng ứng dụng để nâng cấp").
  - Bảng: `kieu_bien(ma_nut INTEGER NOT NULL REFERENCES nut(ma_nut) ON DELETE CASCADE, ten TEXT NOT NULL CHECK (length(ten) BETWEEN 1 AND 255), kieu TEXT NOT NULL CHECK (length(kieu) BETWEEN 1 AND 255), PRIMARY KEY (ma_nut, ten))`; `moc_tep(duong_dan_tuong_doi TEXT PRIMARY KEY CHECK (length(duong_dan_tuong_doi) BETWEEN 1 AND 1024 AND duong_dan_tuong_doi NOT LIKE '/%' AND instr(duong_dan_tuong_doi, char(92)) = 0), ma_bam TEXT NOT NULL CHECK (length(ma_bam) = 64 AND ma_bam NOT GLOB '*[^0-9a-f]*'))`; cột `lan_lap_chi_muc.thu_muc_con TEXT CHECK (thu_muc_con IS NULL OR length(thu_muc_con) BETWEEN 1 AND 1024)`.

- [ ] **Step 1: Viết test (đang fail)** trong `test_schema.py`:
  - `test_v1_database_is_upgraded`: dựng CSDL bằng `fixtures/graph_v1.sql` (có sẵn một dự án, một tệp, hai nút, một cạnh) rồi `open_graph_db` ghi: `user_version == 2`, hai bảng mới tồn tại và rỗng, cột `thu_muc_con` có, dữ liệu cũ còn nguyên, `PRAGMA foreign_key_check` rỗng, mở lần hai không làm gì.
  - `test_read_only_v1_is_rejected` (`SchemaOutdatedError`); `test_new_database_is_v2`; `test_binding_cascade_with_node` (xoá nút thì `kieu_bien` của nó mất); `test_baseline_rejects_bad_hash_and_backslash`.
  - Cập nhật `test_schema_files_match_design` và `test_future_version_rejected` (dùng `GRAPH_SCHEMA_VERSION + 1`); thay mọi chỗ dùng `SCHEMA_VERSION` còn lại (`store/graph_store.py`).
- [ ] **Step 2: Chạy** `cd engine && uv run pytest tests/test_schema.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `db.py` (hàm `_migrate(conn, from_version)` đọc `migrate_{v}_to_{v+1}.sql` bằng `importlib.resources`) và các tệp SQL. `migrate_1_to_2.sql` chứa `CREATE TABLE`, `ALTER TABLE lan_lap_chi_muc ADD COLUMN thu_muc_con …` và `PRAGMA user_version = 2;`.
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Kiểm bản đóng gói:** build lại PyInstaller, chạy `/v1/selftest` (đã nạp `graph.sql` vào bộ nhớ). Kỳ vọng: `ok: true`.
- [ ] **Step 6: Cập nhật tài liệu CSDL:** thêm hai quan hệ và một thuộc tính vào tân từ, phụ thuộc hàm, chuẩn hoá BCNF, từ điển dữ liệu; thêm ca kiểm thử vào `design/database/kiem_thu.py` (chạy `python design/database/kiem_thu.py`, kỳ vọng tất cả đạt). Ghi vào `nhat-ky.md` rằng ERD và báo cáo tuần 2 cần cập nhật ở đợt báo cáo cuối.
- [ ] **Step 7: Commit** `feat(engine): schema v2 (additive) with automatic upgrade`.

---

### Task 2: Lưu kiểu biến và mốc mã băm khi lập chỉ mục đầy đủ

**Người:** P1

**Files:**
- Modify: `engine/src/nexgraph_engine/store/graph_store.py`, `index/resolver.py` (đọc kiểu từ CSDL), `index/indexer.py`
- Test: `engine/tests/test_graph_store.py`, `engine/tests/test_resolver.py`, `engine/tests/test_indexer.py` (mở rộng)

**Interfaces:**
- Consumes: bảng Task 1.
- Produces (`GraphStore`):
  - `add_bindings(bindings: dict[str, dict[str, str]]) -> None` (khoá ngoài là `id_nut`; ghi đè theo `(nút, tên)`); `bindings() -> dict[str, dict[str, str]]`; `delete_bindings_of_file(rel_path: str) -> None`.
  - `begin_run(files_total: int = 0, commit_sha: str | None = None, *, kind: Literal["day_du", "tang_dan"] = "day_du", subdir: str | None = None) -> int` (ghi `thu_muc_con`); `last_scope() -> str | None` (`thu_muc_con` của lần `day_du` hoàn tất gần nhất, hoặc lần đang chạy).
  - `snapshot_baseline() -> None` (thay toàn bộ `moc_tep` bằng `(duong_dan_tuong_doi, ma_bam)` hiện có trong `tep`); `baseline() -> dict[str, str]`.
  - `resolve_references(store, *, package_name)`: **bỏ tham số `bindings`**, đọc từ `store.bindings()`.
- `Indexer` (đầy đủ) ghi `bindings` của mọi tệp sau giai đoạn 1, truyền `subdir` vào `begin_run`, gọi `snapshot_baseline()` ngay trước khi đặt `hoan_tat`.

- [ ] **Step 1: Viết test (đang fail):** `test_bindings_roundtrip_and_cascade`; `test_baseline_snapshot_matches_files`; `test_begin_run_records_subdir_and_kind`; `test_resolver_reads_bindings_from_db` (kết quả của `test_calls_via_declared_receiver_type` không đổi khi không truyền tham số); `test_full_index_persists_bindings_and_baseline` (sau lập chỉ mục `bookstore_app`: `bindings()` có `_LoginScreenState` → `_auth: AuthService`, `baseline()` có đủ 9 tệp, `last_scope()` là `None`; lập chỉ mục với `subdir="lib/services"` cho `last_scope() == "lib/services"`).
- [ ] **Step 2: Chạy** `uv run pytest tests/test_graph_store.py tests/test_resolver.py tests/test_indexer.py -q`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt.**
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS (mọi test cũ vẫn PASS).
- [ ] **Step 5: Commit** `feat(engine): persist variable types, baseline hashes and index scope`.

---

### Task 3: Sinh cạnh TESTED_BY

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/impact/__init__.py`, `impact/tested_by.py`
- Modify: `engine/src/nexgraph_engine/index/indexer.py` (gọi sau `resolve_references`)
- Test: `engine/tests/test_tested_by.py`

**Interfaces:**
- Produces: `derive_tested_by(store: GraphStore) -> int`: xoá mọi cạnh `TESTED_BY` rồi sinh lại từ các cạnh `CALLS` có nút nguồn `la_kiem_thu = 1` và nút đích `la_kiem_thu = 0`: mỗi cặp `(nút được kiểm thử, test)` đúng một cạnh `TESTED_BY` hướng **từ nút được kiểm thử tới test**, `loai_con = 'direct'`, `muc_tin_cay = 'INFERRED'`, `diem_tin_cay` = lớn nhất của các cạnh `CALLS` nguồn, `nguon_goc = 'resolver'`, không có dòng bằng chứng; trả số cạnh tạo.

- [ ] **Step 1: Viết test (đang fail)** (`bookstore_app` và dự án nhỏ trong test):
  - `test_test_calls_become_tested_by`: nút `AuthService.login#method` và `AuthService#class` có cạnh `TESTED_BY` tới nút `test` "login returns a user"; không có cạnh ngược lại; `TESTED_BY` không có `dong_bang_chung`.
  - `test_one_edge_per_pair`: test gọi cùng hàm ba lần vẫn chỉ một `TESTED_BY`.
  - `test_test_to_test_calls_ignored` (test gọi hàm phụ trợ trong tệp kiểm thử thì không sinh cạnh); `test_idempotent` (gọi hai lần cùng số cạnh); `test_removed_when_call_removed`.
  - `test_indexer_runs_it`: sau `index_project`, `stats().edges_by_type["TESTED_BY"] >= 2`.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_tested_by.py -q`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** bằng một câu `INSERT … SELECT … GROUP BY` (không lặp trong Python).
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): derive TESTED_BY edges from test calls`.

---

### Task 4: Lập chỉ mục tăng dần (`refresh`)

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/index/refresh.py`
- Modify: `engine/src/nexgraph_engine/store/graph_store.py`, `engine/src/nexgraph_engine/index/indexer.py` (tách phần trích xuất một tệp dùng chung), `index/discovery.py`
- Test: `engine/tests/test_refresh.py`

**Interfaces:**
- Consumes: Task 1–3, `extract_dart`, `extract_generic`, `resolve_references`, `detect_communities`.
- Produces:
  - `@dataclass(frozen=True) RefreshResult(added: int, changed: int, removed: int, unchanged: int, seconds: float)`.
  - `refresh_project(store: GraphStore, root: Path) -> RefreshResult`: (1) `scope = store.last_scope()`; `disk = discover(root, subdir=scope)`; (2) so với `store.file_records()`: tệp mới; tệp có `kích thước` hoặc `mtime` khác, hoặc `|now − mtime| < 2 s`, thì băm lại và coi là đổi nếu `sha256` khác; tệp trong CSDL mà đĩa không còn; (3) **không có thay đổi nào thì không tạo lần chạy và không đụng CSDL**; (4) có thay đổi: `begin_run(kind="tang_dan", subdir=scope)`, với mỗi tệp đổi gọi `store.replace_file(...)`, với mỗi tệp mới `add_file` cộng nút thư mục còn thiếu và cạnh `CONTAINS`, với mỗi tệp xoá `store.remove_file(...)` rồi dọn nút thư mục không còn con; (5) phân giải lại: tham chiếu mới của tệp đổi/mới **và mọi tham chiếu `that_bai` còn lại** (cần `kieu_bien`); (6) `derive_tested_by`; (7) `detect_communities` chỉ khi tập cạnh liên tệp đổi (so `file_graph_signature` trước và sau); (8) `set_run_state("hoan_tat")`. Nối với `Indexer` để không trùng mã: hàm dùng chung `extract_file(root, rel_path, language, is_test, size, ...) -> FileExtraction` trong `index/indexer.py`.
  - `GraphStore.replace_file(run_id: int, rec: FileRec, nodes: list[Node], edges: list[Edge], refs: list[UnresolvedRef], bindings: dict[str, dict[str, str]], errors: list[tuple[str, str]]) -> None`: cập nhật dòng `tep`; so `nodes` với nút hiện có của tệp **theo `id_nut`**: nút còn thì `UPDATE` (dòng, nhãn, chữ ký, tài liệu, `la_kiem_thu`) và làm mới `nut_fts`, nút mới thì `INSERT`, nút mất thì `DELETE`; xoá mọi cạnh có nguồn là nút của tệp, mọi tham chiếu và `kieu_bien` của các nút đó và `loi_phan_tich` của tệp, rồi ghi lại từ tham số.
  - `GraphStore.remove_file(rel_path: str) -> None`; `file_records() -> dict[str, FileRec]`; `file_graph_signature() -> tuple[int, int]` (số cặp tệp có cạnh, tổng trọng số).

- [ ] **Step 1: Viết test (đang fail)** (`copy_fixture("bookstore_app")` ở đường dẫn có dấu; hàm `graph_state(store)` trả tập `(id, kind, dòng, chữ ký, doc)` của nút, tập cạnh `(nguồn, đích, loại, loại_con, dòng, cột, độ tin cậy, điểm)`, tập tham chiếu `(nguồn, tên, loại, dòng, cột, trạng_thái)`, tập `kieu_bien`, bỏ qua `ma_khoi`):
  - `test_no_changes_is_a_noop`: không tạo dòng `lan_lap_chi_muc` mới, `seconds` nhỏ.
  - **`test_incremental_equals_full_index`**: chạy một chuỗi bước trên bản sao project (sửa thân `AuthService.login`; thêm tệp `lib/services/cart_service.dart` có lớp và hàm gọi `AuthService`; xoá `lib/models/user.dart`; đổi tên `lib/widgets/primary_button.dart` thành `lib/widgets/main_button.dart`; sửa tệp kiểm thử); sau **mỗi** bước gọi `refresh_project` rồi so `graph_state` với `graph_state` của một lần `Indexer.run` đầy đủ vào một CSDL mới trên cùng cây tệp: bằng nhau.
  - **`test_new_symbol_resolves_old_unresolved_call`**: tệp A (không đổi) gọi `helper()` chưa tồn tại (tham chiếu `that_bai`); thêm tệp B định nghĩa `helper` và A import B: sau `refresh`, có cạnh `CALLS` A → `helper` và tham chiếu đó đã bị xoá; kiểu `recv.method()` ở tệp không đổi cũng nối lại được nhờ `kieu_bien`.
  - `test_edges_into_surviving_nodes_are_kept`: sửa `AuthService.login` (đổi thân, không đổi tên): cạnh `CALLS` từ `_LoginScreenState.build` tới nó vẫn còn và **cùng `ma_canh`**; xoá hẳn hàm đó thì cạnh biến mất.
  - **`test_racy_edit_same_second_same_size`**: sửa một ký tự (cùng kích thước) hai lần liên tiếp trong cùng một giây, `refresh` sau mỗi lần đều phát hiện.
  - `test_respects_subdir_scope`: lập chỉ mục `subdir="lib/services"`, thêm tệp ngoài thư mục đó, `refresh` **không** thêm nó; thêm tệp trong thư mục đó thì thêm.
  - `test_syntax_error_in_edited_file`: sửa tệp thành lỗi cú pháp: lần chạy vẫn `hoan_tat`, tệp có `loi_phan_tich`, nút cũ còn các nút phân tích được; sửa lại thì lỗi mất.
  - `test_communities_recomputed_only_when_graph_changes` (`monkeypatch` đếm số lần `detect_communities`: sửa thân hàm không đổi quan hệ thì 0 lần, thêm import thì 1 lần).
  - `test_unicode_names_and_directory_cleanup`: thêm rồi xoá tệp duy nhất trong thư mục `lib/màn hình/`: nút thư mục `lib/màn hình#directory` biến mất cùng cạnh `CONTAINS`.
  - `test_fts_follows_edits`: đổi tên hàm thì tìm tên cũ không còn, tên mới tìm thấy.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_refresh.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `refresh.py`, `replace_file`, `remove_file`, `file_records`, `file_graph_signature` và tách `extract_file`.
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS (kể cả `test_indexer.py` không đổi hành vi).
- [ ] **Step 5: Commit** `feat(engine): incremental refresh updating files in place`.

---

### Task 5: Đọc thay đổi từ Git (chỉ đọc) và từ mốc lần lập chỉ mục

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/changes/__init__.py`, `changes/gitdiff.py`, `changes/baseline.py`, `changes/model.py`
- Test: `engine/tests/test_changes.py`

**Interfaces:**
- Produces:
  - `FileChange(path: str, status: Literal["M", "A", "D", "R"], old_path: str | None, ranges: list[tuple[int, int]] | None)`: `ranges` là các đoạn dòng (1-based, bao gồm hai đầu, **phía tệp mới**) bị đổi; `None` nghĩa là cả tệp (tệp mới, chưa theo dõi, hoặc không có Git).
  - `ChangeSet(base: Literal["git_head", "last_index"], base_commit: str | None, files: list[FileChange], truncated: bool, note: str | None)`; hằng `MAX_FILES = 500`.
  - `git_changes(root: Path) -> ChangeSet | None`: `None` khi không dùng được Git (không có `git` trong `PATH`, không phải repo, chưa có commit, quá thời gian 15 s). Dùng `git --no-optional-locks` với `GIT_OPTIONAL_LOCKS=0`: `rev-parse --verify HEAD`, `diff --name-status -z HEAD`, `ls-files --others --exclude-standard -z`, và với mỗi tệp `M` một lần `diff -U0 --no-color --no-ext-diff -c core.quotepath=off HEAD -- <tệp>`. Phân tích `@@ -a[,b] +c[,d] @@`: thiếu số đếm nghĩa là 1; `d > 0` cho đoạn `(c, c+d-1)`; `d = 0` (chỉ xoá) cho đoạn `(max(c,1), c+1)`. Tệp nhị phân (`Binary files … differ`) hoặc ngoài `language_of` bị bỏ.
  - `baseline_changes(store: GraphStore) -> ChangeSet`: `base = "last_index"`, `note = "Không có Git: so với lần lập chỉ mục trước"`; so `tep.ma_bam` hiện tại với `moc_tep`: khác thì `M`, chỉ có ở `tep` thì `A`, chỉ có ở `moc_tep` thì `D`; `ranges = None`.
  - `read_changes(root: Path, store: GraphStore) -> ChangeSet`: `git_changes(...)` nếu có, ngược lại `baseline_changes(store)` (và `note` nêu lý do, ví dụ "Repo Git chưa có commit").

- [ ] **Step 1: Viết test (đang fail)** (hàm trợ giúp dựng repo thật bằng `git init`, cấu hình `user.name`/`user.email` cục bộ trong repo thử, bỏ qua cả mô-đun nếu không có `git`):
  - `test_modified_file_hunks`: sửa dòng 2 và thêm dòng 4 vào tệp 3 dòng: `ranges == [(2, 2), (4, 4)]`, `status == "M"`, `base_commit` là SHA 40 ký tự.
  - **`test_pure_deletion_hunk`**: xoá giữa tệp cho đoạn `(c, c+1)`; xoá hết nội dung tệp cho `[(1, 2)]` hoặc tương đương, không ném lỗi.
  - **`test_unicode_and_space_paths`**: tệp `lib/màn hình/đăng nhập.dart` và `a b.dart` xuất hiện đúng tên, không bị bao trong ngoặc kép.
  - **`test_rename_delete_untracked`**: `git mv` ra `R` kèm `old_path`; xoá tệp ra `D`; tệp chưa theo dõi ra `A` với `ranges is None`; tệp đã `git add` mà chưa commit ra `A`.
  - `test_binary_and_unknown_extensions_skipped`; `test_crlf_file_line_numbers` (tệp CRLF sửa một dòng cho đúng số dòng).
  - **`test_no_commit_falls_back`** (repo mới `git init` chưa commit → `read_changes` dùng `baseline_changes`, `note` nêu lý do); **`test_git_missing_falls_back`** (`monkeypatch.setenv("PATH", "")`); `test_not_a_repo_falls_back`.
  - **`test_git_directory_is_byte_identical`**: băm mọi tệp trong `.git/` trước và sau `read_changes`: giống hệt.
  - `test_baseline_changes_via_hashes`: không Git: sửa, thêm, xoá tệp rồi `refresh` thì `baseline_changes` vẫn thấy đủ ba loại (vì `moc_tep` không đổi khi `refresh`), `ranges is None`; lập chỉ mục đầy đủ lại thì rỗng.
  - `test_truncates_over_max_files` (`MAX_FILES` hạ bằng `monkeypatch` còn 3).
- [ ] **Step 2: Chạy** `uv run pytest tests/test_changes.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt.** Gọi `subprocess.run([...], cwd=root, capture_output=True, timeout=15, env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"})`, giải mã UTF-8 với `errors="replace"`.
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): read-only git changes with baseline fallback`.

---

### Task 6: Ánh xạ vùng đổi sang nút, lan truyền ảnh hưởng, test và test gap

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/impact/params.py`, `impact/analyze.py`
- Test: `engine/tests/test_impact.py`

**Interfaces:**
- Consumes: `ChangeSet` (Task 5), `TESTED_BY` (Task 3).
- Produces:
  - `params.py`: `WEIGHTS = {"CALLS": 1.0, "INHERITS": 0.9, "IMPLEMENTS": 0.9, "TESTED_BY": 0.7, "REFERENCES": 0.6, "USES_TYPE": 0.6, "IMPORTS": 0.5}`, `DECAY = 0.6`, `MAX_DEPTH = 2`, `MIN_SCORE = 0.2`, `MAX_IMPACTED = 200`, `MAX_CHANGED_NODES = 2000`, `MAX_FAN_IN = 1000`.
  - `@dataclass(frozen=True) Impacted(node: Node, score: float, hops: int)`; `@dataclass(frozen=True) ImpactReport(changed_nodes: list[Node], impacted: list[Impacted], tests: list[Node], test_gaps: list[Node], truncated: bool)`.
  - `map_to_nodes(conn, changes: ChangeSet) -> list[Node]`: nút **ký hiệu** (không phải `file`, `directory`, `repository`) của tệp đổi có khoảng dòng giao một đoạn trong `ranges`; `ranges is None` thì mọi nút ký hiệu của tệp; tệp `D` không cho nút; sắp theo `(tệp, dòng)`.
  - `propagate(conn, seeds: list[str], *, params=…) -> list[Impacted]`: tìm theo bề rộng; từ nút `n` đi **ngược** qua cạnh `CALLS`, `INHERITS`, `IMPLEMENTS`, `IMPORTS`, `REFERENCES`, `USES_TYPE` (tới nút nguồn của cạnh có đích là `n`); đi **xuôi** qua `TESTED_BY`; điểm theo quyết định 5; mỗi nút giữ điểm lớn nhất (hòa thì `hops` nhỏ hơn); loại các nút hạt giống; cắt tại `MIN_SCORE`, mỗi nút chỉ xét tối đa `MAX_FAN_IN` cạnh vào; sắp giảm dần theo `(score, -hops, id)`.
  - `tests_for(conn, node_id: str) -> list[Node]`: test là đích `TESTED_BY` của `node_id` hoặc của một caller (`CALLS` ngược) cách `node_id` ≤ 2 hop.
  - `analyze(conn, changes: ChangeSet) -> ImpactReport`: `changed_nodes = map_to_nodes`, `impacted = propagate(...)` (bỏ nút kiểm thử), `tests` = hợp của `tests_for` mọi nút bị đổi và mọi nút ảnh hưởng có `hops ≤ 2`, `test_gaps` = nút `method` hoặc `function` bị đổi, không thuộc tệp kiểm thử, có `tests_for` rỗng; `truncated` bật khi bị cắt bởi một trong các `MAX_*`.

- [ ] **Step 1: Viết test (đang fail)** (đồ thị dựng bằng dự án nhỏ trong test rồi `index_project`; helper `report(store, ranges_by_file)`):
  - `test_map_ranges_to_nodes`: đoạn nằm trong thân `AuthService.login` cho cả `AuthService.login` và lớp `AuthService` (quy tắc là "khoảng dòng của nút giao đoạn đổi"; `impacted` loại các nút hạt giống nên không trùng); đoạn ngoài mọi nút cho rỗng; `ranges=None` cho mọi nút ký hiệu của tệp; tệp `D` cho rỗng.
  - **`test_login_change_impacts_callers`** (`bookstore_app`): đổi `AuthService.login` thì `impacted` có `_LoginScreenState.build` với `hops == 1` và `score == 1.0`; mọi nút `hops == 2` có `score <= 0.6` (đúng `0.6 × trọng số cạnh thứ hai`); danh sách sắp giảm dần theo `score`; không có nút nào thuộc tệp kiểm thử.
  - `test_weights_and_decay_exact`: dựng chuỗi `a → b → c` (gọi) và `c` bị đổi: `b` điểm `1.0` hops 1, `a` điểm `0.6` hops 2; import hai bước điểm `0.5 × 0.5 × 0.6 = 0.15` bị cắt do dưới `MIN_SCORE`; một nút đạt được bằng hai đường lấy điểm lớn nhất.
  - `test_inheritance_and_imports_propagate`: sửa lớp cha thì lớp con ảnh hưởng `0.9`; sửa hàm thì tệp import tệp chứa nó ảnh hưởng `0.5`.
  - **`test_cycles_and_self_recursion_terminate`**: `a ↔ b`, `a` gọi chính nó: kết thúc, mỗi nút đúng một lần, `hops ≤ 2`.
  - **`test_huge_fan_in_is_capped`**: một hàm có 1.500 caller: kết thúc nhanh (< 2 s), `truncated is True`, `len(impacted) <= MAX_IMPACTED`.
  - `test_tests_via_tested_by_and_callers`: test của hàm gọi tới hàm đổi (cách 1 hop) và test cách 2 hop có mặt, test cách 3 hop thì không.
  - **`test_test_gap_marks_untested_changed_function`**: thêm hàm mới không ai kiểm thử và sửa `AuthService.login` (có test): chỉ hàm mới là gap; hàm trong tệp kiểm thử không bao giờ là gap; hàm không có test nhưng có caller trong 2 hop được kiểm thử thì **không** là gap.
  - `test_non_git_file_level_changes`: `ranges=None` cho mọi nút của tệp đổi.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_impact.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** bằng truy vấn SQL theo lô cho mỗi tầng (không nạp cả đồ thị); hằng ở `params.py` là nơi duy nhất chứa trọng số.
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): impact propagation, related tests and test gaps`.

---

### Task 7: Route `/refresh` và `/changes`, khoá theo project, sự kiện

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/api/routes_changes.py`, `engine/src/nexgraph_engine/index/refresh_service.py`
- Modify: `engine/src/nexgraph_engine/api/app.py`, `api/services.py`, `index/jobs.py` (hỏi "đang lập chỉ mục"), `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md`, `docs/srs/use-cases/UC06.md`
- Test: `engine/tests/test_api_changes.py`

**Interfaces:**
- Consumes: Task 4–6, `EventBus`, `JobManager`.
- Produces:
  - `class RefreshService(registry: ProjectRegistry, bus: EventBus, jobs: JobManager)`: `refresh(project_id: str) -> dict` (hình dạng `Refresh`): không chờ khoá; `skipped/index_running` khi `jobs` có công việc đang chạy cho project; `skipped/refresh_running` khi đã có một lần refresh; ngược lại mở CSDL **ghi** riêng, chạy `refresh_project`, và khi có thay đổi phát `{"type": "graph_updated", ...}` và `{"type": "changes_updated", "project_id": ...}`; ném `UnknownProject`.
  - `POST /v1/projects/{pid}/refresh` → `Refresh` (`404 unknown_project`).
  - `GET /v1/projects/{pid}/changes?refresh=true` → `Changes` (hình dạng ở trên): khi `refresh=true` (mặc định) gọi `RefreshService.refresh` trước (bỏ qua nếu trả `skipped`), rồi `read_changes` + `analyze` trên kết nối chỉ đọc; `refresh=false` bỏ bước đầu. Nút tuần tự hoá bằng `node_json`.

- [ ] **Step 1: Viết test (đang fail)** (`api`, dự án `bookstore_app` đặt trong thư mục có dấu, biến thành repo Git bằng `git init` + commit ở test khi cần):
  - `test_refresh_reports_counts`: sửa một tệp rồi `POST /refresh` cho `changed == 1`; gọi lần hai cho `0`; có thay đổi thì SSE nhận `changes_updated`; không có thì không nhận.
  - **`test_refresh_skipped_while_indexing`** (dùng `Blocking` như `test_api_projects.py`): `status == "skipped"`, `reason == "index_running"`.
  - `test_concurrent_refresh_second_is_skipped` (hai luồng, một luồng bị giữ bằng `monkeypatch`).
  - **Kịch bản demo bước 4** `test_edit_function_shows_impact_and_tests`: commit sạch rồi sửa thân `AuthService.login`; `GET /changes` cho `base == "git_head"`, `changed_files == [{"path": "lib/services/auth_service.dart", "status": "M", "old_path": null}]`, `changed_nodes` có `AuthService.login`, `impacted` có `_LoginScreenState.build`, `tests` có "login returns a user", `test_gaps == []`; thêm một hàm mới chưa có test rồi gọi lại thì `test_gaps` có hàm đó.
  - `test_changes_without_git_uses_last_index`: dự án không phải repo: `base == "last_index"`, `note` bắt đầu bằng "Không có Git"; sau lập chỉ mục lại thì `changed_files == []`.
  - **`test_changes_does_not_touch_git`**: băm `.git/` trước và sau.
  - `test_changes_refresh_false_does_not_write` (`stat` của `graph.db` không đổi), `test_changes_clean_tree_is_empty`, `test_changes_truncated_flag` (hạ giới hạn bằng `monkeypatch`).
  - `test_routes_need_token_and_host` cho cả hai route.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_api_changes.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt**; khoá theo project là `threading.Lock` lấy bằng `acquire(blocking=False)`; `JobManager.is_active(project_id: str) -> bool`. Cập nhật roadmap (mục "Hình dạng JSON bổ sung" và hợp đồng `/changes`) và UC06.
- [ ] **Step 4: Chạy** `uv run pytest -q`. Kỳ vọng: PASS.
- [ ] **Step 5: Kiểm bản đóng gói:** build lại PyInstaller, tạo repo Git tạm từ `tests/fixtures/bookstore_app`, mở, lập chỉ mục, sửa tệp, `POST /refresh`, `GET /changes`. Kỳ vọng: thấy `AuthService.login` ở `changed_nodes` (kiểm cả khi `git` được gọi từ tiến trình đóng gói).
- [ ] **Step 6: Commit** `feat(engine): refresh and changes routes with per-project guard`.

---

### Task 8: Bộ theo dõi tệp ở Electron main và client `refresh`/`changes`

**Người:** P2

**Files:**
- Create: `apps/desktop/src/main/watch/project-watcher.ts`, `apps/desktop/src/main/watch/ignore.ts`
- Modify: `apps/desktop/src/shared/graph-types.ts` (`Changes`, `Refresh`, `EngineEvent` thêm `changes_updated`), `shared/api.ts`, `main/engine/api.ts`, `main/ipc.ts`, `preload/index.ts`, `renderer/src/test-utils.ts`, `test/fixtures/fake-engine.mjs`
- Test: `apps/desktop/test/watcher.test.ts`, `apps/desktop/test/engine-api.test.ts` (mở rộng)

**Interfaces:**
- Consumes: JSON `Changes`/`Refresh` (Task 7), `EngineApi`.
- Produces:
  - `shouldIgnore(relPath: string): boolean` (`ignore.ts`): đường dẫn tương đối dùng `/` (chuẩn hoá `\`); `true` cho mọi đường dẫn có thành phần `.nexgraph`, `build`, `.dart_tool`, `node_modules`, `.idea`, `ephemeral`, và cho `.git/**` **trừ** `.git/HEAD` và `.git/refs/**`.
  - `class ProjectWatcher(opts: {root: string; onFlush: () => Promise<void>; onError?: (e: Error) => void; debounceMs?: number /*500*/; maxWaitMs?: number /*3000*/; watch?: typeof fs.watch})` với `start(): void`, `stop(): void`: lắng nghe `fs.watch(root, {recursive: true})`; sự kiện không bị bỏ qua đánh dấu "bẩn" và hẹn gọi `onFlush` sau `debounceMs` kể từ sự kiện cuối, nhưng không muộn hơn `maxWaitMs` kể từ sự kiện đầu của đợt; đang `onFlush` mà có sự kiện mới thì chạy lại **đúng một lần** sau khi xong; `onFlush` ném lỗi thì gọi `onError` và vẫn tiếp tục theo dõi; `stop()` huỷ hẹn giờ và đóng watcher.
  - `EngineApi.refresh(pid: string): Promise<Refresh>`, `EngineApi.changes(pid: string, o?: {refresh?: boolean}): Promise<Changes>`.
  - `NexGraphApi`: `index.refresh(projectId)`, `graph.changes(projectId, opts?)`, `watch.start(projectId, path)`, `watch.stop(projectId)`. Kênh IPC: `index:refresh`, `graph:changes`, `watch:start`, `watch:stop`. Main giữ `Map<projectId, ProjectWatcher>`; `onFlush` gọi `EngineApi.refresh(projectId)`; `watch:start` lần hai cho cùng project thay watcher cũ; đóng mọi watcher khi thoát ứng dụng.

- [ ] **Step 1: Mở rộng `fake-engine.mjs`:** `POST /v1/projects/p1/refresh` đếm số lần gọi và trả `{status:"ok", added:0, changed:1, removed:0, seconds:0.01, reason:null}` (đọc đếm qua `GET /v1/projects/p1/__refresh_count` chỉ có trong engine giả); `GET /v1/projects/p1/changes` trả một `Changes` mẫu và ghi lại truy vấn nhận được; `/v1/events` thêm sự kiện `changes_updated` sau `graph_updated`.
- [ ] **Step 2: Viết test (đang fail)** `watcher.test.ts` (`vi.useFakeTimers`, `watch` giả là một `EventEmitter` có `close()`):
  - `test_ignored_and_git_paths`: `shouldIgnore` cho các đường dẫn ở trên, kể cả dạng Windows (`build\\x.dart`), và `false` cho `lib/a.dart`, `.git/HEAD`, `.git/refs/heads/main`, `.gitignore`.
  - **`test_event_storm_causes_one_refresh`**: 5.000 sự kiện trong 1 giây → sau `debounceMs` đúng một lần `onFlush`.
  - `test_max_wait_flushes_during_continuous_events` (sự kiện đều đặn mỗi 100 ms trong 10 s vẫn flush đều theo `maxWaitMs`, không dồn đến cuối).
  - **`test_events_during_refresh_rerun_once`**: trong lúc `onFlush` chưa xong có 3 sự kiện: sau khi xong chạy đúng một lần nữa, không hơn.
  - `test_flush_error_keeps_watching` (`onError` được gọi; sự kiện sau đó vẫn flush); `test_stop_cancels_pending_flush`; `test_only_ignored_events_never_flush`.
  - `engine-api.test.ts`: `refresh`, `changes` (có/không `refresh`), `index:refresh` qua IPC bọc `toIpcResult`.
- [ ] **Step 3: Chạy** `pnpm --filter @nexgraph/desktop vitest run test/watcher.test.ts test/engine-api.test.ts`. Kỳ vọng: FAIL.
- [ ] **Step 4: Cài đặt** các tệp; `fs.watch` đệ quy được hỗ trợ trên macOS và Windows (nền tảng mục tiêu), nên không thêm phụ thuộc.
- [ ] **Step 5: Chạy** `pnpm --filter @nexgraph/desktop typecheck && pnpm --filter @nexgraph/desktop test`. Kỳ vọng: PASS.
- [ ] **Step 6: Kiểm tay trên app thật:** `electron-vite dev -- --remote-debugging-port=9333`, mở `bookstore_app` (đường dẫn có dấu), vào Workspace, dùng `touch`/sửa một tệp bằng trình soạn thảo ngoài; xem log engine có `POST /v1/projects/<id>/refresh` đúng một lần và renderer nhận `changes_updated` (đọc qua CDP bằng `window.nexgraph.index.onEvent` đăng ký tạm).
- [ ] **Step 7: Commit** `feat(desktop): project watcher, refresh and changes client`.

---

### Task 9: Panel "Thay đổi" và tô nút ở thẻ Graph

**Người:** P2

**Files:**
- Create: `apps/desktop/src/renderer/src/components/changes/ChangesPanel.tsx`, `state/useChanges.ts`
- Modify: `renderer/src/screens/WorkspaceScreen.tsx` (mục thứ hai ở thanh hoạt động, bật theo dõi, truyền `highlights`), `renderer/src/components/graph/GraphCanvas.tsx` (prop `highlights`), `renderer/src/components/graph/kindStyle.ts`, `strings.ts`, `styles.css`
- Test: `renderer/src/components/changes/ChangesPanel.test.tsx`, `renderer/src/state/useChanges.test.tsx`, `renderer/src/screens/WorkspaceScreen.test.tsx` (mở rộng), `GraphCanvas.test.tsx` (mở rộng)

**Interfaces:**
- Consumes: `graph.changes`, `index.refresh`, `index.onEvent` (`changes_updated`), `watch.start/stop` (Task 8).
- Produces:
  - `useChanges(projectId: string): { changes: Changes | null; loading: boolean; error: string | null; reload: () => void }`: nạp khi gắn kết, nạp lại (gộp, tối đa một lần mỗi 300 ms) khi nhận `changes_updated` của đúng project hoặc khi gọi `reload`; kết quả của lần gọi cũ đến muộn bị bỏ.
  - `ChangesPanel({ changes, loading, error, onReload, onOpenNode, onOpenCode?: (file: string, line?: number) => void })`: dòng đầu nêu cơ sở so sánh ("So với HEAD a1b2c3d" hoặc ghi chú "Không có Git: so với lần lập chỉ mục trước"); các mục "Đã thay đổi" (tệp kèm `M/A/D/R`), "Vùng ảnh hưởng" (nhãn, điểm, `hops`, màu `#B86E00`), "Test liên quan" (`#2E7D4F`), "Chưa có test" (`#B3261E`); mục bấm được mở nút ở thẻ Graph; "Chưa có thay đổi" khi trống; cờ `truncated` hiện "Danh sách đã bị cắt bớt"; nút "Làm mới".
  - `GraphCanvas` nhận `highlights?: Record<string, "changed" | "impacted" | "test" | "gap">`: nút có trong bản đồ này được tô viền theo màu ngữ nghĩa và có nhãn nhỏ ("đã đổi", "ảnh hưởng", "test", "chưa có test"); không đổi hành vi khi vắng.
  - `WorkspaceScreen`: mục "Thay đổi" ở thanh hoạt động, `watch.start(project_id, project.path)` khi vào Workspace và `watch.stop` khi rời; chọn một mục của panel chuyển sang thẻ Graph với `focusNodeId` và `highlights` dựng từ báo cáo.

- [ ] **Step 1: Viết test (đang fail):**
  - `useChanges`: nạp khi gắn kết; `changes_updated` của project khác bị bỏ qua; ba sự kiện liên tiếp trong 300 ms chỉ gọi `graph.changes` thêm một lần; kết quả cũ đến muộn không ghi đè; lỗi hiện qua `error`.
  - `ChangesPanel`: dòng cơ sở cho cả `git_head` (có SHA rút gọn 7 ký tự) và `last_index` (có ghi chú); các mục đúng số lượng, điểm làm tròn hai chữ số và `hops`; bấm mục gọi `onOpenNode(node.id)`; trống hiện "Chưa có thay đổi"; `truncated`; nút "Làm mới" gọi `onReload`; test gap có `role="alert"`-không (chỉ màu và chữ "Chưa có test", không dùng `alert`).
  - `GraphCanvas`: nút có `highlights` có nhãn nhỏ đúng và viền đúng màu (kiểm `style.borderColor`); không có `highlights` thì giao diện cũ.
  - `WorkspaceScreen`: vào Workspace gọi `watch.start` đúng một lần với đường dẫn project; rời (unmount) gọi `watch.stop`; bật panel "Thay đổi" gọi `graph.changes`; chọn một mục chuyển thẻ Graph.
- [ ] **Step 2: Chạy** `pnpm --filter @nexgraph/desktop vitest run src/renderer/src/components/changes src/renderer/src/state src/renderer/src/screens/WorkspaceScreen.test.tsx src/renderer/src/components/graph`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt.**
- [ ] **Step 4: Chạy** `pnpm --filter @nexgraph/desktop typecheck && pnpm --filter @nexgraph/desktop test && pnpm --filter @nexgraph/desktop build`. Kỳ vọng: PASS.
- [ ] **Step 5: Kiểm tay trên app thật (kịch bản demo bước 4):** biến bản sao `bookstore_app` thành repo Git (commit sạch), mở trong NexGraph, mở panel "Thay đổi" (trống), rồi **sửa thân `AuthService.login` bằng một trình soạn thảo ngoài**: không chạm giao diện, panel tự hiện `lib/services/auth_service.dart` (M), vùng ảnh hưởng có `_LoginScreenState.build` (1.00), test "login returns a user", và bấm một mục thì thẻ Graph tô đúng màu; chụp ảnh bằng `Page.captureScreenshot` và xem. Thử thêm: thư mục không phải Git (ghi chú "Không có Git…"). Lặp lại ở `electron-vite preview` (`file://`).
- [ ] **Step 6: Commit** `feat(desktop): changes panel with impact highlights in the graph tab`.

---

### Task 10: Trình xem mã

**Người:** P2

**Files:**
- Create: `apps/desktop/src/renderer/src/components/code/CodeViewer.tsx`
- Modify: `renderer/src/screens/WorkspaceScreen.tsx` (thẻ tệp động), `components/graph/NodeInspector.tsx` (nút "Mở mã"), `components/architecture/EvidencePopover.tsx` (bấm mục mở mã đúng dòng), `components/changes/ChangesPanel.tsx`, `strings.ts`, `styles.css`
- Test: `renderer/src/components/code/CodeViewer.test.tsx`, `NodeInspector`/`EvidencePopover`/`WorkspaceScreen` tests (mở rộng)

**Interfaces:**
- Consumes: `graph.code(projectId, file, start?, end?)`, `index.refresh` (Task 8).
- Produces:
  - `CodeViewer({ projectId, file, line, lineEnd?, onReload?, onClose })`: nạp từ dòng `max(1, line − 200)` (tối đa 2.000 dòng do engine giới hạn); hiện số dòng và nội dung bằng `<pre>` chữ đơn cách, **tô nền khoảng `[line, lineEnd ?? line]`**, cuộn tới dòng `line` khi nạp xong; dải thông báo "Tệp đã thay đổi so với lần lập chỉ mục" kèm nút "Làm mới" khi `stale` (gọi `index.refresh` rồi nạp lại); nêu lỗi `file_not_found` ("Tệp không còn tồn tại hoặc chưa được lập chỉ mục"), `outside_project`; thông báo "Chỉ hiện tối đa 2.000 dòng" khi bị cắt; tên tệp ở đầu và nút đóng; không tô cú pháp.
  - `WorkspaceScreen`: thẻ ngoài "Kiến trúc" và "Graph" có thể thêm thẻ tệp `{file, line, lineEnd}` (mỗi tệp một thẻ, mở lại cùng tệp thì chuyển tới thẻ cũ và cập nhật dòng; thẻ có nút đóng); `NodeInspector` có nút "Mở mã" khi nút có `file`; bấm một mục của `EvidencePopover` mở mã tại `file:line` (nút nhỏ "Xem nút" riêng mở nút ở thẻ Graph như trước); mục của `ChangesPanel` có thêm nút "Mở mã".

- [ ] **Step 1: Viết test (đang fail):** `CodeViewer`: gọi `graph.code` với `start = max(1, line−200)`; hiện số dòng đúng; các dòng trong khoảng được tô (có `data-highlight="true"`); `scrollIntoView` được gọi cho dòng đích (stub); `stale` hiện dải và nút "Làm mới" gọi `index.refresh` rồi `graph.code` lần nữa; lỗi `file_not_found` hiện chữ thay vì trắng màn hình; `end − start + 1 == 2000` hiện thông báo cắt; nội dung có ký tự `<`, `&`, Unicode, tab và dòng rất dài hiển thị nguyên văn (không bị xem là HTML). `WorkspaceScreen`: "Mở mã" từ inspector thêm thẻ có tên tệp; mở lại cùng tệp không nhân đôi thẻ; đóng thẻ quay về thẻ trước; bấm bằng chứng gọi `graph.code` đúng dòng.
- [ ] **Step 2: Chạy** `pnpm --filter @nexgraph/desktop vitest run src/renderer/src/components/code src/renderer/src/screens src/renderer/src/components/graph src/renderer/src/components/architecture`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt.**
- [ ] **Step 4: Chạy** `pnpm --filter @nexgraph/desktop typecheck && pnpm --filter @nexgraph/desktop test && pnpm --filter @nexgraph/desktop build`. Kỳ vọng: PASS.
- [ ] **Step 5: Kiểm tay trên app thật:** từ thẻ Kiến trúc bấm mũi tên → bấm một mục bằng chứng → thẻ tệp mở đúng dòng và tô đúng dòng; sửa tệp bằng trình soạn thảo ngoài rồi xem dải "Tệp đã thay đổi" biến mất sau "Làm mới".
- [ ] **Step 6: Commit** `feat(desktop): code viewer tab opened from evidence, inspector and changes`.

---

### Task 11: Tích hợp, đo và tài liệu

**Người:** P1 (đo) + P3 (Windows, test plan)

**Files:**
- Create: `engine/scripts/bench_refresh.py`, `engine/tests/test_e2e_changes.py`, `docs/benchmarks/2026-10-refresh-changes.md`
- Modify: `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md`, `docs/srs/use-cases/UC06.md`, `UC05.md`, `docs/install-notes.md`

**Interfaces:**
- Consumes: toàn bộ Task 1–10.
- Produces: `python scripts/bench_refresh.py <thư-mục-project>` (hoặc `--synthetic N`) in: thời gian lập chỉ mục đầy đủ; thời gian `refresh` khi **không đổi** (đối chiếu `stat`), khi sửa **một** tệp, khi sửa **50** tệp và khi thêm/xoá một tệp; thời gian `read_changes` + `analyze` với repo Git tạm (cho project thật thì chép sang thư mục tạm, `git init`, commit, sửa); kích thước `impacted`; thời gian `detect_communities` sau mỗi bước.

- [ ] **Step 1: Viết `test_e2e_changes.py`** (qua `api`, repo Git tạm từ `bookstore_app` ở đường dẫn có dấu): chạy đúng kịch bản demo bước 4 qua HTTP (commit → sửa `AuthService.login` → `POST /refresh` → `GET /changes`), kiểm `changed_nodes`, `impacted`, `tests`, `test_gaps`; sau đó `git checkout -- .` (hoàn tác) rồi `refresh` thì `changed_files == []` và đồ thị bằng lúc đầu; kịch bản không có Git; kịch bản đổi tên tệp; sửa tệp **trong lúc** một job lập chỉ mục đang chạy cho `refresh` bị `skipped`, sau khi xong `refresh` lại thì đuổi kịp.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_e2e_changes.py -v`. Kỳ vọng: PASS (nếu FAIL do dữ liệu, sửa task tương ứng và thêm test hồi quy ở đó).
- [ ] **Step 3: Đo** trên `flutter-music-app` (98 tệp), toàn bộ `flutter-samples` (428 tệp) và dự án giả 6.000 tệp (`--synthetic 6000`, dữ liệu sinh): ghi cấu hình máy, số liệu, so với **mục tiêu tầng L "cập nhật sau khi lưu tệp < 2 s"** và "mở lại < 3 s" vào `docs/benchmarks/2026-10-refresh-changes.md`; **không cam kết** số chưa đo, ghi rõ nút thắt nếu `refresh` không đổi vượt 0,5 s ở 6.000 tệp (gợi ý hướng xử lý: truyền danh sách tệp từ bộ theo dõi, đã cố ý chưa làm).
- [ ] **Step 4: Kiểm trên Windows** (P3): `uv run pytest` ở `engine/` (cần `git` trong `PATH`), `pnpm --filter @nexgraph/desktop test`, mở `bookstore_app` ở đường dẫn có dấu và khoảng trắng, bật theo dõi và sửa tệp bằng một trình soạn thảo thật (VS Code, Notepad), xem panel "Thay đổi", thử `git checkout` đổi nhánh (bão sự kiện), thử project không phải Git. Ghi kết quả vào `docs/install-notes.md`; lỗi thì ghi rõ và mở issue.
- [ ] **Step 5: Đồng bộ tài liệu:** UC06 (luồng thực tế, giới hạn ký hiệu bị xoá, chế độ không Git), UC05 (trình xem mã); roadmap: cập nhật mục "Kế hoạch con 5" nếu số liệu hay quyết định lược đồ v2 làm đổi hướng; `docs/project/tong-quan.md`, `nhat-ky.md` ở workspace đồ án (nêu rõ **lược đồ CSDL đã lên v2 và việc cần cập nhật báo cáo/ERD**).
- [ ] **Step 6: Commit** `test(engine): e2e changes and impact; docs: refresh benchmark`.

---

## Kết thúc sprint (tuần 5)

- [ ] Kịch bản demo bước 4 chạy trên macOS và Windows: sửa một hàm ở trình soạn thảo ngoài, panel "Thay đổi" tự hiện vùng ảnh hưởng, test liên quan và test gap trong vài giây, không cần thao tác nào trong NexGraph.
- [ ] `docs/benchmarks/2026-10-refresh-changes.md` có số liệu thật, kể cả khi chưa đạt mục tiêu tầng L.
- [ ] **Người dùng đã chấp thuận (hoặc từ chối) quyết định lược đồ v2** ghi ở đầu kế hoạch; nếu chấp thuận: ERD và phần CSDL của báo cáo cuối được ghi vào danh sách việc của tuần 9.
- [ ] CI xanh trên `main` (cần remote GitHub từ kế hoạch con 1) và bản cài vẫn qua smoke test (kiểm cả `git` được gọi từ tiến trình đóng gói).
- [ ] Cập nhật mục "Kế hoạch con 5" của roadmap theo kết luận spike ACP (adapter API key là đường chính).
- [ ] Sprint review: ghi dòng **Tuần 5** vào phiếu theo dõi tiến độ theo nhiệm vụ GVHD giao (hiện chưa có; nội dung nội bộ: "Theo dõi thay đổi tệp, lập chỉ mục tăng dần, vùng ảnh hưởng và test liên quan, trình xem mã").
- [ ] Viết kế hoạch con 5 (tuần 6: AI) chi tiết theo cùng mẫu.
