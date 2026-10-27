import os
import threading
import time
from pathlib import Path

import pytest

from nexgraph_engine.index import refresh as refresh_mod
from nexgraph_engine.index.refresh import refresh_project
from nexgraph_engine.schema.enums import EdgeType


def graph_state(store) -> dict:
    q = store.conn.execute
    return {
        "nodes": {tuple(r) for r in q(
            "SELECT n.id_nut, n.loai_nut, n.nhan, n.ten_day_du, n.dong_bat_dau, n.dong_ket_thuc, n.chu_ky,"
            " n.tai_lieu, n.la_kiem_thu, t.duong_dan_tuong_doi FROM nut n LEFT JOIN tep t ON t.ma_tep = n.ma_tep")},
        "edges": {tuple(r) for r in q(
            "SELECT ns.id_nut, nd.id_nut, c.loai_canh, c.loai_con, c.dong_bang_chung, c.cot_bang_chung,"
            " c.muc_tin_cay, round(c.diem_tin_cay, 6), c.nguon_goc FROM canh c"
            " JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon JOIN nut nd ON nd.ma_nut = c.ma_nut_dich")},
        "refs": {tuple(r) for r in q(
            "SELECT n.id_nut, r.ten_tham_chieu, r.loai_tham_chieu, r.dong, r.cot, r.trang_thai"
            " FROM tham_chieu_chua_phan_giai r JOIN nut n ON n.ma_nut = r.ma_nut_nguon")},
        "bindings": {(k, n, t) for k, d in store.bindings().items() for n, t in d.items()},
        "files": {tuple(r) for r in q("SELECT duong_dan_tuong_doi, ngon_ngu, kich_thuoc, ma_bam, la_kiem_thu FROM tep")},
        "errors": {tuple(r) for r in q(
            "SELECT t.duong_dan_tuong_doi, l.loai FROM loi_phan_tich l JOIN tep t ON t.ma_tep = l.ma_tep")},
    }


def assert_same_as_full_index(store, root, index_project, step=""):
    full, _, _ = index_project(root)
    a, b = graph_state(store), graph_state(full)
    for key in a:
        assert a[key] == b[key], f"{step}: khác ở '{key}': thừa {sorted(a[key] - b[key])[:5]} thiếu {sorted(b[key] - a[key])[:5]}"


def write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    os.utime(p, (time.time() - 100, time.time() - 100 + len(text) % 7))  # tránh nhánh "mtime quá mới"


def edge_ids(store, type_):
    return {(r["id_nut_a"], r["id_nut_b"], r["ma_canh"]) for r in store.conn.execute(
        "SELECT ns.id_nut id_nut_a, nd.id_nut id_nut_b, c.ma_canh FROM canh c JOIN nut ns ON ns.ma_nut = c.ma_nut_nguon"
        " JOIN nut nd ON nd.ma_nut = c.ma_nut_dich WHERE c.loai_canh = ?", (type_,))}


@pytest.fixture
def project(copy_fixture, index_project):
    root = copy_fixture("bookstore_app")
    store, result, _ = index_project(root)
    assert result.state == "hoan_tat"
    return store, root


def runs(store) -> int:
    return store.conn.execute("SELECT count(*) FROM lan_lap_chi_muc").fetchone()[0]


def test_no_changes_is_a_noop(project):
    store, root = project
    before = runs(store)
    r = refresh_project(store, root)
    assert (r.added, r.changed, r.removed) == (0, 0, 0)
    assert runs(store) == before


