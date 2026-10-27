# NexGraph — Kế hoạch con 2: Index & schema (Tuần 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mở một thư mục project Flutter, lập chỉ mục hai giai đoạn vào SQLite (`.nexgraph/graph.db`) với đồ thị đa cạnh có bằng chứng, rồi xem được lân cận của một nút trên màn hình Graph của ứng dụng.

**Architecture:**
- Engine thêm các lớp: `schema/` (enum + hai tệp SQL + mở CSDL), `store/` (ghi/đọc đồ thị, đăng ký project), `index/` (quét tệp, chạy hai giai đoạn, công việc nền + sự kiện), `dart/` (extractor Tree-sitter), `api/` (route `/v1`). Mã trích xuất đa ngôn ngữ đã vendor chỉ còn dùng cho các ngôn ngữ ngoài Dart qua một bộ chuyển đổi.
- Giai đoạn 1 ghi tệp, nút, cạnh cấu trúc và các **tham chiếu chưa phân giải**; giai đoạn 2 phân giải import, kế thừa và lời gọi thành cạnh có bằng chứng (tệp:dòng). Mỗi lần index đầy đủ xoá đồ thị cũ rồi ghi lại (tăng dần ở kế hoạch con 3–4).
- Electron main giữ client gọi engine và chuyển sự kiện SSE lên renderer qua IPC; renderer có màn hình Dự án, Đang lập chỉ mục và thẻ Graph (React Flow + ELK trong Web Worker).

**Tech Stack:** Python 3.12 + uv + FastAPI + sqlite3 (≥ 3.43, FTS5) + `tree-sitter-dart==0.1.0` + `pathspec` + pytest · Electron 44 + React 19 + `@xyflow/react` 12 + `elkjs` 0.12 + vitest + Testing Library · pnpm.

**Spec:** `docs/superpowers/specs/2026-10-18-nexgraph-desktop-design.md` (§5.3, 5.4, 5.5, 5.10, 6.1, 6.3) · **CSDL:** `docs/superpowers/specs/2026-10-24-nexgraph-csdl-chuan-hoa.md`, `design/database/graph.sql`, `design/database/app.sql` · **Phân tích UC:** `docs/superpowers/specs/2026-10-24-nexgraph-phan-tich-chuc-nang.md` (UC01, UC03, UC05) · **Kế hoạch tổng:** `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md` (hợp đồng API v1, enum).

## Global Constraints

- Hệ điều hành bắt buộc: macOS và Windows. Mọi `rel_path` lưu trong CSDL dùng `/`, không bắt đầu bằng `/`, không chứa `\` (RB3, RB14).
- SQLite ≥ 3.43 (FTS5 `contentless_delete`). Mỗi kết nối chạy `PRAGMA foreign_keys = ON`; CSDL đồ thị bật WAL (một người ghi, nhiều người đọc).
- Node id: `{rel_path}::{Qualified.Name}#{kind}`; nút tệp `{rel_path}#file`; id không chứa số dòng (ADR 0005). Nút gốc: `.#repository`; thư mục: `{rel_path}#directory`.
- Enum cố định (roadmap): `NodeKind` = `repository, package, directory, file, module, class, mixin, enum, extension, function, method, test, widget, screen, route, document, concept`; `EdgeType` = `CONTAINS, DEFINES, CALLS, IMPORTS, INHERITS, IMPLEMENTS, REFERENCES, USES_TYPE, TESTED_BY, DOCUMENTS, DEPENDS_ON, SEMANTIC_RELATED, COMPOSES, NAVIGATES_TO`; `Confidence` = `EXTRACTED, INFERRED, AMBIGUOUS`; `Origin` = `ast, resolver, llm`.
- **Cho phép nhiều cạnh giữa cùng một cặp nút** (RB16 chỉ cấm trùng hoàn toàn gồm cả dòng và cột bằng chứng).
- Cạnh `CALLS, IMPORTS, INHERITS, IMPLEMENTS, REFERENCES, USES_TYPE, COMPOSES, NAVIGATES_TO` bắt buộc có dòng bằng chứng nằm trong khoảng dòng của nút nguồn (RB12, RB22). Không có cạnh thật thì không tạo cạnh.
- Dữ liệu suy ra từ mã nguồn lưu ở `<project>/.nexgraph/graph.db`, kèm `.nexgraph/.gitignore` chứa `*`; **không sửa `.gitignore` gốc** và không sửa tệp mã nguồn nào. Thư mục project không ghi được thì lưu ở `<app-data>/projects/<project_id>/` (spec §5.10). Engine và bộ quét **bỏ qua `.nexgraph/`**.
- Chỉ lưu đường dẫn tương đối trong CSDL đồ thị; định danh project là `project_id` (uuid4, 36 ký tự) ghi trong CSDL, đổi tên hoặc di chuyển thư mục không mất index.
- Bỏ khi quét: theo `.gitignore`, `build/`, `.dart_tool/`, `node_modules/`, `.git/`, tệp sinh tự động (`*.g.dart`, `*.freezed.dart`, `*.gr.dart`, `*.config.dart`, `*.mocks.dart`, `*_generated.dart`, `*.pb.dart`).
- Mọi route `/v1/*` yêu cầu `Authorization: Bearer <token>` và Host hợp lệ; lỗi dạng `{"error": {"code": str, "message": str}}`. Đổi hợp đồng thì sửa roadmap trong cùng PR.
- Mục tiêu hiệu năng tầng S (≤ 1.000 tệp): lập chỉ mục lần đầu < 60 s; mở lại < 3 s. Ở kế hoạch này chỉ đo và ghi số liệu (Task 13); cam kết kiểm ở kế hoạch con 3.
- Giao diện: tiếng Việt mặc định; không bao giờ vẽ cả đồ thị, thẻ Graph hiện lân cận tối đa khoảng 2.000 nút.
- Không telemetry. Commit message không có dòng `Co-Authored-By`. Python `>=3.12,<3.13`, Node ≥ 22.

## Quyết định thiết kế cho kế hoạch này (đã chốt, người cài đặt không đổi)

- **Tên mã:** cột CSDL tiếng Việt (CSDL tuần 2); mã Python và JSON API dùng tiếng Anh. Lớp `store/` là nơi duy nhất dịch giữa hai bên.
- **Cạnh cấu trúc:** `CONTAINS` cho repository → directory → file; `DEFINES` cho file → ký hiệu cấp cao nhất và lớp/mixin/enum/extension → thành viên. Hai loại này không cần bằng chứng.
- **Giá trị cạnh phân giải:** `confidence` = `INFERRED`, `origin` = `resolver`; điểm 0,9 (cùng lớp hoặc cùng tệp), 0,8 (tệp đã import), 0,5 (duy nhất trong project). Nhiều ứng viên ở cùng mức thì **không tạo cạnh** (tham chiếu giữ `that_bai`), không đoán.
- **Mixin, `implements`, `on`:** `with M` → `INHERITS` subtype `mixin`; `implements I` → `IMPLEMENTS`; `mixin M on B` → `INHERITS` subtype `on`; `import` → `IMPORTS`, `export` → `IMPORTS` subtype `export`, `part` → `IMPORTS` subtype `part`.
- **Widget:** lớp có `extends` một trong `StatelessWidget, StatefulWidget, ConsumerWidget, ConsumerStatefulWidget, HookWidget, HookConsumerWidget` được gán `NodeKind.widget`; các lớp khác là `class`. `screen`/`route`/`COMPOSES`/`NAVIGATES_TO`/`pubspec` thuộc kế hoạch con 6.
- **Ngôn ngữ ngoài Dart** chỉ ở mức "graph chung" (spec §6.3 mục 3): nút tệp/lớp/hàm/phương thức, `DEFINES`, cạnh `CALLS` trong cùng tệp, `IMPORTS` chưa phân giải. Bộ trích xuất này không cho dòng kết thúc, nên `line_end` của các nút này là dòng lớn nhất trong bằng chứng các cạnh xuất phát từ nút (tối thiểu bằng `line_start`); ghi rõ là ước lượng.
- **Parse tuần tự** ở kế hoạch này (đo được ~900 tệp/giây); parse song song và cache theo mã băm ở kế hoạch con 3.
- **Hoãn sang kế hoạch con 3:** cảnh báo project quá lớn và chọn thư mục con/package (ngoại lệ b của UC01), cache theo mã băm, parse song song, FTS5 và `GET /search`, khối kiến trúc/cộng đồng.
- Hợp đồng gốc ghi "huỷ job" ở kế hoạch con 3; kế hoạch này làm luôn huỷ cộng tác giữa các tệp vì route `DELETE /v1/jobs/{id}` thuộc kế hoạch con 2.

