import sqlite3

import pytest

from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, FileRec, Node, UnresolvedRef


@pytest.fixture
def store(tmp_path):
    conn = open_graph_db(tmp_path / "graph.db")
    s = GraphStore(conn)
    s.init_project("demo", has_git=False)
    yield s
    conn.close()


def file_rec(path="lib/a.dart", test=False):
    return FileRec(rel_path=path, language="dart", size=10, mtime=1, sha256="a" * 64, is_test=test)


def cls(id_, name, start, end, file="lib/a.dart", kind=NodeKind.CLASS):
    return Node(id=id_, kind=kind, label=name, qualified_name=name, file=file, line_start=start, line_end=end)


def seed_two_classes(s):
    run = s.begin_run()
    s.add_file(run, file_rec())
    s.add_nodes([
        Node(id="lib/a.dart#file", kind=NodeKind.FILE, label="a.dart", qualified_name="lib/a.dart", file="lib/a.dart"),
        cls("lib/a.dart::A#class", "A", 1, 20),
        cls("lib/a.dart::B#class", "B", 21, 40),
    ])
    return run


def call(src, dst, line, col=None):
    return Edge(source=src, target=dst, type=EdgeType.CALLS, line=line, col=col,
                confidence=Confidence.INFERRED, confidence_score=0.9, origin=Origin.RESOLVER)


def test_parallel_edges_kept(store):
    seed_two_classes(store)
    a, b = "lib/a.dart::A#class", "lib/a.dart::B#class"
    assert store.add_edges([call(a, b, 5), call(a, b, 9)]) == 2
    assert store.add_edges([call(a, b, 5)]) == 0  # trùng hoàn toàn (RB16) thì bỏ qua
    hood = store.neighbors(a, direction="out", types={EdgeType.CALLS})
    assert sorted(e.edge.line for e in hood.edges) == [5, 9]
    assert {e.file for e in hood.edges} == {"lib/a.dart"}


def test_evidence_outside_source_range_rejected(store):
    seed_two_classes(store)
    # RB22: một cạnh hỏng bị bỏ qua và ghi lỗi cho tệp nguồn, không làm sập cả lần index.
    assert store.add_edges([call("lib/a.dart::A#class", "lib/a.dart::B#class", 30)]) == 0
    err = store.conn.execute("SELECT loai, chi_tiet FROM loi_phan_tich").fetchall()
    assert len(err) == 1 and err[0]["loai"] == "extract" and "RB22" in err[0]["chi_tiet"]
    assert store.add_edges([call("lib/a.dart::A#class", "lib/a.dart::B#class", 5)]) == 1


def test_call_without_evidence_rejected(store):
    seed_two_classes(store)
    bad = Edge(source="lib/a.dart::A#class", target="lib/a.dart::B#class", type=EdgeType.CALLS)
    assert store.add_edges([bad]) == 0  # RB12: bỏ qua, không ném lỗi
    assert store.conn.execute("SELECT count(*) FROM canh").fetchone()[0] == 0


def test_class_requires_line_range(store):
    run = store.begin_run()
    store.add_file(run, file_rec())
    with pytest.raises(sqlite3.IntegrityError):
        store.add_nodes([Node(id="x", kind=NodeKind.CLASS, label="X", qualified_name="X", file="lib/a.dart")])


def test_neighbors_direction_and_types(store):
    seed_two_classes(store)
    f, a, b = "lib/a.dart#file", "lib/a.dart::A#class", "lib/a.dart::B#class"
    store.add_edges([Edge(source=f, target=a, type=EdgeType.DEFINES), call(a, b, 5)])
    out = store.neighbors(a, direction="out")
    assert [e.edge.type for e in out.edges] == [EdgeType.CALLS]
    inc = store.neighbors(a, direction="in")
    assert [e.edge.type for e in inc.edges] == [EdgeType.DEFINES]
    only_calls = store.neighbors(a, types={EdgeType.CALLS})
    assert {n.id for n in only_calls.nodes} == {a, b}


