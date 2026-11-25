"""NG-IMP-1: nạp graph.json của vendor Graphify vào graph.db (ADR 0023)."""
import shutil
import sqlite3
from pathlib import Path

from nexgraph_engine.changes.model import ChangeSet, FileChange
from nexgraph_engine.graphify_import import import_graph_json
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