## Hình dạng JSON v1 (bổ sung vào roadmap ở Task 9)

```
Node  = {id, kind, label, qualified_name, language|null, file|null, line_start|null, line_end|null,
         is_test, origin, signature|null, community: null}
Edge  = {id, source, target, type, subtype|null, confidence, confidence_score, origin,
         evidence: {file, line, col|null} | null}
Job   = {job_id, project_id, state: "queued"|"structure"|"resolve"|"done"|"error"|"cancelled",
         files_done, files_total, message|null}
```

## Review Focus

1. Một hàm gọi cùng một hàm đích hai lần ở hai dòng khác nhau: phải ra **hai cạnh `CALLS`**, không bị gộp thành một. *Test: Task 2 `test_parallel_edges_kept`, Task 7 `test_two_calls_two_edges`.*
2. Tệp Dart **lỗi cú pháp, rỗng, có BOM, xuống dòng CRLF, không phải UTF-8**: job vẫn hoàn tất, ghi `loi_phan_tich`, số dòng đúng 1-based. *Test: Task 5 `test_crlf_line_numbers`, `test_syntax_error_partial`, `test_invalid_utf8_does_not_crash`; Task 7 `test_broken_file_does_not_stop_job`.*
3. Project nằm ở đường dẫn **có dấu tiếng Việt và khoảng trắng**; đổi tên thư mục vẫn giữ `project_id`; thư mục **chỉ đọc** thì lưu ở thư mục app và UI biết nơi lưu. *Test: Task 3 `test_unicode_path`, `test_renamed_folder_keeps_id`, `test_readonly_falls_back`.*
4. **Symlink vòng**, symlink trỏ ra ngoài project, `.nexgraph/`, `build/` không bị quét; không treo, không đọc ngoài project. *Test: Task 4 `test_symlink_loop_terminates`, `test_symlink_outside_not_followed`, `test_nexgraph_dir_ignored`.*
5. `GET /code` với đường dẫn **ngoài project** (`../x`, tuyệt đối, symlink thoát) bị từ chối; tệp **đã đổi sau lần index** trả `stale: true`. *Test: Task 9 `test_code_rejects_path_escape`, `test_code_reports_stale`.*

---

### Task 1: Enum, hai tệp SQL và mở CSDL

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/schema/__init__.py`, `schema/enums.py`, `schema/db.py`, `schema/graph.sql` và `schema/app.sql` (chép nguyên `design/database/graph.sql`, `design/database/app.sql`)
- Modify: `engine/src/nexgraph_engine/selftest.py` (thêm `sqlite`, nạp thử schema), `engine/pyproject.toml` (thêm `pathspec`)
- Test: `engine/tests/test_schema.py`, `engine/tests/test_selftest.py` (mở rộng)

**Interfaces:**
- Produces:
  - `NodeKind`, `EdgeType`, `Confidence`, `Origin`: các `enum.StrEnum` có đúng giá trị ở Global Constraints.
  - `SCHEMA_VERSION = 1`; `class SchemaVersionError(RuntimeError)`; `class UnsupportedSqliteError(RuntimeError)`.
  - `open_graph_db(path: Path, *, read_only: bool = False) -> sqlite3.Connection` và `open_app_db(path: Path) -> sqlite3.Connection`: `row_factory = sqlite3.Row`, `foreign_keys` bật, tạo thư mục cha và áp tệp SQL khi CSDL mới (`user_version` = 0), `journal_mode=WAL` cho CSDL đồ thị ghi được; `read_only=True` mở bằng URI `mode=ro`.
  - `run_selftest()` trả thêm khoá `"sqlite"` (chuỗi phiên bản) và `ok` chỉ đúng khi schema đồ thị nạp được vào CSDL bộ nhớ.

- [ ] **Step 1: Viết test (đang fail)** trong `test_schema.py`:
  - `test_enums_match_sql`: tập giá trị của từng enum bằng đúng tập trong mệnh đề `CHECK (... IN (...))` tương ứng của `schema/graph.sql` (`loai_nut`, `loai_canh`, `muc_tin_cay`, `nguon_goc`), tách bằng regex.
  - `test_schema_files_match_design`: nếu tồn tại `design/database/graph.sql` thì nội dung bằng `schema/graph.sql` (bỏ qua khi chạy ngoài repo).
  - `test_open_is_idempotent`: mở hai lần cùng một tệp, `user_version == 1`, `PRAGMA foreign_keys == 1`.
  - `test_future_version_rejected`: đặt `user_version = 99` rồi mở thì ném `SchemaVersionError`.
  - `test_read_only_cannot_write`: `read_only=True` rồi `INSERT` ném `sqlite3.OperationalError`.
  - `test_unicode_path`: mở CSDL ở `tmp_path / "Đồ án" / "dữ liệu" / "graph.db"`.
  - Trong `test_selftest.py`: `r.json()["sqlite"]` tách thành bộ số `>= (3, 43, 0)`.
- [ ] **Step 2: Chạy** `cd engine && uv run pytest tests/test_schema.py -v`. Kỳ vọng: FAIL (`ModuleNotFoundError`).
- [ ] **Step 3: Cài đặt** các tệp ở mục Files. `UnsupportedSqliteError` ném khi `sqlite3.sqlite_version_info < (3, 43, 0)`. Thêm `pathspec` bằng `uv add pathspec`.
- [ ] **Step 4: Chạy** `uv run pytest -v`. Kỳ vọng: toàn bộ PASS (10 test cũ + mới).
- [ ] **Step 5: Kiểm bản đóng gói:** `uv run pyinstaller packaging/nexgraph-engine.spec --noconfirm` rồi chạy `dist/nexgraph-engine/nexgraph-engine serve …` và `curl /v1/selftest`. Kỳ vọng: `{"ok":true,…,"sqlite":"3.x.y"}` (xác nhận tệp `.sql` và phiên bản SQLite trong bản đóng gói).
- [ ] **Step 6: Commit** `feat(engine): schema enums, graph/app SQL and db opener`.

---

### Task 2: GraphStore (ghi và đọc đồ thị đa cạnh)

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/store/__init__.py`, `store/models.py`, `store/graph_store.py`
- Test: `engine/tests/test_graph_store.py`

**Interfaces:**
- Consumes: `open_graph_db`, enum (Task 1).
- Produces (`store/models.py`, tất cả `@dataclass(frozen=True)`):
  - `Node(id: str, kind: NodeKind, label: str, qualified_name: str, language: str | None = None, file: str | None = None, line_start: int | None = None, line_end: int | None = None, is_test: bool = False, origin: Origin = Origin.AST, signature: str | None = None, doc: str | None = None)`
  - `Edge(source: str, target: str, type: EdgeType, subtype: str | None = None, confidence: Confidence = Confidence.EXTRACTED, confidence_score: float = 1.0, origin: Origin = Origin.AST, line: int | None = None, col: int | None = None)`
  - `StoredEdge(id: int, edge: Edge, file: str | None)` (`file` = tệp của nút nguồn, tức tệp bằng chứng)
  - `UnresolvedRef(source: str, name: str, type: EdgeType, line: int, col: int)`
  - `FileRec(rel_path: str, language: str, size: int, mtime: int, sha256: str, is_test: bool)`
  - `Neighborhood(nodes: list[Node], edges: list[StoredEdge], truncated: bool)`
  - `RunState = Literal["cho", "cau_truc", "phan_giai", "hoan_tat", "loi", "huy"]`
