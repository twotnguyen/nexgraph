"""NG-IMP-1/2/3: nạp graph.json của vendor Graphify vào graph.db (ADR 0023)."""
import json
import shutil
import sqlite3
from pathlib import Path

from nexgraph_engine.changes.model import ChangeSet, FileChange
from nexgraph_engine.graphify_import import changed_files_from_manifest, import_graph_json, replace_files
from nexgraph_engine.impact import analyze as impact
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.search import search

FIXTURES = Path(__file__).parent / "fixtures"
APP = FIXTURES / "graphify_import_app"
SNAPSHOTS = FIXTURES / "graphify_import_snapshots"


def make_project(tmp_path: Path, snapshot: str = "base") -> Path:
    """Bản sao fixture + graph.json của vendor đặt đúng `<root>/.nexgraph/` như production."""
    root = tmp_path / "Đồ án" / "graphify app"
    shutil.copytree(APP, root)
    out = root / ".nexgraph"
    out.mkdir()
    shutil.copy(SNAPSHOTS / snapshot / "graph.json", out / "graph.json")
    shutil.copy(SNAPSHOTS / snapshot / "manifest.json", out / "manifest.json")
    analysis = SNAPSHOTS / snapshot / "analysis.json"
    if analysis.exists():
        shutil.copy(analysis, out / ".graphify_analysis.json")
    return root


def open_store(tmp_path: Path) -> tuple[GraphStore, sqlite3.Connection]:
    conn = open_graph_db(tmp_path / "graph.db")
    return GraphStore(conn), conn


def test_import_fixture_counts_and_queries(tmp_path):
    root = make_project(tmp_path)
    store, conn = open_store(tmp_path)
    report = import_graph_json(store, root, root / ".nexgraph" / "graph.json")

    assert report.files == 4
    assert report.nodes == 18
    assert report.edges == 30
    assert report.communities == 3
    assert report.tested_by == 3
    assert report.missing_files == ()

    # Id ổn định: nút tệp theo `ids.file_node_id`, nút ký hiệu theo `<id vendor>#<kind>`.
    file_node = store.get_node("app.py#file")
    assert file_node is not None and file_node.file == "app.py"
    greet = store.get_node("app_greet#function")
    assert greet is not None and greet.line_start == 4 and greet.qualified_name == "app.py::greet()"

    # FTS5 tìm được
    assert "app_greet#function" in {n.id for n, _ in search(conn, "greet")}

    # neighbors
    neighborhood = store.neighbors("util.ts#file", depth=1)
    assert {"util_add#function", "util_counter#class"} <= {n.id for n in neighborhood.nodes}

    # tests_for: test gọi greet() (và shout() gọi greet) trong tệp test → TESTED_BY sinh sau khi nạp
    assert {n.id for n in impact.tests_for(conn, "app_greet#function")} == {
        "test_app_test_greet#function", "test_app_test_shout#function"}

    # impact.analyze tìm hạt giống là nút tệp và trả ký hiệu trong khoảng dòng
    changes = ChangeSet(base="last_index", base_commit=None,
                        files=[FileChange(path="app.py", status="M", ranges=[(4, 5)])])
    report = impact.analyze(conn, changes)
    assert "app_greet#function" in {n.id for n in report.changed_nodes}

    # Toàn vẹn schema v8
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_reimport_replaces_previous_graph(tmp_path):
    root = make_project(tmp_path)
    store, conn = open_store(tmp_path)
    import_graph_json(store, root, root / ".nexgraph" / "graph.json")
    report = import_graph_json(store, root, root / ".nexgraph" / "graph.json")
    assert report.nodes == 18 and report.edges == 30
    assert conn.execute("SELECT count(*) FROM nut").fetchone()[0] == 18
    assert conn.execute("SELECT count(*) FROM tep").fetchone()[0] == 4


def _nut_rows(conn) -> dict[str, dict]:
    return {row["id_nut"]: dict(row) for row in conn.execute(
        "SELECT id_nut, loai_nut, dong_bat_dau, dong_ket_thuc, chu_ky, nguon_goc FROM nut")}