def test_neighbors_limit_sets_truncated(store):
    run = store.begin_run()
    store.add_file(run, file_rec())
    hub = cls("lib/a.dart::Hub#class", "Hub", 1, 1000)
    leaves = [cls(f"lib/a.dart::L{i}#class", f"L{i}", 1001 + i, 1001 + i) for i in range(30)]
    store.add_nodes([hub, *leaves])
    store.add_edges([call(hub.id, leaf.id, 2 + i) for i, leaf in enumerate(leaves)])
    hood = store.neighbors(hub.id, limit=10)
    assert len(hood.nodes) <= 10 and hood.truncated is True
    ids = {n.id for n in hood.nodes}
    assert all(e.edge.source in ids and e.edge.target in ids for e in hood.edges)
    assert store.neighbors(hub.id, limit=100).truncated is False


def test_neighbors_depth_two(store):
    run = store.begin_run()
    store.add_file(run, file_rec())
    a, b, c = (cls(f"lib/a.dart::{n}#class", n, i * 10 + 1, i * 10 + 9) for i, n in enumerate("ABC"))
    store.add_nodes([a, b, c])
    store.add_edges([call(a.id, b.id, 2), call(b.id, c.id, 12)])
    assert {n.id for n in store.neighbors(a.id, depth=1).nodes} == {a.id, b.id}
    assert {n.id for n in store.neighbors(a.id, depth=2).nodes} == {a.id, b.id, c.id}


def test_unknown_node_raises_keyerror(store):
    with pytest.raises(KeyError):
        store.neighbors("nope")
    assert store.get_node("nope") is None


def test_run_lifecycle(store):
    r1 = store.begin_run(files_total=3)
    with pytest.raises(sqlite3.IntegrityError):  # RB19
        store.begin_run()
    store.set_run_state(r1, "cau_truc", files_done=1)
    store.set_run_state(r1, "hoan_tat", files_done=3)
    row = store.conn.execute("SELECT trang_thai, ket_thuc_luc FROM lan_lap_chi_muc WHERE ma_lan=?", (r1,)).fetchone()
    assert row["trang_thai"] == "hoan_tat" and row["ket_thuc_luc"] is not None
    r2 = store.begin_run()
    store.set_run_state(r2, "loi", error="boom")
    assert store.last_completed_run() is not None


def test_clear_graph_keeps_project(store):
    seed_two_classes(store)
    store.add_unresolved([UnresolvedRef(source="lib/a.dart::A#class", name="x", type=EdgeType.CALLS, line=3, col=0)])
    store.clear_graph()
    assert store.conn.execute("SELECT count(*) FROM nut").fetchone()[0] == 0
    assert store.conn.execute("SELECT count(*) FROM tep").fetchone()[0] == 0
    assert store.conn.execute("SELECT count(*) FROM tham_chieu_chua_phan_giai").fetchone()[0] == 0
    assert store.conn.execute("SELECT count(*) FROM du_an").fetchone()[0] == 1


def test_stats_and_lookup(store):
    seed_two_classes(store)
    s = store.stats()
    assert s["files"] == 1 and s["nodes_by_kind"]["class"] == 2 and s["languages"] == {"dart": 1}
    n = store.get_node("lib/a.dart::A#class")
    assert n.file == "lib/a.dart" and n.language == "dart" and n.line_end == 20
    assert store.file_record("lib/a.dart").sha256 == "a" * 64
    assert [x.id for x in store.all_nodes({NodeKind.FILE})] == ["lib/a.dart#file"]