- Produces (`GraphStore(conn: sqlite3.Connection)`):
  - `init_project(name: str, has_git: bool, project_id: str | None = None) -> str` (tạo dòng `du_an` một lần, trả `project_id`)
  - `begin_run(files_total: int = 0, commit_sha: str | None = None) -> int`; `set_run_state(run_id: int, state: RunState, *, files_done: int | None = None, files_total: int | None = None, error: str | None = None) -> None` (tự điền `ket_thuc_luc` khi trạng thái kết thúc)
  - `clear_graph() -> None` (xoá tệp, nút, cạnh, khối, tham chiếu; giữ `du_an` và lịch sử lần)
  - `add_file(run_id: int, rec: FileRec) -> int`; `add_file_error(rel_path: str, kind: str, detail: str | None) -> None` (`kind` thuộc RB4)
  - `add_nodes(nodes: Iterable[Node]) -> None` (tra `ma_tep` từ `node.file`), `add_edges(edges: Iterable[Edge]) -> int` (trả số cạnh ghi; bỏ qua cạnh trùng hoàn toàn, RB16), `add_unresolved(refs: Iterable[UnresolvedRef]) -> None`
  - `get_node(node_id: str) -> Node | None`; `neighbors(node_id: str, *, types: set[EdgeType] | None = None, direction: Literal["in", "out", "both"] = "both", depth: int = 1, limit: int = 500) -> Neighborhood`; `stats() -> dict` (`files`, `nodes_by_kind`, `edges_by_type`, `languages`, `unresolved`); `file_record(rel_path: str) -> FileRec | None`; `last_completed_run() -> tuple[int, str | None] | None` (`ket_thuc_luc` và `commit_sha` của lần `hoan_tat` gần nhất); `all_nodes(kinds: set[NodeKind] | None = None) -> Iterator[Node]`

- [ ] **Step 1: Viết test (đang fail)** trong `test_graph_store.py` (CSDL bộ nhớ qua `open_graph_db`):
  - `test_parallel_edges_kept`: hai cạnh `CALLS` cùng cặp nút, `line=10` và `line=20`, đều có trong `neighbors`; thêm lại cạnh y hệt không tạo cạnh thứ ba.
  - `test_evidence_outside_source_range_rejected`: cạnh `CALLS` có `line` ngoài khoảng dòng nút nguồn ném `sqlite3.IntegrityError` có chữ `RB22`.
  - `test_call_without_evidence_rejected` (RB12); `test_class_requires_line_range` (RB10).
  - `test_neighbors_direction_and_types`: `direction="out"` chỉ trả cạnh đi ra; lọc `types={EdgeType.CALLS}` bỏ `DEFINES`.
  - `test_neighbors_limit_sets_truncated`: 30 nút láng giềng, `limit=10` cho `len(nodes) <= 10` và `truncated is True`.
  - `test_neighbors_depth_two`: chuỗi A→B→C, `depth=2` từ A có C.
  - `test_run_lifecycle`: `begin_run` rồi `set_run_state(…, "hoan_tat")` điền `ket_thuc_luc`; `begin_run` lần hai khi còn một lần đang chạy ném `IntegrityError` (RB19).
  - `test_clear_graph_keeps_project`.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_graph_store.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `models.py` và `graph_store.py`. `neighbors` duyệt theo từng lớp BFS bằng truy vấn SQL (không nạp cả đồ thị), dừng khi đủ `limit` nút.
- [ ] **Step 4: Chạy** `uv run pytest -v`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): graph store with parallel edges, evidence and neighbors`.

---

### Task 3: Đăng ký project và nơi lưu dữ liệu

**Người:** P1 (+ P3 kiểm đường dẫn Windows)

**Files:**
- Create: `engine/src/nexgraph_engine/store/projects.py`
- Test: `engine/tests/test_projects.py`

**Interfaces:**
- Consumes: `open_app_db`, `open_graph_db`, `GraphStore` (Task 1–2).
- Produces:
  - `@dataclass(frozen=True) ProjectInfo(project_id: str, path: Path, name: str, is_git: bool, storage: Literal["in_project", "app_dir"], graph_db: Path, last_opened: int)`
  - `class ProjectRegistry(app_data_dir: Path)` với `open_project(path: Path) -> ProjectInfo`, `list_projects() -> list[ProjectInfo]` (mới mở nhất trước), `get(project_id: str) -> ProjectInfo | None`
  - Quy tắc `open_project`: (1) `path` phải là thư mục tồn tại, nếu không ném `ProjectPathError`; (2) nếu `<path>/.nexgraph/graph.db` đã có thì dùng `project_id` trong đó (**kể cả khi registry chưa biết đường dẫn này**); (3) nếu không, dùng `project_id` đã đăng ký cho đường dẫn tuyệt đối, hoặc tạo uuid4 mới; (4) thử tạo `.nexgraph/` và `.nexgraph/.gitignore` (nội dung `*\n`) rồi `graph.db`; lỗi `OSError` thì dùng `<app_data_dir>/projects/<project_id>/graph.db` và `storage="app_dir"`; (5) `is_git` = có `.git` (thư mục hoặc tệp) ở gốc; (6) cập nhật `du_an_da_mo` theo `project_id` (đường dẫn mới ghi đè đường dẫn cũ).
  - `app_data_dir/app.db` là CSDL cá nhân (`open_app_db`).

- [ ] **Step 1: Viết test (đang fail)** (`tmp_path`):
  - `test_creates_nexgraph_with_gitignore`: sau `open_project`, `.nexgraph/.gitignore` chứa đúng `*`, `.gitignore` gốc không bị tạo hay sửa.
  - `test_unicode_path`: project ở `tmp_path / "Đồ án ứng dụng" / "bookstore"`.
  - `test_renamed_folder_keeps_id`: mở, đổi tên thư mục bằng `Path.rename`, mở lại ra cùng `project_id`; `list_projects()` chỉ còn một dòng với đường dẫn mới.
  - `test_readonly_falls_back`: `chmod 0o555` thư mục project (bỏ qua test trên Windows bằng `pytest.mark.skipif`), kết quả `storage == "app_dir"` và `graph_db` nằm dưới `app_data_dir`.
  - `test_not_a_directory_rejected`; `test_git_detection`.
  - `test_registry_lists_most_recent_first`.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_projects.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `ProjectRegistry`. Tên project là tên thư mục.
- [ ] **Step 4: Chạy** `uv run pytest -v`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): project registry, .nexgraph storage with app-dir fallback`.

---

### Task 4: Quét tệp (discovery)

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/index/__init__.py`, `index/discovery.py`
- Test: `engine/tests/test_discovery.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) DiscoveredFile(rel_path: str, language: str, size: int, mtime: int, is_test: bool, oversized: bool)`
  - `discover(root: Path, *, max_file_bytes: int = 2_000_000) -> Iterator[DiscoveredFile]`: sắp xếp theo `rel_path` để kết quả ổn định.
  - `language_of(rel_path: str) -> str | None`: `.dart` → `"dart"`; ngôn ngữ khác lấy từ `graphify.detect.CODE_EXTENSIONS` (`.py` → `"python"`, `.ts`/`.tsx` → `"typescript"`, `.js`/`.jsx` → `"javascript"`, `.cs`/`.cshtml`/`.razor` → `"csharp"`); đuôi lạ trả `None` và tệp bị bỏ.
  - `is_test_path(rel_path: str) -> bool`: có thành phần `test`, `tests`, `__tests__`, `integration_test`, hoặc tên kết thúc `_test.dart`, `_test.py`, `.test.ts`, `.spec.ts`; hoặc bắt đầu `test_` với `.py`.
  - `sha256_file(path: Path) -> str` (64 ký tự hex thường).

- [ ] **Step 1: Viết test (đang fail)** với cây thư mục dựng trong `tmp_path`:
  - `test_skips_ignored_and_generated`: `build/x.dart`, `.dart_tool/y.dart`, `.nexgraph/z.dart`, `lib/a.g.dart`, `lib/b.freezed.dart`, `lib/c_generated.dart` không xuất hiện; `lib/keep.dart` có.
  - `test_respects_gitignore_root_and_nested`: `.gitignore` gốc chứa `secret/`, `.gitignore` trong `lib/` chứa `*.tmp.dart`.
  - `test_nexgraph_dir_ignored`: `.nexgraph/graph.db` và mọi tệp bên trong không xuất hiện.
  - `test_symlink_loop_terminates`: `lib/loop -> ..` (bỏ qua test trên Windows nếu tạo symlink không được); kết thúc trong 5 giây, không lặp vô hạn.
  - `test_symlink_outside_not_followed`: symlink tới tệp `.dart` ngoài project không xuất hiện.
  - `test_oversized_flagged`: tệp 3 MB có `oversized=True`.
  - `test_rel_path_uses_forward_slash` (`"lib/screens/login.dart"`) và `test_unicode_names` (`lib/màn_hình.dart`).
  - `test_is_test_path` cho các mẫu ở trên.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_discovery.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** bằng `os.walk(followlinks=False)`, bỏ mọi symlink (tệp và thư mục), `pathspec.PathSpec.from_lines("gitwildmatch", …)` cho `.gitignore` ở từng thư mục (luật của thư mục cha áp dụng cho cây con).
- [ ] **Step 4: Chạy** `uv run pytest -v`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): file discovery honoring gitignore, generated files and symlinks`.