def test_enrich_reads_real_spans_and_signatures(tmp_path):
    """NG-IMP-2: dòng kết thúc/chữ ký/loại nút đọc lại từ tệp nguồn, không dựng đồ thị lần hai."""
    root = make_project(tmp_path)
    store, conn = open_store(tmp_path)
    report = import_graph_json(store, root, root / ".nexgraph" / "graph.json")
    assert report.enriched_nodes > 0
    rows = _nut_rows(conn)

    assert (rows["app_greet#function"]["dong_bat_dau"], rows["app_greet#function"]["dong_ket_thuc"]) == (4, 5)
    assert (rows["app_shout#function"]["dong_bat_dau"], rows["app_shout#function"]["dong_ket_thuc"]) == (8, 9)
    assert (rows["app_greeter#class"]["dong_bat_dau"], rows["app_greeter#class"]["dong_ket_thuc"]) == (12, 17)
    assert (rows["app_greeter_init#method"]["dong_bat_dau"], rows["app_greeter_init#method"]["dong_ket_thuc"]) == (13, 14)
    assert (rows["app_greeter_hello#method"]["dong_bat_dau"], rows["app_greeter_hello#method"]["dong_ket_thuc"]) == (16, 17)
    assert rows["app_greeter_init#method"]["loai_nut"] == "method"
    assert rows["app_greet#function"]["chu_ky"] == "def greet(name: str) -> str"
    assert rows["app_greeter#class"]["chu_ky"] == "class Greeter"

    # TypeScript: cùng một bước đọc span
    assert (rows["util_add#function"]["dong_bat_dau"], rows["util_add#function"]["dong_ket_thuc"]) == (1, 3)
    assert (rows["util_twice#function"]["dong_bat_dau"], rows["util_twice#function"]["dong_ket_thuc"]) == (5, 7)
    assert (rows["util_counter#class"]["dong_bat_dau"], rows["util_counter#class"]["dong_ket_thuc"]) == (9, 16)
    assert (rows["util_counter_increment#method"]["dong_bat_dau"],
            rows["util_counter_increment#method"]["dong_ket_thuc"]) == (12, 15)
    assert rows["util_add#function"]["chu_ky"] == "function add(a: number, b: number): number"

    # Nút đọc được từ AST mang cờ `ast`
    assert rows["app_greet#function"]["nguon_goc"] == "ast"
    # sha256 tệp tính từ đĩa
    import hashlib
    assert conn.execute("SELECT ma_bam FROM tep WHERE duong_dan_tuong_doi = 'app.py'").fetchone()[0] == \
        hashlib.sha256((root / "app.py").read_bytes()).hexdigest()


def test_enrich_marks_estimated_fields_when_source_missing(tmp_path):
    root = tmp_path / "du-an"
    root.mkdir()
    (root / "a.py").write_text("def f():\n    pass\n", encoding="utf-8")
    out = root / ".nexgraph"
    out.mkdir()
    (out / "graph.json").write_text(json.dumps({
        "nodes": [
            {"id": "a_f", "label": "f()", "_callable": True, "_origin": "ast",
             "source_file": "a.py", "source_location": "L1"},
            {"id": "ghost_g", "label": "g()", "_callable": True, "_origin": "ast",
             "source_file": "ghost.py", "source_location": "L7"},
        ],
        "links": [],
    }), encoding="utf-8")

    store, conn = open_store(tmp_path)
    report = import_graph_json(store, root, out / "graph.json")
    assert report.missing_files == ("ghost.py",)
    rows = _nut_rows(conn)
    assert (rows["a_f#function"]["dong_ket_thuc"], rows["a_f#function"]["nguon_goc"]) == (2, "ast")
    # Tệp không có trên đĩa: giữ giá trị ước lượng và ghi cờ nguồn `resolver`
    assert (rows["ghost_g#function"]["dong_ket_thuc"], rows["ghost_g#function"]["nguon_goc"]) == (7, "resolver")
    assert conn.execute("SELECT ma_bam FROM tep WHERE duong_dan_tuong_doi = 'ghost.py'").fetchone()[0] == "0" * 64


