import pytest

from nexgraph_engine.impact.tested_by import derive_tested_by
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, FileRec, Node

LIB, TST = "lib/a.dart", "test/a_test.dart"


@pytest.fixture
def store(tmp_path):
    conn = open_graph_db(tmp_path / "graph.db")
    s = GraphStore(conn)
    s.init_project("demo", has_git=False)
    run = s.begin_run()
    s.add_file(run, FileRec(LIB, "dart", 1, 1, "a" * 64))
    s.add_file(run, FileRec(TST, "dart", 1, 1, "b" * 64, is_test=True))
    s.add_nodes([
        Node(f"{LIB}::f#function", NodeKind.FUNCTION, "f", "f", file=LIB, line_start=1, line_end=3),
        Node(f"{LIB}::g#function", NodeKind.FUNCTION, "g", "g", file=LIB, line_start=4, line_end=6),
        Node(f"{TST}::t1#test", NodeKind.TEST, "t1", "t1", file=TST, line_start=1, line_end=5, is_test=True),
        Node(f"{TST}::t2#test", NodeKind.TEST, "t2", "t2", file=TST, line_start=6, line_end=9, is_test=True),
        Node(f"{TST}::helper#function", NodeKind.FUNCTION, "helper", "helper", file=TST, line_start=10, line_end=12,
             is_test=True),
    ])
    yield s
    conn.close()


def call(src, dst, line, score=0.9):
    return Edge(src, dst, EdgeType.CALLS, confidence=Confidence.INFERRED, confidence_score=score,
                origin=Origin.RESOLVER, line=line, col=0)


def _tested(store):
    return {(e.edge.source, e.edge.target): e for e in
            (store.neighbors(f"{LIB}::f#function", types={EdgeType.TESTED_BY}).edges
             + store.neighbors(f"{LIB}::g#function", types={EdgeType.TESTED_BY}).edges)}


def test_test_calls_become__tested(store):
    f, t1 = f"{LIB}::f#function", f"{TST}::t1#test"
    store.add_edges([call(t1, f, 2)])
    assert derive_tested_by(store) == 1
    edges = _tested(store)
    assert set(edges) == {(f, t1)}  # hướng: từ nút được kiểm thử tới test
    e = edges[(f, t1)].edge
    assert (e.subtype, e.confidence, e.origin, e.line) == ("direct", Confidence.INFERRED, Origin.RESOLVER, None)


def test_one_edge_per_pair(store):
    f, t1 = f"{LIB}::f#function", f"{TST}::t1#test"
    store.add_edges([call(t1, f, 2, 0.5), call(t1, f, 3, 0.9), call(t1, f, 4, 0.7)])
    assert derive_tested_by(store) == 1
    assert _tested(store)[(f, t1)].edge.confidence_score == 0.9


def test_test_to_test_calls_ignored(store):
    t1, helper = f"{TST}::t1#test", f"{TST}::helper#function"
    store.add_edges([call(t1, helper, 2)])
    assert derive_tested_by(store) == 0


def test_idempotent_and_edge_ids_stable(store):
    f, t1 = f"{LIB}::f#function", f"{TST}::t1#test"
    store.add_edges([call(t1, f, 2)])
    derive_tested_by(store)
    first = _tested(store)[(f, t1)].id
    derive_tested_by(store)
    assert _tested(store)[(f, t1)].id == first
    assert store.stats()["edges_by_type"]["TESTED_BY"] == 1


def test_removed_when_call_removed(store):
    f, g = f"{LIB}::f#function", f"{LIB}::g#function"
    t1, t2 = f"{TST}::t1#test", f"{TST}::t2#test"
    store.add_edges([call(t1, f, 2), call(t2, g, 7)])
    derive_tested_by(store)
    store.conn.execute("DELETE FROM canh WHERE loai_canh = 'CALLS' AND ma_nut_nguon = (SELECT ma_nut FROM nut WHERE id_nut = ?)", (t1,))
    derive_tested_by(store)
    assert set(_tested(store)) == {(g, t2)}


def test_indexer_runs_it(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    assert store.stats()["edges_by_type"]["TESTED_BY"] >= 2
    login = "lib/services/auth_service.dart::AuthService.login#method"
    cls_ = "lib/services/auth_service.dart::AuthService#class"
    t = "test/auth_service_test.dart::login returns a user#test"
    for src in (login, cls_):
        targets = {e.edge.target for e in store.neighbors(src, direction="out", types={EdgeType.TESTED_BY}).edges}
        assert targets == {t}
    # không có cạnh ngược lại
    assert not store.neighbors(t, direction="out", types={EdgeType.TESTED_BY}).edges