---

### Task 5: Extractor Dart (cấu trúc, import, tham chiếu) và fixture

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/ids.py`, `engine/src/nexgraph_engine/dart/__init__.py`, `dart/extractor.py`
- Create: `engine/tests/fixtures/bookstore_app/` (project Flutter nhỏ viết tay, xem dưới)
- Test: `engine/tests/test_dart_extractor.py`

**Interfaces:**
- Consumes: `Node`, `Edge`, `UnresolvedRef` (Task 2).
- Produces:
  - `node_id(rel_path: str, qualified_name: str, kind: NodeKind) -> str` (`"{rel_path}::{qualified_name}#{kind}"`) và `file_node_id(rel_path: str) -> str` (`"{rel_path}#file"`) trong `nexgraph_engine/ids.py`; dùng chung cho mọi ngôn ngữ.
  - `@dataclass(frozen=True) FileExtraction(nodes: list[Node], edges: list[Edge], refs: list[UnresolvedRef], bindings: dict[str, dict[str, str]], errors: list[tuple[str, str]])`: `edges` chỉ chứa cạnh trong cùng tệp (`DEFINES`); `refs` chứa mọi import, kế thừa và lời gọi; `bindings[node_id]` ánh xạ tên biến → tên kiểu khai báo (trường của lớp, tham số và biến cục bộ của hàm) để Task 7 phân giải `receiver.method()`; `errors` là cặp `(loai, chi_tiet)` theo RB4.
  - `extract_dart(rel_path: str, source: bytes, *, is_test: bool) -> FileExtraction`

**Quy tắc trích xuất** (tên node theo grammar: `class_definition`, `mixin_declaration`, `enum_declaration`, `extension_declaration`, `function_signature` + `function_body` anh em, `method_signature` + `function_body`, `library_import`, `library_export`, `part_directive`; lời gọi là chuỗi `identifier` + `selector`… + `selector(argument_part)`):
- Lớp/mixin/enum/extension → nút cùng tên loại (lớp thành `widget` theo quyết định ở trên; `extension on String` không tên có `label` `"extension on String"`). Hàm cấp cao → `function`; hàm trong lớp/mixin/enum/extension → `method` với `qualified_name` `"Lớp.tên"`; getter `"Lớp.tên"`, setter `"Lớp.tên="`. `line_start` là dòng khai báo (1-based), `line_end` là dòng cuối của thân hàm hoặc `}` của lớp; `signature` là dòng khai báo cắt còn tối đa 200 ký tự. Constructor bỏ qua ở kế hoạch này.
- Tệp `is_test`: `la_kiem_thu` bật cho mọi nút trong tệp; mỗi lời gọi `test(...)`/`testWidgets(...)` có chuỗi mô tả thành nút `test` (`qualified_name` = mô tả, thêm `@<dòng>` nếu trùng id trong tệp).
- `refs`: mỗi `import/export/part` → `UnresolvedRef(source=file_node_id, name=<chuỗi uri>, type=IMPORTS, …)` kèm subtype ghi trong `name` bằng tiền tố `export:` / `part:` (import không tiền tố); `extends X` → `INHERITS`; `with M` → `INHERITS` tên `mixin:M`; `implements I` → `IMPLEMENTS`; `on B` → `INHERITS` tên `on:B`; mỗi lời gọi trong thân hàm/method → `CALLS` với `name` = chuỗi gọi (`helper`, `this.other`, `auth.login`, `Foo`, `Foo.named`), nguồn là nút hàm/method bao quanh.
- Cột là **độ lệch byte 0-based trong dòng**; dòng 1-based; mọi dòng tính theo `\n` (CRLF đúng, không đếm `\r` thành dòng).
- Lỗi: cây có `ERROR`/`MISSING` mà vẫn trích được nút → `("parse_partial", …)`; không trích được nút nào → `("parse_unusable", …)`; byte không phải UTF-8 chỉ ảnh hưởng chữ (thay `?`), không ném lỗi; tệp rỗng trả `FileExtraction` rỗng, không lỗi.

**Fixture `bookstore_app/`** (viết tay; tên tệp cố định, nội dung tối thiểu để test dưới đây đúng): `pubspec.yaml` (`name: bookstore_app`), `lib/main.dart`, `lib/router.dart`, `lib/models/user.dart`, `lib/services/api_client.dart` (`ApiClient.post`), `lib/services/auth_service.dart` (`AuthService` có trường `ApiClient`, `login()` gọi `post` hai lần ở hai dòng khác nhau), `lib/screens/login_screen.dart` (`LoginScreen extends StatefulWidget`, trạng thái `_LoginScreenState` có trường `final AuthService _auth = AuthService();` và `build()` gọi `_auth.login(...)` cùng `Navigator.pushNamed`), `lib/widgets/primary_button.dart` (`StatelessWidget`), `lib/broken.dart` (cố ý lỗi cú pháp nhưng còn một hàm hợp lệ), `test/auth_service_test.dart` (`test('...')` gọi `AuthService().login`).

- [ ] **Step 1: Viết fixture** như trên.
- [ ] **Step 2: Viết test (đang fail)** `test_dart_extractor.py` (nạp tệp fixture, tìm nút theo `qualified_name`, không dựa số dòng cứng):
  - `test_kinds`: `LoginScreen` là `widget`, `AuthService` là `class`, `AuthService.login` là `method`, hàm cấp cao là `function`, enum/mixin/extension đúng loại (dùng đoạn Dart ngắn trong test).
  - `test_ids_and_lines`: id đúng định dạng `lib/services/auth_service.dart::AuthService.login#method`; `line_start <= line_end`; dòng 1-based; `signature` của `AuthService.login` chứa tên hàm và không quá 200 ký tự.
  - `test_defines_edges`: `DEFINES` từ nút lớp đến phương thức của nó.
  - `test_two_calls_two_refs`: `AuthService.login` có hai `UnresolvedRef` `CALLS` tên `_api.post` ở hai dòng khác nhau.
  - `test_import_refs`: `import 'package:flutter/material.dart'`, `import '../services/auth_service.dart'`, `export`, `part` ra đúng tên và dòng.
  - `test_inherits_implements_mixin_refs` (đoạn Dart ngắn).
  - `test_bindings`: `bindings` của `LoginScreen`/`_LoginScreenState` có `_auth → AuthService`; của `AuthService.login` có tham số kiểu khai báo.
  - `test_test_file_nodes`: tệp trong `test/` có nút `test`, `is_test` bật.
  - `test_crlf_line_numbers`: cùng nội dung với `\r\n` cho cùng số dòng.
  - `test_bom_and_empty`; `test_syntax_error_partial` (`broken.dart` có hàm hợp lệ và `errors` chứa `parse_partial`); `test_invalid_utf8_does_not_crash`.