def test_fts_rows_follow_nodes(store):
    run = store.begin_run()
    store.add_file(run, file_rec())
    store.add_nodes([
        Node(id=".#repository", kind=NodeKind.REPOSITORY, label="demo", qualified_name="."),
        Node(id="lib/a.dart#file", kind=NodeKind.FILE, label="a.dart", qualified_name="lib/a.dart", file="lib/a.dart"),
        cls("lib/a.dart::LoginScreen#class", "LoginScreen", 1, 20),
        Node(id="lib/a.dart::A.m#method", kind=NodeKind.METHOD, label="m", qualified_name="A.m", file="lib/a.dart",
             line_start=3, line_end=5, signature="void m()", doc="Làm gì đó"),
    ])
    fts = lambda: store.conn.execute("SELECT count(*) FROM nut_fts").fetchone()[0]  # noqa: E731
    assert fts() == 3  # không có dòng cho repository
    hit = store.conn.execute("SELECT rowid FROM nut_fts WHERE nut_fts MATCH 'screen'").fetchall()
    assert len(hit) == 1  # tách camelCase: LoginScreen -> login screen
    store.clear_graph()
    assert fts() == 0


def test_bindings_roundtrip_and_cascade(store):
    seed_two_classes(store)
    a, b = "lib/a.dart::A#class", "lib/a.dart::B#class"
    store.add_bindings({a: {"_x": "B", "y": "int"}, b: {"z": "A"}})
    assert store.bindings() == {a: {"_x": "B", "y": "int"}, b: {"z": "A"}}
    store.add_bindings({a: {"_x": "C"}})  # ghi đè theo (nút, tên)
    assert store.bindings()[a]["_x"] == "C"
    store.delete_bindings_of_file("lib/a.dart")
    assert store.bindings() == {}
    store.add_bindings({a: {"_x": "B"}})
    store.conn.execute("DELETE FROM nut WHERE id_nut = ?", (a,))
    assert store.bindings() == {}


def test_baseline_snapshot_matches_files(store):
    run = store.begin_run()
    store.add_file(run, file_rec("lib/a.dart"))
    store.add_file(run, FileRec("lib/b.dart", "dart", 1, 1, "b" * 64))
    store.snapshot_baseline()
    assert store.baseline() == {"lib/a.dart": "a" * 64, "lib/b.dart": "b" * 64}
    store.conn.execute("DELETE FROM tep WHERE duong_dan_tuong_doi = 'lib/b.dart'")
    store.snapshot_baseline()
    assert store.baseline() == {"lib/a.dart": "a" * 64}


def test_begin_run_records_subdir_and_kind(store):
    assert store.last_scope() is None
    r1 = store.begin_run(subdir="lib/services")
    assert store.last_scope() == "lib/services"
    store.set_run_state(r1, "hoan_tat")
    assert store.last_scope() == "lib/services"
    r2 = store.begin_run(kind="tang_dan", subdir="other")  # lần tăng dần không đổi phạm vi
    store.set_run_state(r2, "hoan_tat")
    assert store.last_scope() == "lib/services"
    row = store.conn.execute("SELECT loai, thu_muc_con FROM lan_lap_chi_muc WHERE ma_lan = ?", (r2,)).fetchone()
    assert (row["loai"], row["thu_muc_con"]) == ("tang_dan", "other")


@pytest.fixture
def store_with_star(store):
    run = store.begin_run()
    store.add_file(run, FileRec("c.py", "python", 100, 1, "c" * 64, False))
    hub = Node(id="c.py::hub#function", kind=NodeKind.FUNCTION, label="hub", qualified_name="hub", file="c.py", line_start=1, line_end=100)
    leaves = [
        Node(id=f"c.py::leaf{i}#function", kind=NodeKind.FUNCTION, label=f"leaf{i}", qualified_name=f"leaf{i}", file="c.py", line_start=1, line_end=100)
        for i in range(30)
    ]
    store.add_nodes([hub, *leaves])
    store.add_edges([
        Edge(source="c.py::hub#function", target=f"c.py::leaf{i}#function", type=EdgeType.CALLS, line=10)
        for i in range(30)
    ])
    return store


def test_neighbors_reports_total_when_truncated(store_with_star):
    hood = store_with_star.neighbors("c.py::hub#function", limit=10)
    assert hood.truncated is True and hood.total == 30 and len(hood.nodes) == 10
    assert store_with_star.neighbors("c.py::hub#function", depth=2, limit=10).total is None