def test_incremental_equals_full_index(project, index_project):
    store, root = project
    auth = (root / "lib/services/auth_service.dart").read_text(encoding="utf-8")

    write(root, "lib/services/auth_service.dart", auth.replace("'/auth/csrf'", "'/auth/csrf2'"))
    r = refresh_project(store, root)
    assert (r.added, r.changed, r.removed) == (0, 1, 0)
    assert_same_as_full_index(store, root, index_project, "sửa thân hàm")

    write(root, "lib/services/cart_service.dart",
          "import 'auth_service.dart';\n\nclass CartService {\n  final AuthService _auth = AuthService();\n"
          "  Future<void> checkout() async {\n    await _auth.login('a', 'b');\n  }\n}\n")
    assert refresh_project(store, root).added == 1
    assert_same_as_full_index(store, root, index_project, "thêm tệp")

    (root / "lib/models/user.dart").unlink()
    assert refresh_project(store, root).removed == 1
    assert_same_as_full_index(store, root, index_project, "xoá tệp")

    write(root, "lib/models/user.dart", "class User {\n  final String id;\n  final String name;\n\n"
          "  const User({required this.id, required this.name});\n}\n")
    refresh_project(store, root)
    assert_same_as_full_index(store, root, index_project, "tạo lại tệp đã xoá (cạnh từ tệp không đổi phải trở lại)")

    (root / "lib/widgets/primary_button.dart").rename(root / "lib/widgets/main_button.dart")
    r = refresh_project(store, root)
    assert (r.added, r.removed) == (1, 1)
    assert_same_as_full_index(store, root, index_project, "đổi tên tệp")

    t = (root / "test/auth_service_test.dart").read_text(encoding="utf-8")
    write(root, "test/auth_service_test.dart", t.replace("login returns a user", "login gives a user"))
    refresh_project(store, root)
    assert_same_as_full_index(store, root, index_project, "sửa test")


def test_new_symbol_resolves_old_unresolved_call(tmp_path, index_project):
    root = tmp_path / "p"
    write(root, "lib/a.dart", "import 'b.dart';\n\nvoid run() {\n  helper();\n  var s = Svc();\n  s.go();\n}\n")
    write(root, "lib/b.dart", "void other() {}\n")
    store, _, _ = index_project(root)
    assert {r[1] for r in graph_state(store)["refs"]} >= {"helper"}
    write(root, "lib/b.dart", "void other() {}\n\nvoid helper() {}\n\nclass Svc {\n  void go() {}\n}\n")
    refresh_project(store, root)
    calls = {(a, b) for a, b, *_ in graph_state(store)["edges"] if _[0] == "CALLS"}
    assert ("lib/a.dart::run#function", "lib/b.dart::helper#function") in calls
    assert ("lib/a.dart::run#function", "lib/b.dart::Svc.go#method") in calls  # nhờ kiểu biến đã lưu
    assert not [r for r in graph_state(store)["refs"] if r[1] in ("helper", "s.go")]
    assert_same_as_full_index(store, root, index_project)


def test_ambiguity_after_new_duplicate_symbol(tmp_path, index_project):
    root = tmp_path / "p"
    write(root, "lib/a.dart", "void run() {\n  helper();\n}\n")
    write(root, "lib/b.dart", "void helper() {}\n")
    store, _, _ = index_project(root)
    assert any(e[2] == "CALLS" for e in graph_state(store)["edges"])
    write(root, "lib/c.dart", "void helper() {}\n")
    refresh_project(store, root)
    assert not any(e[2] == "CALLS" for e in graph_state(store)["edges"])  # nay mơ hồ nên không đoán
    assert_same_as_full_index(store, root, index_project)


def test_edges_into_surviving_nodes_are_kept(project):
    store, root = project
    login = "lib/services/auth_service.dart::AuthService.login#method"
    before = {t for t in edge_ids(store, "CALLS") if t[1] == login}
    assert before
    auth = (root / "lib/services/auth_service.dart").read_text(encoding="utf-8")
    write(root, "lib/services/auth_service.dart", auth.replace("'/auth/csrf'", "'/auth/csrf2'"))
    refresh_project(store, root)
    assert {t for t in edge_ids(store, "CALLS") if t[1] == login} == before  # cùng ma_canh
    write(root, "lib/services/auth_service.dart", auth.replace("Future<User> login", "Future<User> sign"))
    refresh_project(store, root)
    assert not [t for t in edge_ids(store, "CALLS") if t[1] == login]  # hàm biến mất thì cạnh biến mất