- [ ] **Step 3: Chạy** `uv run pytest tests/test_dart_extractor.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 4: Cài đặt** `extract_dart` bằng duyệt cây (không dùng `Query`), `Language(tree_sitter_dart.language())`; thêm `tree_sitter_dart` vào bộ nạp một lần (cache module).
- [ ] **Step 5: Chạy** `uv run pytest -v`. Kỳ vọng: PASS.
- [ ] **Step 6: Commit** `feat(engine): dart extractor with ids, refs, bindings and fixture app`.

---

### Task 6: Bộ chuyển đổi cho ngôn ngữ khác

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/index/generic.py`
- Create: `engine/tests/fixtures/py_mini/` (3 tệp `.py` nhỏ có import, lớp, hàm, một lời gọi trong cùng tệp)
- Test: `engine/tests/test_generic_extractor.py`

**Interfaces:**
- Consumes: `FileExtraction` (Task 5), `graphify.extract.extract` (đã vendor).
- Produces: `extract_generic(root: Path, rel_path: str, language: str, *, is_test: bool) -> FileExtraction`

- [ ] **Step 1: Viết test (đang fail)** trên `py_mini`:
  - `test_python_kinds_and_ids`: lớp → `class`, hàm → `function`, phương thức (nhãn của bộ trích xuất bắt đầu bằng `.`) → `method` với `qualified_name` `"Lớp.tên"`; id dùng `node_id` của Task 5; không nút nào thuộc loại khác.
  - `test_line_end_estimate_contains_evidence`: mọi cạnh `CALLS` có `line` nằm trong `[line_start, line_end]` của nút nguồn (RB22).
  - `test_imports_become_refs`: import sinh `UnresolvedRef` loại `IMPORTS`.
  - `test_intra_file_call_edge`: lời gọi tới hàm cùng tệp ra một `Edge` (trong `edges`), lời gọi tới tên không có trong tệp ra `UnresolvedRef`.
  - `test_unsupported_language_returns_error`: ngôn ngữ bộ trích xuất không đọc được trả `errors` có `("extract", …)`, không ném lỗi.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_generic_extractor.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `extract_generic`: gọi `graphify.extract.extract([root/rel_path], cache_root=<thư mục tạm>, root=root, parallel=False)` **cho từng tệp** (id của bộ trích xuất không đảm bảo duy nhất giữa các thư mục), ánh xạ nút/cạnh theo bảng: `contains` và `method` → `DEFINES`; `imports` → `UnresolvedRef(IMPORTS)`; `calls` → `CALLS` (`Edge` nếu đích cùng tệp, ngược lại `UnresolvedRef`); `confidence` giữ nguyên, `origin` = `ast`. Không sửa mã trong `engine/src/graphify/`.
- [ ] **Step 4: Chạy** `uv run pytest -v`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): adapter for non-dart languages (generic graph)`.

---

### Task 7: Bộ lập chỉ mục hai giai đoạn

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/index/indexer.py`, `index/resolver.py`
- Test: `engine/tests/test_indexer.py`, `engine/tests/test_resolver.py`

**Interfaces:**
- Consumes: Task 1–6.
- Produces:
  - `@dataclass(frozen=True) ProgressEvent(state: Literal["structure", "resolve", "done", "cancelled", "error"], files_done: int, files_total: int, message: str | None = None)`
  - `class Indexer(store: GraphStore, root: Path, *, on_progress: Callable[[ProgressEvent], None], cancel: threading.Event)` với `run() -> RunResult`; `@dataclass(frozen=True) RunResult(run_id: int, state: RunState, nodes: int, edges: int, unresolved: int, seconds: float)`
  - `resolve_references(store: GraphStore, *, package_name: str | None) -> tuple[int, int]` trong `resolver.py` (số cạnh tạo, số tham chiếu còn lại)
- Giai đoạn 1 (`cau_truc`): `begin_run` (kèm `commit_sha` lấy bằng `git rev-parse HEAD` chỉ đọc khi project có `.git`, lỗi thì `None`), `clear_graph`, `discover`, nút `.#repository` và `…#directory` với `CONTAINS`; mỗi tệp: `add_file`, trích xuất (Dart hoặc generic), `add_nodes`, nút tệp, `DEFINES` từ tệp, `add_edges`, `add_unresolved`, `add_file_error`; tiến độ phát sau mỗi tệp; mỗi 100 tệp commit một lần. Tệp `oversized` ghi `add_file_error(…, "oversized", …)` và không parse. Giai đoạn 2 (`phan_giai`): `resolve_references` rồi `hoan_tat`. `cancel` được kiểm giữa các tệp: dừng thì `huy`, giữ phần đã ghi. Mọi ngoại lệ không bắt được → `loi` kèm thông báo, không ném ra ngoài `run()`.
- Quy tắc phân giải (theo thứ tự; dừng ở mức đầu tiên có ứng viên; đúng một ứng viên thì tạo cạnh, nhiều hơn thì giữ `that_bai`):
  - `IMPORTS`: uri tương đối → so với thư mục của tệp nguồn; `package:<package_name>/x.dart` → `lib/x.dart`; còn lại (gói ngoài) giữ `that_bai`. Cạnh nguồn là nút tệp, `line/col` của import.
  - `INHERITS`/`IMPLEMENTS`: tên kiểu → lớp cùng tệp → lớp trong các tệp đã import → duy nhất trong project.
  - `CALLS`: `name` dạng `x` hoặc `this.x` → thành viên cùng lớp, rồi hàm cấp cao cùng tệp, rồi ký hiệu cấp cao trong tệp đã import; `T` hoặc `T.named` với `T` là lớp → `CALLS` tới nút lớp, subtype `construct`; `recv.x` → tra kiểu của `recv` trong `bindings` của hàm bao quanh rồi của lớp bao quanh, rồi tìm thành viên `x` của kiểu đó (ở cùng tệp, tệp đã import, duy nhất); không tra được kiểu thì **không phân giải**.
  - Cạnh mới có `confidence = INFERRED`, `origin = resolver`, điểm theo quyết định ở trên; tham chiếu đã thành cạnh bị xoá khỏi bảng, phần còn lại chuyển `that_bai`.

- [ ] **Step 1: Viết test (đang fail)** `test_resolver.py` (dựng đồ thị nhỏ bằng `GraphStore` trong bộ nhớ) và `test_indexer.py` (trên bản sao `bookstore_app` đặt ở `tmp_path / "Đồ án" / "bookstore app"`):
  - `test_relative_and_package_imports_resolved`: `login_screen.dart` có `IMPORTS` tới `lib/services/auth_service.dart` với `line` đúng dòng import; import `package:flutter/...` còn `that_bai`.
  - `test_calls_via_declared_receiver_type`: `_LoginScreenState.build` có `CALLS` tới `lib/services/auth_service.dart::AuthService.login#method` (qua `_auth`), `confidence_score` 0,9 hoặc 0,8.
  - `test_two_calls_two_edges`: `AuthService.login` có **hai** cạnh `CALLS` tới `ApiClient.post` ở hai dòng khác nhau.
  - `test_ambiguous_name_not_guessed`: hai lớp cùng tên `Dup` ở hai tệp chưa import thì lời gọi `Dup()` không ra cạnh và còn trong `that_bai`.
  - `test_inherits_resolved`; `test_constructor_call_subtype`.
  - `test_every_call_edge_has_evidence_in_source_range`: duyệt mọi cạnh trong CSDL của fixture, kiểm RB12/RB22.
  - `test_broken_file_does_not_stop_job`: `lib/broken.dart` cho `loi_phan_tich` `parse_partial`, job vẫn `hoan_tat`, các tệp khác có nút.
  - `test_reindex_is_idempotent`: chạy `run()` hai lần cho cùng số nút/cạnh và hai dòng `lan_lap_chi_muc`.
  - `test_cancel_between_files`: đặt `cancel` sau tệp đầu bằng `on_progress`, kết quả `huy`, không còn lần nào ở trạng thái `cau_truc`/`phan_giai`.
  - `test_progress_events_order`: các `state` nhận được theo thứ tự `structure…, resolve, done`; `files_done` không giảm.
  - `test_no_source_file_modified`: băm mọi tệp của project trước/sau, giống nhau; chỉ có thêm `.nexgraph/`.
  - `test_python_project_generic`: `py_mini` đi hết hai giai đoạn không lỗi.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_resolver.py tests/test_indexer.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `Indexer` và `resolve_references` theo mô tả. `package_name` đọc từ dòng `name:` đầu tiên của `pubspec.yaml` bằng regex (chưa cần YAML đầy đủ; phân tích `pubspec` là kế hoạch con 6).
