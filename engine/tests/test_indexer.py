import hashlib
import threading
from pathlib import Path

from nexgraph_engine.schema.enums import Confidence, EdgeType, NodeKind


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


def test_index_workers_override_does_not_bypass_media(monkeypatch):
    from nexgraph_engine.index.indexer import index_workers

    monkeypatch.setenv("NEXGRAPH_INDEX_WORKERS", "8")
    assert index_workers(1000, True) == 1  # media luôn đơn luồng
    assert index_workers(1000, False) == 8  # override vẫn có tác dụng với mã nguồn
    assert index_workers(10, False) == 1


def test_rb22_edge_does_not_break_index_job(copy_fixture, index_project, monkeypatch):
    """Failure injection: cạnh vi phạm RB22 chỉ thành file_error, job vẫn 'done'."""
    from nexgraph_engine.schema.enums import Confidence, EdgeType, Origin
    from nexgraph_engine.store.graph_store import GraphStore
    from nexgraph_engine.store.models import Edge

    root = copy_fixture("bookstore_app")
    injected: list[int] = []
    add_edges = GraphStore.add_edges

    def inject(self, edges):
        count = add_edges(self, edges)
        if not injected and self.get_node("lib/services/auth_service.dart::AuthService.login#method"):
            bad = Edge(source="lib/services/auth_service.dart::AuthService.login#method",
                       target="lib/services/auth_service.dart::AuthService.login#method",
                       type=EdgeType.CALLS, line=99999, confidence=Confidence.INFERRED,
                       confidence_score=0.5, origin=Origin.RESOLVER)
            count += add_edges(self, [bad])  # self-loop có dòng ngoài khoảng -> RB22
            injected.append(1)
        return count

    monkeypatch.setattr(GraphStore, "add_edges", inject)
    store, result, _ = index_project(root)
    assert result.state == "hoan_tat" and injected
    errors = store.conn.execute(
        "SELECT l.chi_tiet FROM loi_phan_tich l JOIN tep t USING (ma_tep)"
        " WHERE t.duong_dan_tuong_doi = 'lib/services/auth_service.dart'").fetchall()
    assert any("RB22" in (r["chi_tiet"] or "") for r in errors)


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


def test_python_cross_file_call_resolved(copy_fixture, index_project):
    # Hồi quy: generic.py gọi bộ trích xuất từng tệp làm mất lời gọi sang tệp khác (repo-reference/docs/11 §5).
    store, _, _ = index_project(copy_fixture("py_mini"))
    targets = {e.edge.target for e in out_edges(store, "main.py::App.step#method", EdgeType.CALLS)}
    assert "util.py::helper#function" in targets
    tested = {e.edge.target for e in out_edges(store, "test_util.py::test_helper#function", EdgeType.CALLS)}
    assert "util.py::helper#function" in tested


def test_typescript_cross_file_call_resolved(tmp_path, index_project):
    (tmp_path / "util.ts").write_text("export function hashPw(p: string) { return p; }\n")
    (tmp_path / "svc.ts").write_text(
        "import { hashPw } from './util';\n"
        "export class AuthService {\n"
        "  login(p: string) { return hashPw(p); }\n"
        "}\n")
    store, result, _ = index_project(tmp_path)
    assert result.state == "hoan_tat"
    targets = {e.edge.target for e in out_edges(store, "svc.ts::AuthService.login#method", EdgeType.CALLS)}
    assert "util.ts::hashPw#function" in targets


def test_python_and_typescript_imports_become_file_edges(tmp_path, index_project):
    # Hồi quy: tên import từ bộ trích xuất đa ngôn ngữ là id tệp của nó (`pkg_mod`), không phải đường dẫn,
    # nên resolver chỉ hiểu đường dẫn kiểu Dart từng cho 0 cạnh IMPORTS với Python/TS (đo trên repo 17k tệp).
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "__init__.py").write_text("")
    (tmp_path / "pkg" / "mod.py").write_text("def f():\n    return 1\n")
    (tmp_path / "app.py").write_text("import json\nfrom pkg.mod import f\n\n\ndef main():\n    return f()\n")
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "util.ts").write_text("export function hashPw(p: string) { return p; }\n")
    (tmp_path / "web" / "svc.ts").write_text("import { hashPw } from './util';\nexport const x = hashPw('a');\n")
    store, result, _ = index_project(tmp_path)
    assert result.state == "hoan_tat"
    assert {e.edge.target for e in out_edges(store, "app.py#file", EdgeType.IMPORTS)} == {"pkg/mod.py#file"}
    assert "web/util.ts#file" in {e.edge.target for e in out_edges(store, "web/svc.ts#file", EdgeType.IMPORTS)}

