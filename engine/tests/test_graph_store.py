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
    with pytest.raises(sqlite3.IntegrityError, match="RB22"):
        store.add_edges([call("lib/a.dart::A#class", "lib/a.dart::B#class", 30)])


def test_call_without_evidence_rejected(store):
    seed_two_classes(store)
    bad = Edge(source="lib/a.dart::A#class", target="lib/a.dart::B#class", type=EdgeType.CALLS)
    with pytest.raises(sqlite3.IntegrityError):
        store.add_edges([bad])


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