- [ ] **Step 4: Chạy** `uv run pytest -v`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): two-phase indexer with reference resolution`.

---

### Task 8: Công việc nền, hủy và sự kiện

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/index/jobs.py`, `index/events.py`
- Test: `engine/tests/test_jobs.py`

**Interfaces:**
- Consumes: `Indexer`, `ProjectRegistry`, `GraphStore` (Task 2, 3, 7).
- Produces:
  - `class EventBus` với `publish(event: dict) -> None` (an toàn đa luồng) và `subscribe() -> Subscription`; `Subscription.get(timeout: float | None = None) -> dict | None`, `close() -> None`; hàng đợi tối đa 1.000 sự kiện, đầy thì bỏ sự kiện `job_progress` cũ nhất, **không bao giờ bỏ** `graph_updated`.
  - `class JobManager(registry: ProjectRegistry, bus: EventBus)`: `start_index(project_id: str) -> str` (job_id), `get(job_id: str) -> dict | None` (hình dạng `Job` ở trên), `cancel(job_id: str) -> bool`, `shutdown() -> None`; `class IndexAlreadyRunning(RuntimeError)`, `class UnknownProject(KeyError)`.
  - Sự kiện: `{"type": "job_progress", **Job}`; `{"type": "graph_updated", "project_id": str}` phát khi giai đoạn 1 xong và khi giai đoạn 2 xong. Chỉ một job `structure|resolve` mỗi project (RB19). Mỗi job chạy trong một luồng riêng với kết nối CSDL riêng.

- [ ] **Step 1: Viết test (đang fail)** (fixture `bookstore_app`):
  - `test_job_runs_to_done_and_emits_events`: có `job_progress` với `state` theo thứ tự và đúng hai `graph_updated`.
  - `test_second_start_while_running_rejected`: `start_index` lần hai ném `IndexAlreadyRunning` (dùng `threading.Event` giữ job đầu bằng `on_progress` giả hoặc project đủ lớn).
  - `test_cancel_running_job`: `cancel` trả `True`, job kết thúc `cancelled`.
  - `test_unknown_project_and_job`.
  - `test_slow_subscriber_does_not_block_publisher` và `test_graph_updated_never_dropped`.
  - `test_reader_can_query_during_index`: trong lúc job chạy, một kết nối đọc `open_graph_db(read_only=True)` vẫn `SELECT count(*) FROM nut` được (WAL).
- [ ] **Step 2: Chạy** `uv run pytest tests/test_jobs.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** `EventBus` và `JobManager` bằng `threading.Thread`; trạng thái job lưu trong bộ nhớ (mất khi engine thoát, chấp nhận được).
- [ ] **Step 4: Chạy** `uv run pytest -v`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(engine): background index jobs with cancel and event bus`.

---

### Task 9: Route `/v1` và hợp đồng JSON

**Người:** P1

**Files:**
- Create: `engine/src/nexgraph_engine/api/routes_projects.py`, `api/routes_graph.py`, `api/routes_events.py`, `api/serialize.py`
- Modify: `engine/src/nexgraph_engine/api/app.py` (`create_app` nhận `data_dir`), `engine/src/nexgraph_engine/cli.py` (truyền `--data-dir`), `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md` (thêm mục "Hình dạng JSON v1" ở trên)
- Test: `engine/tests/test_api_projects.py`, `engine/tests/test_api_graph.py`, `engine/tests/test_api_events.py`

**Interfaces:**
- Consumes: Task 2, 3, 8.
- Produces:
  - `create_app(token: str, allowed_hosts: set[str], *, data_dir: Path | None = None) -> FastAPI` (`None` dùng thư mục tạm; hai test cũ giữ nguyên).
  - `POST /v1/projects {"path"}` → `{project_id, path, name, is_git, storage}` (`400 bad_path` nếu không phải thư mục); `GET /v1/projects` → mảng `{project_id, path, name, is_git, storage, last_indexed_at, last_index_commit}` (hai trường cuối từ `last_completed_run()` bằng kết nối chỉ đọc; `null` khi CSDL chưa có hoặc chưa index xong).
  - `POST /v1/projects/{pid}/index` → `202 {job_id}` (`404 unknown_project`, `409 index_running`); `GET /v1/jobs/{id}` → `Job` (`404 unknown_job`); `DELETE /v1/jobs/{id}` → `{cancelled: bool}`.
  - `GET /v1/events` (SSE, `text/event-stream`): mỗi sự kiện là `data: <json>\n\n`; gửi dòng `: ping` mỗi 15 giây.
  - `GET /v1/projects/{pid}/stats` → `{files, nodes_by_kind, edges_by_type, languages, unresolved}`.
  - `GET /v1/projects/{pid}/nodes/{node_id:path}` → `Node` (`404 unknown_node`).
  - `GET /v1/projects/{pid}/neighbors?node&types&direction=both&depth=1&limit=500` → `{nodes: [Node], edges: [Edge], truncated}`; `depth` 1–3, `limit` 1–2000 (ngoài khoảng → `400 bad_param`); `types` là danh sách phân cách bằng dấu phẩy.
  - `GET /v1/projects/{pid}/code?file&start&end` → `{file, start, end, text, language, stale}`; `file` phải là đường dẫn tương đối nằm trong project sau khi `resolve()` (ngược lại `400 bad_path` hoặc `403 outside_project`); không có tệp → `404 file_not_found`; `stale = true` khi mã băm hiện tại khác `ma_bam` đã lưu; `start/end` mặc định cả tệp, tối đa 2.000 dòng mỗi lần.

- [ ] **Step 1: Viết test (đang fail)** (`TestClient`; index `bookstore_app` bằng đồng bộ chờ job `done`):
  - `test_open_project_and_list`; `test_open_missing_path_400`.
  - `test_index_then_stats_nonzero`; `test_index_twice_409_while_running`.
  - `test_neighbors_of_file_node` (cạnh `IMPORTS` có `evidence.file` và `evidence.line`); `test_neighbors_param_validation`; `test_neighbors_truncated`.
  - `test_node_by_path_id` (id chứa `/`, `::`, `#`, ký tự Unicode, được mã hoá URL).
  - `test_code_returns_lines_and_language`; **`test_code_rejects_path_escape`** (`../x`, `/etc/passwd`, `lib/../../x`, symlink trỏ ra ngoài); **`test_code_reports_stale`** (sửa tệp sau khi index thì `stale` là `true`); `test_code_missing_file_404`.
  - `test_events_stream_receives_progress`: `client.stream("GET", "/v1/events")` nhận `job_progress` rồi `graph_updated` sau khi gọi index.
  - `test_all_routes_require_token_and_host` (kể cả `/v1/events`).
- [ ] **Step 2: Chạy** `uv run pytest tests/test_api_*.py -v`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** route; `serialize.py` chuyển `Node`/`StoredEdge` sang JSON đúng hình dạng; SSE bằng `StreamingResponse` đọc `Subscription` trong thread pool. Cập nhật roadmap.
- [ ] **Step 4: Chạy** `uv run pytest -v`. Kỳ vọng: PASS.
- [ ] **Step 5: Kiểm bản đóng gói:** build lại PyInstaller, chạy engine, dùng `curl` mở project `tests/fixtures/bookstore_app`, index, rồi `GET stats`. Kỳ vọng: số nút > 0.
- [ ] **Step 6: Commit** `feat(engine): v1 projects, index jobs, events, nodes, neighbors and code routes`.

---

### Task 10: Client engine, SSE và IPC ở Electron main

**Người:** P2

**Files:**
- Create: `apps/desktop/src/shared/graph-types.ts`, `apps/desktop/src/main/engine/api.ts`, `apps/desktop/src/main/engine/events.ts`, `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/shared/api.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/test/fixtures/fake-engine.mjs`
- Test: `apps/desktop/test/engine-api.test.ts`, `apps/desktop/test/sse.test.ts`