def _nest(tmp_path):
    (tmp_path / "user.service.ts").write_text(
        "export class UserService {\n  findOne(id: string) { return id }\n}\n")
    (tmp_path / "auth.controller.ts").write_text(
        "import { UserService } from './user.service'\n"
        "export class AuthController {\n"
        "  constructor(private readonly userService: UserService) {}\n"
        "  login(id: string) {\n    return this.userService.findOne(id)\n  }\n}\n")
    (tmp_path / "auth.controller.spec.ts").write_text(
        "import { AuthController } from './auth.controller'\n"
        "import { UserService } from './user.service'\n"
        "describe('AuthController', () => {\n"
        "  it('logs in', () => {\n"
        "    const c = new AuthController(new UserService())\n"
        "    expect(c.login('1')).toBe('1')\n  })\n})\n")
    return tmp_path


def test_typescript_spec_file_calls_come_from_file_node(tmp_path, index_project):
    store, result, _ = index_project(_nest(tmp_path))
    assert result.state == "hoan_tat"
    calls = out_edges(store, "auth.controller.spec.ts#file", EdgeType.CALLS)
    assert {(e.edge.target, e.edge.subtype) for e in calls} >= {
        ("auth.controller.ts::AuthController#class", "construct"),
        ("user.service.ts::UserService#class", "construct")}
    assert all(e.edge.line in (5, 6) for e in calls)
    tested = {e.edge.target for e in out_edges(store, "auth.controller.ts::AuthController#class", EdgeType.TESTED_BY)}
    assert tested == {"auth.controller.spec.ts#file"}


def test_nestjs_constructor_injection_call_resolved(tmp_path, index_project):
    store, _, _ = index_project(_nest(tmp_path))
    e = [x for x in out_edges(store, "auth.controller.ts::AuthController.login#method", EdgeType.CALLS)
         if x.edge.target == "user.service.ts::UserService.findOne#method"]
    assert len(e) == 1 and e[0].edge.line == 5 and e[0].edge.confidence == Confidence.INFERRED
    assert e[0].edge.confidence_score == 0.8          # kiểu tìm thấy qua tệp đã import
    spec = {x.edge.target for x in out_edges(store, "auth.controller.spec.ts#file", EdgeType.CALLS)}
    assert "auth.controller.ts::AuthController.login#method" in spec   # c.login(), c: AuthController


def test_type_table_does_not_leak_between_files(tmp_path, index_project):
    (tmp_path / "a.ts").write_text("export class A { go() { return 1 } }\n")
    (tmp_path / "b.ts").write_text("export class B { go() { return 2 } }\n")
    (tmp_path / "x.ts").write_text("import { A } from './a'\nexport class X {\n  constructor(private svc: A) {}\n  run() { return this.svc.go() }\n}\n")
    (tmp_path / "y.ts").write_text("import { B } from './b'\nexport class Y {\n  constructor(private svc: B) {}\n  run() { return this.svc.go() }\n}\n")
    store, _, _ = index_project(tmp_path)
    assert {e.edge.target for e in out_edges(store, "x.ts::X.run#method", EdgeType.CALLS)} == {"a.ts::A.go#method"}
    assert {e.edge.target for e in out_edges(store, "y.ts::Y.run#method", EdgeType.CALLS)} == {"b.ts::B.go#method"}


def test_typescript_typed_receivers_are_scoped_to_their_function(tmp_path, index_project):
    (tmp_path / "a.ts").write_text("export class A { run() { return 1 } }\n")
    (tmp_path / "b.ts").write_text("export class B { run() { return 2 } }\n")
    (tmp_path / "app.ts").write_text(
        "import { A } from './a'\n"
        "import { B } from './b'\n"
        "export function f(svc: A) { return svc.run() }\n"
        "export function g(svc: B) { return svc.run() }\n"
    )
    store, result, _ = index_project(tmp_path)
    assert result.state == "hoan_tat"
    assert {e.edge.target for e in out_edges(store, "app.ts::f#function", EdgeType.CALLS)} == {
        "a.ts::A.run#method"
    }
    assert {e.edge.target for e in out_edges(store, "app.ts::g#function", EdgeType.CALLS)} == {
        "b.ts::B.run#method"
    }