def _graph_snapshot(conn) -> tuple[set, set, set]:
    nodes = {(r["id_nut"], r["loai_nut"], r["dong_bat_dau"], r["dong_ket_thuc"], r["chu_ky"],
              r["nguon_goc"], r["cong_dong"])
             for r in conn.execute(
                 "SELECT n.id_nut, n.loai_nut, n.dong_bat_dau, n.dong_ket_thuc, n.chu_ky, n.nguon_goc,"
                 " k.ten AS cong_dong FROM nut n LEFT JOIN khoi_kien_truc k ON k.ma_khoi = n.ma_khoi")}
    edges = {(r["s"], r["d"], r["loai_canh"], r["loai_con"], r["dong_bang_chung"]) for r in conn.execute(
        "SELECT ns.id_nut AS s, nd.id_nut AS d, c.loai_canh, c.loai_con, c.dong_bang_chung"
        " FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich")}
    communities = {(r["ma_khoi"], r["ten"], r["do_gan_ket"]) for r in conn.execute(
        "SELECT ma_khoi, ten, do_gan_ket FROM khoi_kien_truc")}
    return nodes, edges, communities


def test_replace_files_matches_full_import(tmp_path):
    """NG-IMP-3: sửa 1 tệp, dựng lại graph.json, nạp tăng dần cho kết quả bằng nạp đầy đủ."""
    root = make_project(tmp_path)
    store, conn = open_store(tmp_path)
    import_graph_json(store, root, root / ".nexgraph" / "graph.json")

    changed = changed_files_from_manifest(
        json.loads((SNAPSHOTS / "base" / "manifest.json").read_text(encoding="utf-8")),
        json.loads((SNAPSHOTS / "updated" / "manifest.json").read_text(encoding="utf-8")))
    assert "util.ts" in changed

    # "Sửa" tệp fixture và thay graph.json bằng bản vendor dựng lại
    shutil.copy(SNAPSHOTS / "updated" / "util.ts", root / "util.ts")
    shutil.copy(SNAPSHOTS / "updated" / "graph.json", root / ".nexgraph" / "graph.json")
    report = replace_files(store, changed, root / ".nexgraph" / "graph.json")
    assert report.files_changed >= 1
    assert store.get_node("util_triple#function") is not None

    full_store, full_conn = open_store(tmp_path / "full")
    import_graph_json(full_store, root, root / ".nexgraph" / "graph.json")
    assert _graph_snapshot(conn) == _graph_snapshot(full_conn)


def test_replace_files_syncs_communities_on_new_symbol(tmp_path):
    """QA #67.1 (repro của QA): thêm hàm vào app.py, manifest chỉ đổi app.py.

    Cộng đồng + quan hệ thành viên phải được đồng bộ như nạp đầy đủ, kể cả nút ở tệp
    không đổi nếu graph.json mới phân nhóm lại.
    """
    root = make_project(tmp_path)
    store, conn = open_store(tmp_path)
    import_graph_json(store, root, root / ".nexgraph" / "graph.json")

    changed = changed_files_from_manifest(
        json.loads((SNAPSHOTS / "base" / "manifest.json").read_text(encoding="utf-8")),
        json.loads((SNAPSHOTS / "app_change" / "manifest.json").read_text(encoding="utf-8")))
    assert changed == ["app.py"]
    shutil.copy(SNAPSHOTS / "app_change" / "app.py", root / "app.py")
    shutil.copy(SNAPSHOTS / "app_change" / "graph.json", root / ".nexgraph" / "graph.json")
    replace_files(store, changed, root / ".nexgraph" / "graph.json")

    full_store, full_conn = open_store(tmp_path / "full-app")
    import_graph_json(full_store, root, root / ".nexgraph" / "graph.json")
    assert _graph_snapshot(conn) == _graph_snapshot(full_conn)

    # Ký hiệu mới phải có cộng đồng như bản nạp đầy đủ, không phải NULL.
    assert conn.execute(
        "SELECT k.ten FROM nut n JOIN khoi_kien_truc k ON k.ma_khoi = n.ma_khoi"
        " WHERE n.id_nut = 'app_farewell#function'").fetchone()[0] == "Community 0"