**Interfaces:**
- Consumes: JSON v1 (Task 9), `EngineHandle` (kế hoạch con 1).
- Produces:
  - `graph-types.ts`: `GraphNode`, `GraphEdge`, `Job`, `Neighborhood` đúng hình dạng JSON v1; `ProjectSummary = { project_id: string; path: string; name: string; storage: 'in_project' | 'app_dir'; is_git?: boolean; last_indexed_at?: number | null; last_index_commit?: string | null }`; `EngineEvent = ({ type: 'job_progress' } & Job) | { type: 'graph_updated'; project_id: string }`.
  - `class EngineApi(h: Pick<EngineHandle, 'baseUrl' | 'token'>)` với `openProject(path: string)`, `listProjects()`, `startIndex(pid: string)`, `getJob(id: string)`, `cancelJob(id: string)`, `stats(pid: string)`, `getNode(pid: string, id: string)`, `neighbors(pid: string, q: { node: string; types?: string[]; direction?: 'in' | 'out' | 'both'; depth?: number; limit?: number })`, `code(pid: string, file: string, start?: number, end?: number)`; lỗi HTTP ném `EngineApiError` có `code` và `status`.
  - `events.ts`: `parseSse(buffer: string): { events: unknown[]; rest: string }` (thuần, xử lý sự kiện bị cắt giữa các chunk, dòng `:` là comment) và `subscribeEvents(h, onEvent: (e: EngineEvent) => void, onClose: () => void): () => void` (đọc `fetch` stream, trả hàm huỷ).
  - Thêm vào `NexGraphApi` (`shared/api.ts`): `project: { pickFolder(): Promise<string | null>; open(path: string): Promise<ProjectSummary>; list(): Promise<ProjectSummary[]> }`, `index: { start(pid: string): Promise<{ jobId: string }>; cancel(jobId: string): Promise<void>; onEvent(cb: (e: EngineEvent) => void): () => void }`, `graph: { stats(pid: string): Promise<unknown>; neighbors(pid: string, q: …): Promise<Neighborhood>; node(pid: string, id: string): Promise<GraphNode>; code(pid: string, file: string, start?: number, end?: number): Promise<unknown> }`.
  - IPC: `project:pick-folder` (dùng `dialog.showOpenDialog`, chỉ chọn thư mục), `project:open`, `project:list`, `index:start`, `index:cancel`, `graph:*`; sự kiện đẩy `engine:event`. Khi engine khởi động lại, main đăng ký lại SSE.

- [ ] **Step 1: Mở rộng `fake-engine.mjs`**: trả JSON mẫu cho `/v1/projects`, `/v1/projects/p1/neighbors`, `/v1/events` (SSE, gửi một `job_progress` rồi một `graph_updated` sau 50 ms); lỗi `404 unknown_node` cho id lạ.
- [ ] **Step 2: Viết test (đang fail):**
  - `sse.test.ts`: `parseSse` với sự kiện đủ, sự kiện bị cắt giữa `data:` làm hai chunk, hai sự kiện một chunk, dòng `: ping` bị bỏ qua, JSON hỏng bị bỏ qua mà không ném.
  - `engine-api.test.ts` (chạy với `fake-engine`): `openProject`, `neighbors` gửi đúng query (`types` nối bằng dấu phẩy), lỗi 404 ném `EngineApiError` có `code === 'unknown_node'`, `subscribeEvents` nhận hai sự kiện rồi huỷ được, đường dẫn có dấu tiếng Việt trong `openProject` đi nguyên vẹn.
- [ ] **Step 3: Chạy** `pnpm --filter @nexgraph/desktop vitest run test/sse.test.ts test/engine-api.test.ts`. Kỳ vọng: FAIL.
- [ ] **Step 4: Cài đặt** `api.ts`, `events.ts`, `ipc.ts`; nối vào `EngineSupervisor`: có handle mới thì tạo `EngineApi` và mở SSE, chuyển từng sự kiện tới renderer.
- [ ] **Step 5: Chạy** `pnpm --filter @nexgraph/desktop typecheck && pnpm --filter @nexgraph/desktop test`. Kỳ vọng: PASS.
- [ ] **Step 6: Commit** `feat(desktop): engine api client, sse events and ipc for projects and graph`.

---

### Task 11: Màn hình Dự án và Đang lập chỉ mục

**Người:** P2

**Files:**
- Create: `apps/desktop/src/renderer/src/strings.ts`, `renderer/src/screens/ProjectsScreen.tsx`, `renderer/src/screens/IndexingScreen.tsx`, `renderer/src/state/useIndexJob.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`, `styles.css`
- Test: `apps/desktop/src/renderer/src/screens/ProjectsScreen.test.tsx`, `IndexingScreen.test.tsx`

**Interfaces:**
- Consumes: `window.nexgraph.project/index` (Task 10), `EngineStatusBar` (kế hoạch con 1).
- Produces:
  - `strings.ts`: toàn bộ chuỗi tiếng Việt của hai màn hình (mặc định tiếng Việt; i18n đầy đủ ở kế hoạch con 6).
  - `ProjectsScreen({ onOpened: (p: ProjectSummary) => void })`: nút "Mở thư mục…", danh sách dự án gần đây (từ `project.list`), lỗi mở hiển thị bằng chữ; nút bị khoá khi engine chưa `ready`.
  - `IndexingScreen({ project, onExplore: () => void })`: hiển thị hai giai đoạn ("Đọc cấu trúc", "Nối quan hệ") với thanh tiến độ, `files_done / files_total`, nút "Hủy", và nút **"Bắt đầu khám phá"** chỉ bật khi giai đoạn 1 xong (`state` là `resolve` hoặc `done`) theo spec §5.5.
  - `App.tsx` điều hướng `projects → indexing → workspace` bằng một biến trạng thái.

- [ ] **Step 1: Viết test (đang fail)** (giả `window.nexgraph` bằng `vi.stubGlobal`):
  - `ProjectsScreen`: bấm "Mở thư mục…" gọi `pickFolder` rồi `open`; người dùng huỷ hộp thoại (`null`) thì không gọi `open`; lỗi `bad_path` hiện thông báo; nút khoá khi `engine` chưa sẵn sàng.
  - `IndexingScreen`: sự kiện `structure` 40/100 hiện "40 / 100" và nút "Bắt đầu khám phá" tắt; sự kiện `resolve` bật nút; `cancelled` hiện thông báo đã huỷ; `error` hiện nội dung lỗi; bấm "Hủy" gọi `index.cancel`; sự kiện của project khác bị bỏ qua.
- [ ] **Step 2: Chạy** `pnpm --filter @nexgraph/desktop vitest run src/renderer/src/screens`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** hai màn hình và hook `useIndexJob(projectId)` (đăng ký `index.onEvent`, trả `{ job, startedAt }`, huỷ đăng ký khi unmount).
- [ ] **Step 4: Chạy** `pnpm --filter @nexgraph/desktop typecheck && pnpm --filter @nexgraph/desktop test`. Kỳ vọng: PASS.
- [ ] **Step 5: Commit** `feat(desktop): projects and indexing screens`.

---

### Task 12: Thẻ Graph v0 (React Flow + ELK trong Web Worker)

**Người:** P2

**Files:**
- Create: `apps/desktop/src/renderer/src/screens/WorkspaceScreen.tsx`, `renderer/src/components/graph/GraphCanvas.tsx`, `graph/NodeInspector.tsx`, `graph/kindStyle.ts`, `renderer/src/services/elkLayoutService.ts`, `renderer/src/services/elk.worker.ts`
- Modify: `apps/desktop/package.json` (`@xyflow/react`, `elkjs`), `renderer/src/App.tsx`
- Test: `apps/desktop/src/renderer/src/services/elkLayoutService.test.ts`, `renderer/src/components/graph/GraphCanvas.test.tsx`