def test_typescript_di_field_does_not_conflict_with_another_function_parameter(tmp_path, index_project):
    (tmp_path / "types.ts").write_text("export class A { go() {} }\nexport class B { go() {} }\n")
    (tmp_path / "app.ts").write_text(
        "import { A, B } from './types'\n"
        "export class Controller {\n"
        "  constructor(private svc: A) {}\n"
        "  run() { return this.svc.go() }\n"
        "}\n"
        "export function other(svc: B) { return svc.go() }\n"
    )
    store, result, _ = index_project(tmp_path)
    assert result.state == "hoan_tat"
    assert {e.edge.target for e in out_edges(store, "app.ts::Controller.run#method", EdgeType.CALLS)} == {"types.ts::A.go#method"}
    assert {e.edge.target for e in out_edges(store, "app.ts::other#function", EdgeType.CALLS)} == {"types.ts::B.go#method"}


def test_typescript_parameter_binding_does_not_leak_to_untyped_function(tmp_path, index_project):
    (tmp_path / "types.ts").write_text("export class A { run() {} }\n")
    (tmp_path / "app.ts").write_text(
        "import { A } from './types'\n"
        "export function typed(svc: A) { return svc.run() }\n"
        "export function untyped(svc: any) { return svc.run() }\n"
    )
    store, _, _ = index_project(tmp_path)
    assert {e.edge.target for e in out_edges(store, "app.ts::typed#function", EdgeType.CALLS)} == {"types.ts::A.run#method"}
    assert not out_edges(store, "app.ts::untyped#function", EdgeType.CALLS)


def _many_py(tmp_path, n=40):
    tmp_path.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        (tmp_path / f"m{i}.py").write_text(f"from m{(i + 1) % n} import f{(i + 1) % n}\n\ndef f{i}():\n    return f{(i + 1) % n}()\n")
    return tmp_path


def test_parallel_index_equals_serial(tmp_path, index_project, monkeypatch):
    from nexgraph_engine.index import indexer
    from test_refresh import graph_state
    root = _many_py(tmp_path / "p")
    monkeypatch.setenv("NEXGRAPH_INDEX_WORKERS", "1")
    serial, _, _ = index_project(root)
    monkeypatch.setattr(indexer, "index_workers", lambda *_: 3)
    parallel, r, events = index_project(root)
    assert r.state == "hoan_tat"
    assert graph_state(parallel) == graph_state(serial)
    assert [e.files_done for e in events if e.state == "structure"] == list(range(0, 41))   # tiến độ vẫn tăng đều


def test_cancel_during_parallel_index(tmp_path, index_project, monkeypatch):
    from nexgraph_engine.index import indexer
    monkeypatch.setattr(indexer, "index_workers", lambda *_: 3)
    cancel = threading.Event()
    store, r, _ = index_project(_many_py(tmp_path / "p", 60), cancel=cancel,
                                on_event=lambda e: e.files_done == 5 and cancel.set())
    assert r.state == "huy"
    assert store.conn.execute("SELECT count(*) FROM lan_lap_chi_muc WHERE trang_thai NOT IN ('hoan_tat','loi','huy')").fetchone()[0] == 0


def test_broken_file_in_worker_does_not_stop_job(tmp_path, index_project, monkeypatch):
    from nexgraph_engine.index import indexer
    monkeypatch.setattr(indexer, "index_workers", lambda *_: 3)
    root = _many_py(tmp_path / "p", 30)
    (root / "bad.py").write_bytes(b"def broken(:\n\x00\xff")
    store, r, _ = index_project(root)
    assert r.state == "hoan_tat"
    assert store.conn.execute("SELECT count(*) FROM tep").fetchone()[0] == 31