def test_racy_edit_same_second_same_size(tmp_path, index_project):
    root = tmp_path / "p"
    root.mkdir()
    (root / "lib").mkdir()
    f = root / "lib/a.dart"
    f.write_text("void a() {}\n", encoding="utf-8")
    store, _, _ = index_project(root)
    f.write_text("void b() {}\n", encoding="utf-8")  # cùng kích thước, mtime chênh < 1 s
    assert refresh_project(store, root).changed == 1
    assert store.get_node("lib/a.dart::b#function") is not None
    f.write_text("void c() {}\n", encoding="utf-8")
    assert refresh_project(store, root).changed == 1
    assert store.get_node("lib/a.dart::c#function") is not None


def test_respects_subdir_scope(copy_fixture, tmp_path):
    from nexgraph_engine.index.indexer import Indexer
    from nexgraph_engine.schema.db import open_graph_db
    from nexgraph_engine.store.graph_store import GraphStore

    root = copy_fixture("bookstore_app")
    conn = open_graph_db(tmp_path / "scoped.db")
    store = GraphStore(conn)
    store.init_project("x", False)
    Indexer(store, root, on_progress=lambda e: None, cancel=threading.Event(), subdir="lib/services").run()
    n = store.stats()["files"]
    write(root, "lib/other.dart", "void o() {}\n")
    assert refresh_project(store, root).added == 0
    write(root, "lib/services/new_service.dart", "void n() {}\n")
    assert refresh_project(store, root).added == 1
    assert store.stats()["files"] == n + 1
    conn.close()


def test_syntax_error_in_edited_file(project):
    store, root = project
    good = (root / "lib/services/api_client.dart").read_text(encoding="utf-8")
    write(root, "lib/services/api_client.dart", good + "\nclass {{{ broken (\n")
    refresh_project(store, root)
    assert store.conn.execute("SELECT trang_thai FROM lan_lap_chi_muc ORDER BY ma_lan DESC LIMIT 1").fetchone()[0] == "hoan_tat"
    assert any(f == "lib/services/api_client.dart" for f, _ in graph_state(store)["errors"])
    assert store.get_node("lib/services/api_client.dart::ApiClient#class") is not None
    write(root, "lib/services/api_client.dart", good)
    refresh_project(store, root)
    assert not any(f == "lib/services/api_client.dart" for f, _ in graph_state(store)["errors"])


def test_communities_recomputed_only_when_graph_changes(project, monkeypatch):
    store, root = project
    calls = []
    real = refresh_mod.detect_communities
    monkeypatch.setattr(refresh_mod, "detect_communities", lambda s: calls.append(1) or real(s))
    auth = (root / "lib/services/auth_service.dart").read_text(encoding="utf-8")
    write(root, "lib/services/auth_service.dart", auth.replace("'/auth/csrf'", "'/auth/csrf3'"))
    refresh_project(store, root)
    assert calls == []
    write(root, "lib/services/auth_service.dart", "import '../widgets/primary_button.dart';\n" + auth)
    refresh_project(store, root)
    assert calls == [1]


def test_unicode_names_and_directory_cleanup(project):
    store, root = project
    write(root, "lib/màn hình/đăng nhập.dart", "class DangNhap {}\n")
    refresh_project(store, root)
    assert store.get_node("lib/màn hình#directory") is not None
    assert store.get_node("lib/màn hình/đăng nhập.dart::DangNhap#class") is not None
    assert ("lib#directory", "lib/màn hình#directory") in {(a, b) for a, b, *_ in graph_state(store)["edges"]}
    (root / "lib/màn hình/đăng nhập.dart").unlink()
    (root / "lib/màn hình").rmdir()
    refresh_project(store, root)
    assert store.get_node("lib/màn hình#directory") is None
    assert not [e for e in graph_state(store)["edges"] if "màn hình" in e[0] + e[1]]


def test_fts_follows_edits(project):
    from nexgraph_engine.store.search import search

    store, root = project
    assert search(store.conn, "login")
    auth = (root / "lib/services/auth_service.dart").read_text(encoding="utf-8")
    write(root, "lib/services/auth_service.dart", auth.replace("login", "signin"))
    refresh_project(store, root)
    assert not [h for h in search(store.conn, "login") if h[0].file == "lib/services/auth_service.dart"]
    assert any(h[0].label == "signin" for h in search(store.conn, "signin"))