**Interfaces:**
- Consumes: `window.nexgraph.graph.neighbors/node` (Task 10).
- Produces:
  - `layoutGraph(nodes: { id: string; width: number; height: number }[], edges: { id: string; source: string; target: string }[]): Promise<Record<string, { x: number; y: number }>>` trong `elkLayoutService.ts`: gửi bài toán tới `elk.worker.ts` (Web Worker) và trả toạ độ; tách phần thuần `toElkGraph(...)` để test không cần Worker.
  - `kindStyle(kind: NodeKind): { color: string; label: string }`: màu theo token spec (`class` `#1f5fbf`, `widget` `#6a4fb3`, `function`/`method` `#0f7c78`, `file` `#5b6b7d`, `test` `#2e7d4f`, loại khác `#5b6b7d`).
  - `GraphCanvas({ projectId, startNodeId, onSelect })`: nạp `neighbors(depth=1, limit=2000)` quanh nút đang chọn (mặc định `.#repository`), dựng React Flow bằng `layoutGraph`; bấm một nút thì chuyển tâm sang nút đó và mở `NodeInspector` (nhãn, loại, `file:line_start–line_end`); `truncated` hiện dòng "Đã cắt bớt, thu hẹp bằng cách chọn nút khác"; không bao giờ vẽ quá 2.000 nút.
  - `WorkspaceScreen({ project })` có thanh bên tối thiểu và một thẻ "Graph"; các thẻ khác ở kế hoạch con sau.

- [ ] **Step 1: Viết test (đang fail):**
  - `elkLayoutService.test.ts`: `toElkGraph` giữ đủ nút và cạnh; với `elkjs/lib/elk.bundled.js` chạy trong Node, mỗi nút có `x`, `y` hữu hạn và không có hai nút trùng toạ độ (đồ thị 50 nút, 80 cạnh); đồ thị rỗng trả `{}`; cạnh trỏ tới nút không có trong danh sách bị bỏ, không ném lỗi.
  - `GraphCanvas.test.tsx` (`// @vitest-environment jsdom`, giả `ResizeObserver` và `DOMMatrixReadOnly` vì React Flow cần; `layoutGraph` giả trả toạ độ cố định): với `neighbors` trả 5 nút, DOM có 5 nút React Flow; bấm một nút gọi lại `neighbors` với `node` đó; `truncated: true` hiện thông báo cắt bớt; lỗi `unknown_node` hiện thông báo thay vì trắng màn hình; `NodeInspector` hiện `file:line` của nút đã chọn.
- [ ] **Step 2: Chạy** `pnpm --filter @nexgraph/desktop vitest run src/renderer/src/services src/renderer/src/components/graph`. Kỳ vọng: FAIL.
- [ ] **Step 3: Cài đặt** các tệp; Worker nạp bằng `new Worker(new URL('./elk.worker.ts', import.meta.url), { type: 'module' })` (Vite/electron-vite bó sẵn); thêm hai gói bằng `pnpm --filter @nexgraph/desktop add @xyflow/react@12 elkjs@0.12`.
- [ ] **Step 4: Chạy** `pnpm --filter @nexgraph/desktop typecheck && pnpm --filter @nexgraph/desktop test && pnpm --filter @nexgraph/desktop build`. Kỳ vọng: PASS, build không cảnh báo thiếu Worker.
- [ ] **Step 5: Kiểm tay** (`pnpm --filter @nexgraph/desktop dev`): mở `engine/tests/fixtures/bookstore_app`, chờ giai đoạn 1 xong, bấm "Bắt đầu khám phá", bấm vài nút trong Graph. Kỳ vọng: thấy `.#repository` → thư mục → tệp → ký hiệu; chọn `LoginScreen` thấy cạnh `IMPORTS`/`CALLS` tới `AuthService`.
- [ ] **Step 6: Commit** `feat(desktop): graph tab v0 with react flow and elk worker`.

---

### Task 13: Tích hợp, đo hiệu năng và tài liệu

**Người:** P1 (đo) + P3 (kiểm Windows, test plan)

**Files:**
- Create: `engine/scripts/bench_index.py`, `engine/tests/test_e2e_bookstore.py`, `docs/benchmarks/2026-10-index-tier-s.md`
- Modify: `docs/superpowers/plans/2026-10-18-nexgraph-roadmap.md`, `docs/srs/use-cases/UC01.md`, `UC03.md`, `UC05.md` (đối chiếu API thực), `docs/install-notes.md`

**Interfaces:**
- Consumes: toàn bộ Task 1–12.
- Produces: `python scripts/bench_index.py <thư-mục-project>` in thời gian từng giai đoạn, số tệp, nút, cạnh theo loại, số tham chiếu chưa phân giải, RAM đỉnh (`resource.getrusage`), và thời gian mở lại (mở `graph.db` rồi `stats()`).

- [ ] **Step 1: Viết `test_e2e_bookstore.py`**: qua `TestClient` mở bản sao `bookstore_app` ở đường dẫn có dấu, index, chờ `done`, kiểm các sự thật của kịch bản demo bước 2–3 ở mức dữ liệu: có cạnh `IMPORTS` từ `login_screen.dart` tới `auth_service.dart`; có đường `LoginScreen.build → AuthService.login → ApiClient.post` chỉ qua cạnh `CALLS` (duyệt bằng `neighbors`, `depth=3`); mọi cạnh `CALLS/IMPORTS` có bằng chứng; index lần hai ra cùng số nút; mở lại CSDL chỉ đọc đọc được ngay.
- [ ] **Step 2: Chạy** `uv run pytest tests/test_e2e_bookstore.py -v`. Kỳ vọng: PASS (nếu FAIL do dữ liệu, sửa extractor/resolver ở task tương ứng và thêm test hồi quy ở đó).
- [ ] **Step 3: Đo** `bench_index.py` trên: một project Flutter cá nhân (98 tệp), một app mẫu công khai (project vừa) và toàn bộ bộ mã mẫu công khai đó (484 tệp). Ghi vào `docs/benchmarks/2026-10-index-tier-s.md`: cấu hình máy, số liệu, so với mục tiêu tầng S (< 60 s lần đầu, < 3 s mở lại), cảnh báo nếu vượt. **Không cam kết** số liệu khi chưa đạt, ghi nút thắt đo được.
- [ ] **Step 4: Kiểm trên Windows** (P3): `uv run pytest` trong `engine/`, mở `bookstore_app` ở đường dẫn có dấu và khoảng trắng, index xong, xem thẻ Graph. Ghi kết quả vào `docs/install-notes.md`; thất bại ghi rõ lỗi và mở issue.
- [ ] **Step 5: Đồng bộ tài liệu:** cập nhật UC01/UC03/UC05 cho khớp tên route và trường thực tế; thêm vào roadmap hình dạng JSON v1 nếu chưa; cập nhật `docs/project/tong-quan.md` và `nhat-ky.md` ở workspace đồ án.
- [ ] **Step 6: Commit** `test(engine): e2e index of bookstore fixture; docs: tier S benchmark`.

---

## Kết thúc sprint (tuần 3)

- [ ] Kịch bản mở app → chọn thư mục project Flutter → index → xem lân cận trên thẻ Graph chạy trên macOS và Windows (Task 13 Step 4).
- [ ] `docs/benchmarks/2026-10-index-tier-s.md` có số liệu thật, kể cả khi chưa đạt mục tiêu.
- [ ] CI xanh trên `main` (cần remote GitHub, xem kế hoạch con 1) và bản cài vẫn qua smoke test (`selftest` đã kiểm `sqlite` và schema).
- [ ] Cập nhật mục "Kế hoạch con 3" của roadmap theo những gì đo được (parse song song, cache theo mã băm, FTS5, kiến trúc).
- [ ] Sprint review: ghi dòng **Tuần 3** vào phiếu theo dõi tiến độ, nội dung theo nhiệm vụ GVHD giao cho tuần 3 (hiện chưa có; nội dung nội bộ: "Cài đặt lược đồ CSDL đồ thị, bộ lập chỉ mục hai giai đoạn cho Dart/Flutter, giao diện xem đồ thị v0").
- [ ] Viết kế hoạch con 3 (tuần 4) chi tiết theo cùng mẫu.