def test_stalled_workers_fall_back_without_repeating_completed_files(tmp_path, index_project, monkeypatch):
    from concurrent.futures import Future
    from nexgraph_engine.index import indexer
    from test_refresh import graph_state

    class StalledPool:
        _processes = {}

        def __init__(self, *, max_workers):
            self.batches = 0

        def submit(self, fn, *args):
            future = Future()
            if self.batches == 0:
                future.set_result(fn(*args))
            self.batches += 1
            return future

        def shutdown(self, *, wait, cancel_futures):
            assert not wait and cancel_futures

    root = _many_py(tmp_path / "p")
    serial, _, _ = index_project(root)
    monkeypatch.setattr(indexer, "index_workers", lambda *_: 2)
    monkeypatch.setattr(indexer, "ProcessPoolExecutor", StalledPool)
    monkeypatch.setattr(indexer, "WORKER_PROGRESS_TIMEOUT_SECONDS", 0)
    recovered, result, events = index_project(root)
    assert result.state == "hoan_tat"
    assert graph_state(recovered) == graph_state(serial)
    assert [e.files_done for e in events if e.state == "structure" and not e.message] == list(range(41))
    assert any(e.message and "Đang đọc tiếp" in e.message for e in events)


def test_crashed_extraction_pool_recovers_same_graph(tmp_path, index_project, monkeypatch):
    from concurrent.futures import Future
    from concurrent.futures.process import BrokenProcessPool
    from nexgraph_engine.index import indexer
    from test_refresh import graph_state

    class CrashedPool:
        _processes = {}

        def __init__(self, *, max_workers):
            assert max_workers == 2

        def submit(self, _fn, *_args):
            future = Future()
            future.set_exception(BrokenProcessPool("worker died before first batch"))
            return future

        def shutdown(self, *, wait, cancel_futures):
            assert not wait and cancel_futures

    root = _many_py(tmp_path / "p")
    serial, _, _ = index_project(root)
    monkeypatch.setattr(indexer, "index_workers", lambda *_: 2)
    monkeypatch.setattr(indexer, "ProcessPoolExecutor", CrashedPool)
    recovered, result, events = index_project(root)
    assert result.state == "hoan_tat"
    assert graph_state(recovered) == graph_state(serial)
    assert any(e.state == "structure" and e.files_done == 0 and e.message for e in events)


def test_index_workers_policy(monkeypatch):
    from nexgraph_engine.index import indexer
    monkeypatch.delenv("NEXGRAPH_INDEX_WORKERS", raising=False)
    monkeypatch.setattr(indexer, "IS_WINDOWS", False)
    monkeypatch.setattr(indexer.os, "cpu_count", lambda: 12)
    assert indexer.index_workers(199, False) == 1
    assert indexer.index_workers(5000, True) == 1
    assert indexer.index_workers(5000, False) == 8
    monkeypatch.setattr(indexer.os, "cpu_count", lambda: 2)
    assert indexer.index_workers(5000, False) == 1


def test_windows_index_defaults_to_serial_and_accepts_explicit_workers(monkeypatch):
    from nexgraph_engine.index import indexer
    monkeypatch.delenv("NEXGRAPH_INDEX_WORKERS", raising=False)
    monkeypatch.setattr(indexer, "IS_WINDOWS", True)
    monkeypatch.setattr(indexer.os, "cpu_count", lambda: 12)
    assert indexer.index_workers(268, False) == 1
    monkeypatch.setenv("NEXGRAPH_INDEX_WORKERS", "3")
    assert indexer.index_workers(268, False) == 3


def test_extracting_twice_through_a_symlinked_root_gives_the_same_references(tmp_path):
    """Kết quả lấy từ cache của bộ trích xuất mang id import theo đường dẫn đã resolve; gốc là symlink (ví dụ /tmp trên
    macOS) thì lần trích xuất thứ hai trong cùng tiến trình mất import nội bộ."""
    import os
    import pytest
    from nexgraph_engine.index.generic import extract_generic
    real = tmp_path / "real"
    (real / "pkg").mkdir(parents=True)
    (real / "pkg" / "util.py").write_text("def helper():\n    return 1\n")
    (real / "pkg" / "main.py").write_text("from pkg.util import helper\n\n\ndef run():\n    return helper()\n")
    link = tmp_path / "link"
    try:
        os.symlink(real, link, target_is_directory=True)
    except OSError:
        pytest.skip("không tạo được symlink")

    def refs():
        x = extract_generic(link, "pkg/main.py", "python", is_test=False)
        return sorted((r.type.value, r.name, r.line) for r in x.refs)

    first = refs()
    assert ("IMPORTS", "pkg_util", 1) in first
    assert refs() == first