def test_rejects_paths_outside_root_before_io(tmp_path):
    """QA #67.2: symlink ra ngoài, `../`, đường dẫn tuyệt đối bị bỏ trước khi đọc tệp."""
    root = make_project(tmp_path)
    outside = tmp_path / "ngoai.py"
    outside.write_text("def secret():\n    pass\n", encoding="utf-8")
    (root / "link.py").symlink_to(outside)
    (root / "alias.py").symlink_to(root / "app.py")

    (root / ".nexgraph" / "graph.json").write_text(json.dumps({
        "nodes": [
            {"id": "abs_ok", "label": "abs_ok()", "_callable": True, "_origin": "ast",
             "source_file": str(root / "app.py"), "source_location": "L1"},
            {"id": "alias_ok", "label": "alias_ok()", "_callable": True, "_origin": "ast",
             "source_file": "alias.py", "source_location": "L1"},
            {"id": "link_out", "label": "link_out()", "_callable": True, "_origin": "ast",
             "source_file": "link.py", "source_location": "L1"},
            {"id": "escape", "label": "escape()", "_callable": True, "_origin": "ast",
             "source_file": "../ngoai.py", "source_location": "L1"},
            {"id": "abs_out", "label": "abs_out()", "_callable": True, "_origin": "ast",
             "source_file": str(outside), "source_location": "L1"},
        ],
        "links": [],
    }), encoding="utf-8")

    store, conn = open_store(tmp_path)
    report = import_graph_json(store, root, root / ".nexgraph" / "graph.json")
    assert report.rejected_paths == ("../ngoai.py", str(outside), "link.py")
    assert report.missing_files == ()
    assert report.files == 3  # app.py, alias.py, __(graphify-external)
    assert {r[0] for r in conn.execute("SELECT duong_dan_tuong_doi FROM tep")} == {
        "app.py", "alias.py", "__(graphify-external)"}
    # Symlink trỏ trong root vẫn đọc được, cùng nội dung đích
    import hashlib
    assert conn.execute("SELECT ma_bam FROM tep WHERE duong_dan_tuong_doi = 'alias.py'").fetchone()[0] == \
        hashlib.sha256((root / "app.py").read_bytes()).hexdigest()
    # Nút trỏ ra ngoài vẫn có trong đồ thị nhưng gắn tệp tổng hợp, không có hàng tep giả
    assert store.get_node("link_out#function").file == "__(graphify-external)"


def test_file_records_and_enrich_skip_outside_root(tmp_path, monkeypatch):
    """Cùng một bước xác thực cho hash (file_records) và span (enrich): không I/O trước khi chặn."""
    from nexgraph_engine.graphify_import import enrich as enrich_module
    from nexgraph_engine.graphify_import.importer import file_records

    root = make_project(tmp_path)
    outside = tmp_path / "ngoai.py"
    outside.write_text("def secret():\n    pass\n", encoding="utf-8")
    (root / "link.py").symlink_to(outside)

    records, missing, rejected = file_records(root, ["app.py", "link.py", "../ngoai.py", str(outside)])
    assert set(records) == {"app.py"}
    assert missing == [] and rejected == ["../ngoai.py", str(outside), "link.py"]

    store, conn = open_store(tmp_path / "db")
    import_graph_json(store, root, root / ".nexgraph" / "graph.json")
    called: list = []
    monkeypatch.setattr(enrich_module, "file_spans", lambda p: called.append(p))
    monkeypatch.setattr(enrich_module, "hashlib", None, raising=False)
    report = enrich_module.enrich_missing_fields(store, root, ["link.py", "../ngoai.py", str(outside)])
    assert called == [] and report.files_read == 0
    assert report.rejected == ("../ngoai.py", str(outside), "link.py")


def test_cli_import_graph(tmp_path, capsys):
    """NG-IMP-4: lệnh nội bộ `nexgraph-engine import-graph --project <root>`."""
    from nexgraph_engine.cli import main

    root = make_project(tmp_path)
    assert main(["import-graph", "--project", str(root)]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["status"] == "ok" and out["nodes"] == 18 and out["files"] == 4
    assert out["enriched_nodes"] > 0
    conn = open_graph_db(root / ".nexgraph" / "graph.db", read_only=True)
    try:
        assert conn.execute("SELECT count(*) FROM tep").fetchone()[0] == 4
        assert conn.execute("SELECT count(*) FROM canh WHERE loai_canh = 'TESTED_BY'").fetchone()[0] == 3
    finally:
        conn.close()


def test_cli_import_graph_custom_json_and_missing(tmp_path, capsys):
    from nexgraph_engine.cli import main

    root = tmp_path / "trong"
    root.mkdir()
    assert main(["import-graph", "--project", str(root),
                 "--graph-json", str(SNAPSHOTS / "base" / "graph.json")]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["nodes"] == 18 and len(out["missing_files"]) == 4



