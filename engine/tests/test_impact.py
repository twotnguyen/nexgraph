import time

import pytest

from nexgraph_engine.changes.model import ChangeSet, FileChange
from nexgraph_engine.impact import params
from nexgraph_engine.impact import analyze as impact
from nexgraph_engine.impact.analyze import analyze, map_to_nodes
from nexgraph_engine.index.tested_by import derive_tested_by
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind, Origin
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.models import Edge, FileRec, Node


class G:
    """Đồ thị nhỏ dựng tay: mỗi nút hàm/test nằm trong tệp riêng `lib/<tên>.dart` (hoặc `test/<tên>_test.dart`)."""

    def __init__(self, tmp_path):
        self.conn = open_graph_db(tmp_path / "g.db")
        self.store = GraphStore(self.conn)
        self.store.init_project("g", False)
        self.run = self.store.begin_run()
        self.ids: dict[str, str] = {}

    def fn(self, name, kind=NodeKind.FUNCTION, test=False, lines=(1, 10)):
        path = f"test/{name}_test.dart" if test else f"lib/{name}.dart"
        self.store.add_file(self.run, FileRec(path, "dart", 1, 1, name.encode().hex().ljust(64, "0")[:64], test))
        fid = f"{path}#file"
        kind = NodeKind.TEST if test else kind
        self.store.add_nodes([
            Node(fid, NodeKind.FILE, path, path, file=path, is_test=test),
            Node(f"{path}::{name}#{kind.value}", kind, name, name, file=path,
                 line_start=lines[0], line_end=lines[1], is_test=test)])
        self.ids[name] = f"{path}::{name}#{kind.value}"
        self.ids[f"{name}.file"] = fid
        return self.ids[name]

    def edge(self, a, b, type_=EdgeType.CALLS, line=5, file_level=False):
        src = self.ids[f"{a}.file"] if file_level else self.ids[a]
        dst = self.ids[f"{b}.file"] if file_level else self.ids[b]
        self.store.add_edges([Edge(src, dst, type_, confidence=Confidence.INFERRED, confidence_score=0.9,
                                   origin=Origin.RESOLVER, line=1 if file_level else line)])

    def change(self, *names, ranges=None):
        files = [FileChange(self.ids[n].split("::")[0], "M", None, ranges) for n in names]
        return ChangeSet("git_head", "a" * 40, files)


@pytest.fixture
def g(tmp_path):
    graph = G(tmp_path)
    yield graph
    graph.conn.close()


def scores(report):
    return {i.node.label: (i.score, i.hops) for i in report.impacted}


def test_map_ranges_to_nodes(project_bookstore):
    store, _ = project_bookstore
    login = store.get_node("lib/services/auth_service.dart::AuthService.login#method")
    path = login.file
    inside = ChangeSet("git_head", None, [FileChange(path, "M", None, [(login.line_start + 1, login.line_start + 1)])])
    got = {n.id for n in map_to_nodes(store.conn, inside)}
    assert got == {login.id, "lib/services/auth_service.dart::AuthService#class"}
    assert map_to_nodes(store.conn, ChangeSet("git_head", None, [FileChange(path, "M", None, [(900, 901)])])) == []
    whole = map_to_nodes(store.conn, ChangeSet("last_index", None, [FileChange(path, "M", None, None)]))
    assert {n.label for n in whole} >= {"AuthService", "login"}
    assert not [n for n in whole if n.kind in (NodeKind.FILE, NodeKind.DIRECTORY)]
    assert map_to_nodes(store.conn, ChangeSet("git_head", None, [FileChange(path, "D", None, None)])) == []


