import hashlib
import threading
from pathlib import Path

from nexgraph_engine.schema.enums import EdgeType, NodeKind


def tree_hashes(root: Path) -> dict[str, str]:
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file()}


def out_edges(store, node_id, type_):
    return store.neighbors(node_id, direction="out", types={type_}).edges


def test_bookstore_structure_and_edges(copy_fixture, index_project):
    root = copy_fixture("bookstore_app")
    store, result, _ = index_project(root)
    assert result.state == "hoan_tat" and result.nodes > 20 and result.edges > 20
    stats = store.stats()
    assert stats["languages"] == {"dart": 9} and stats["nodes_by_kind"]["widget"] == 3  # LoginScreen, MyApp, PrimaryButton
    assert stats["nodes_by_kind"]["repository"] == 1 and stats["nodes_by_kind"]["test"] == 1
    # cấu trúc thư mục
    contains = {(e.edge.source, e.edge.target) for e in out_edges(store, ".#repository", EdgeType.CONTAINS)}
    assert (".#repository", "lib#directory") in contains and (".#repository", "pubspec.yaml#file") not in contains
    assert ("lib#directory", "lib/main.dart#file") in {(e.edge.source, e.edge.target)
                                                       for e in out_edges(store, "lib#directory", EdgeType.CONTAINS)}


def test_imports_resolved_with_evidence(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    imp = {e.edge.target: e for e in out_edges(store, "lib/screens/login_screen.dart#file", EdgeType.IMPORTS)}
    assert set(imp) == {"lib/services/auth_service.dart#file", "lib/widgets/primary_button.dart#file"}
    e = imp["lib/services/auth_service.dart#file"]
    assert e.edge.line == 3 and e.file == "lib/screens/login_screen.dart"


def test_calls_via_declared_receiver_type(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    build = "lib/screens/login_screen.dart::_LoginScreenState.build#method"
    calls = {e.edge.target: e.edge for e in out_edges(store, build, EdgeType.CALLS)}
    login = calls["lib/services/auth_service.dart::AuthService.login#method"]
    assert login.confidence_score in (0.9, 0.8)
    assert calls["lib/widgets/primary_button.dart::PrimaryButton#widget"].subtype == "construct"
    go = out_edges(store, "lib/screens/login_screen.dart::_LoginScreenState._goHome#method", EdgeType.CALLS)
    assert go == []  # Navigator.pushNamed là API ngoài, không đoán


def test_two_calls_two_edges(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    src = "lib/services/auth_service.dart::AuthService.login#method"
    posts = [e for e in out_edges(store, src, EdgeType.CALLS)
             if e.edge.target == "lib/services/api_client.dart::ApiClient.post#method"]
    assert len(posts) == 2 and posts[0].edge.line != posts[1].edge.line


def test_every_edge_has_evidence_in_source_range(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    needing = {EdgeType.CALLS, EdgeType.IMPORTS, EdgeType.INHERITS, EdgeType.IMPLEMENTS}
    seen = 0
    for n in store.all_nodes():
        for e in store.neighbors(n.id, direction="out").edges:
            if e.edge.type in needing:
                seen += 1
                assert e.edge.line is not None and e.file is not None
                src = store.get_node(e.edge.source)
                if src.line_start is not None:
                    assert src.line_start <= e.edge.line <= src.line_end
    assert seen > 10


def test_test_file_calls_the_class_under_test(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    (t,) = [n for n in store.all_nodes({NodeKind.TEST})]
    assert t.is_test
    targets = {e.edge.target for e in out_edges(store, t.id, EdgeType.CALLS)}
    assert "lib/services/auth_service.dart::AuthService#class" in targets


def test_broken_file_does_not_stop_job(copy_fixture, index_project):
    store, result, _ = index_project(copy_fixture("bookstore_app"))
    assert result.state == "hoan_tat"
    assert store.get_node("lib/broken.dart::validHelper#function") is not None
    err = store.conn.execute("SELECT loai FROM loi_phan_tich l JOIN tep t USING (ma_tep)"
                             " WHERE t.duong_dan_tuong_doi = 'lib/broken.dart'").fetchall()
    assert [r["loai"] for r in err] == ["parse_partial"]


def test_oversized_file_recorded_not_parsed(tmp_path, index_project):
    root = tmp_path / "proj"
    (root / "lib").mkdir(parents=True)
    (root / "lib" / "big.dart").write_text("class Big {}\n" + "// x\n" * 500_000, encoding="utf-8")
    store, result, _ = index_project(root)
    assert result.state == "hoan_tat" and store.get_node("lib/big.dart#file") is not None
    assert store.get_node("lib/big.dart::Big#class") is None
    assert store.conn.execute("SELECT loai FROM loi_phan_tich").fetchone()["loai"] == "oversized"


def test_reindex_is_idempotent(copy_fixture, index_project):
    root = copy_fixture("bookstore_app")
    store, first, _ = index_project(root)
    from nexgraph_engine.index.indexer import Indexer
    second = Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event()).run()
    assert (second.nodes, second.edges, second.unresolved) == (first.nodes, first.edges, first.unresolved)
    assert store.conn.execute("SELECT count(*) FROM lan_lap_chi_muc WHERE trang_thai='hoan_tat'").fetchone()[0] == 2


def test_cancel_between_files(copy_fixture, index_project):
    cancel = threading.Event()
    store, result, events = index_project(copy_fixture("bookstore_app"), cancel=cancel,
                                          on_event=lambda e: cancel.set() if e.state == "structure" else None)
    assert result.state == "huy" and events[-1].state == "cancelled"
    states = {r["trang_thai"] for r in store.conn.execute("SELECT trang_thai FROM lan_lap_chi_muc")}
    assert states == {"huy"}


def test_progress_events_order(copy_fixture, index_project):
    _, _, events = index_project(copy_fixture("bookstore_app"))
    order = [e.state for e in events]
    assert order[-1] == "done" and "resolve" in order
    assert order.index("resolve") > max(i for i, s in enumerate(order) if s == "structure")
    done = [e.files_done for e in events if e.state == "structure"]
    assert done == sorted(done) and events[0].files_total == 9


def test_no_source_file_modified(copy_fixture, index_project):
    root = copy_fixture("bookstore_app")
    before = tree_hashes(root)
    index_project(root)
    assert tree_hashes(root) == before  # kể cả không thêm .nexgraph/ (đồ thị lưu ngoài project trong test này)


def test_python_project_generic(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    store, result, _ = index_project(root)
    assert result.state == "hoan_tat"
    assert store.get_node("main.py::App.run#method") is not None
    assert store.stats()["languages"] == {"python": 3}


def test_full_index_persists_bindings_and_baseline(copy_fixture, index_project):
    root = copy_fixture("bookstore_app")
    store, result, _ = index_project(root)
    assert result.state == "hoan_tat"
    b = store.bindings()
    assert b["lib/screens/login_screen.dart::_LoginScreenState#class"]["_auth"] == "AuthService"
    assert len(store.baseline()) == store.stats()["files"] == 9
    assert store.last_scope() is None
    from nexgraph_engine.index.indexer import Indexer
    Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event(), subdir="lib/services").run()
    assert store.last_scope() == "lib/services"