@pytest.fixture
def project_bookstore(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    return store, None


def test_login_change_impacts_callers(project_bookstore):
    store, _ = project_bookstore
    login = store.get_node("lib/services/auth_service.dart::AuthService.login#method")
    cs = ChangeSet("git_head", None, [FileChange(login.file, "M", None, [(login.line_start + 1,) * 2])])
    report = analyze(store.conn, cs)
    s = scores(report)
    assert s["build"] == (1.0, 1)
    assert all(sc <= 0.6 for sc, h in s.values() if h == 2)
    order = [i.score for i in report.impacted]
    assert order == sorted(order, reverse=True)
    assert not [i for i in report.impacted if i.node.is_test]
    assert "login returns a user" in {t.label for t in report.tests}
    assert report.test_gaps == []


def test_weights_and_decay_exact(g):
    for n in "abcde":
        g.fn(n)
    g.edge("b", "c")           # b gọi c
    g.edge("a", "b")           # a gọi b
    g.edge("d", "c", EdgeType.INHERITS)
    g.edge("e", "d", EdgeType.REFERENCES)
    report = analyze(g.conn, g.change("c"))
    s = scores(report)
    assert s["b"] == (1.0, 1)
    assert s["a"] == (pytest.approx(0.6), 2)
    assert s["d"] == (pytest.approx(0.9), 1)
    assert s["e"] == (pytest.approx(0.9 * 0.6 * 0.6), 2)


def test_two_paths_take_max_and_low_scores_are_cut(g):
    for n in "xyzw":
        g.fn(n)
    g.edge("y", "x", EdgeType.IMPORTS, file_level=True)   # tệp y import tệp x: 0.5
    g.edge("y", "x")                                      # hàm y gọi hàm x: 1.0
    g.edge("z", "x", EdgeType.IMPORTS, file_level=True)   # tệp z import trực tiếp: 0.5
    g.edge("z", "y", EdgeType.IMPORTS, file_level=True)   # z qua y: 0.5 * 0.5 * 0.6 = 0.15 (kém hơn, và dưới ngưỡng)
    g.edge("w", "y", EdgeType.IMPORTS, file_level=True)   # w chỉ qua y: 0.15 < MIN_SCORE nên bị cắt
    s = scores(analyze(g.conn, g.change("x")))
    assert s["y"] == (1.0, 1)
    assert s["lib/y.dart"] == (0.5, 1)
    assert s["lib/z.dart"] == (0.5, 1)
    assert "lib/w.dart" not in s


def test_inheritance_and_imports_propagate(g):
    for n in ("base", "child", "user"):
        g.fn(n, NodeKind.CLASS)
    g.edge("child", "base", EdgeType.INHERITS)
    g.edge("user", "base", EdgeType.IMPORTS, file_level=True)
    labels = scores(analyze(g.conn, g.change("base")))
    assert labels["child"] == (pytest.approx(0.9), 1)
    assert labels["lib/user.dart"] == (pytest.approx(0.5), 1)  # nút tệp của `user`


def test_cycles_and_self_recursion_terminate(g):
    g.fn("a")
    g.fn("b")
    g.edge("a", "b")
    g.edge("b", "a")
    g.edge("a", "a")
    report = analyze(g.conn, g.change("a"))
    assert [i.node.label for i in report.impacted] == ["b"]
    assert all(i.hops <= 2 for i in report.impacted)


def test_huge_fan_in_is_capped(g):
    g.fn("hub")
    for i in range(1500):
        g.fn(f"c{i}")
        g.edge(f"c{i}", "hub")
    t0 = time.time()
    report = analyze(g.conn, g.change("hub"))
    assert time.time() - t0 < 2
    assert report.truncated is True
    assert len(report.impacted) <= params.MAX_IMPACTED


def test_tests_via_tested_by_and_callers(g):
    for n in ("target", "c1", "c2", "c3"):
        g.fn(n)
    for n in ("tt", "t1", "t2", "t3"):
        g.fn(n, test=True)
    g.edge("c1", "target")
    g.edge("c2", "c1")
    g.edge("c3", "c2")
    for t, f in (("tt", "target"), ("t1", "c1"), ("t2", "c2"), ("t3", "c3")):
        g.edge(t, f)
    derive_tested_by(g.store)
    assert {n.label for n in impact.tests_for(g.conn, g.ids["target"])} == {"tt", "t1", "t2"}  # t3 cách 3 hop


def test_test_gap_marks_untested_changed_function(g):
    g.fn("login")
    g.fn("newfn")
    g.fn("helper")
    g.fn("caller")
    g.fn("t", test=True)
    g.edge("t", "login")
    g.edge("caller", "helper")  # helper có caller, và caller có test: không phải gap
    g.edge("t", "caller")
    derive_tested_by(g.store)
    report = analyze(g.conn, g.change("login", "newfn", "helper", "t"))
    assert {n.label for n in report.test_gaps} == {"newfn"}
    assert "t" in {n.label for n in report.tests}


def test_function_with_tested_caller_within_two_hops_is_not_a_gap(g):
    g.fn("leaf")
    g.fn("mid")
    g.fn("t", test=True)
    g.edge("mid", "leaf")
    g.edge("t", "mid")
    derive_tested_by(g.store)
    assert analyze(g.conn, g.change("leaf")).test_gaps == []


def test_non_git_file_level_changes(g):
    g.fn("a")
    g.fn("b")
    g.edge("b", "a")
    cs = ChangeSet("last_index", None, [FileChange(g.ids["a"].split("::")[0], "M")], note="x")
    report = analyze(g.conn, cs)
    assert [n.label for n in report.changed_nodes] == ["a"]
    assert scores(report)["b"] == (1.0, 1)


def test_edit_outside_any_symbol_does_not_impact_importers(g):
    g.fn("a", lines=(1, 3))
    g.fn("b")
    g.edge("b", "a", EdgeType.IMPORTS, file_level=True)
    path = g.ids["a"].split("::")[0]
    cs = ChangeSet("git_head", None, [FileChange(path, "M", None, [(50, 50)])])
    report = analyze(g.conn, cs)
    assert report.changed_nodes == [] and report.impacted == []
