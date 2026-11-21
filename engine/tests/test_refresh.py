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
        "flows": {tuple(r) for r in q("SELECT ten, loai_vao, mo_ta_vao, so_buoc, so_tep, do_sau, diem, bi_cat FROM luong")},
        "flow_steps": {tuple(r) for r in q(
            "SELECT l.ten, b.thu_tu, n.id_nut, b.do_sau, ifnull(ng.id_nut, ''), ifnull(b.dong_bang_chung, -1)"
            " FROM buoc_luong b JOIN luong l USING (ma_luong) JOIN nut n ON n.ma_nut = b.ma_nut"
            " LEFT JOIN nut ng ON ng.ma_nut = b.ma_nut_goi")},
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


def test_refresh_requeues_only_refs_that_new_names_can_satisfy(tmp_path, index_project):
    (tmp_path / "a.py").write_text("def a():\n    return missing_one() + missing_two()\n")
    (tmp_path / "b.py").write_text("def b():\n    return 1\n")
    store, _, _ = index_project(tmp_path)
    (tmp_path / "b.py").write_text("def b():\n    return 1\n\ndef missing_one():\n    return 2\n")
    refresh_project(store, tmp_path)
    state = dict(store.conn.execute("SELECT ten_tham_chieu, trang_thai FROM tham_chieu_chua_phan_giai"))
    assert "missing_one" not in state                # đã nối thành cạnh
    assert state["missing_two"] == "that_bai"
    touched = store.conn.execute("SELECT count(*) FROM canh WHERE loai_canh='CALLS'").fetchone()[0]
    assert touched == 1


FLOW_EDITS = [
    # (tệp, hàm sửa nội dung) lần lượt: thêm lời gọi ở giữa luồng, thêm điểm vào, đổi decorator, bỏ một bước,
    # thêm test cho một bước (đổi điểm test gap), xoá tệp có bước của mọi luồng.
    ("service.py", lambda s: s.replace("    return save_session(user)", "    audit(user)\n    return save_session(user)")
     + "\n\ndef audit(user):\n    return hash_password(user)\n"),
    ("app.py", lambda s: s + '\n\n@app.get("/health")\ndef health():\n    return books()\n'),
    ("app.py", lambda s: s.replace('@app.post("/auth/login")', '@app.put("/auth/login")')),
    ("service.py", lambda s: s.replace("    check_password(user, body)\n", "")),
    ("test_service.py", lambda s: s + "\n\ndef test_audit():\n    from service import audit\n    assert audit(1) == 1\n"),
    ("repo.py", None),
]


@pytest.mark.parametrize("max_flows", [2000, 2, 1])  # 2 và 1: bảng luồng đầy, ứng viên bị cắt không được lưu
def test_flows_after_each_refresh_equal_a_full_rebuild(copy_fixture, index_project, monkeypatch, max_flows):
    from nexgraph_engine.flows import build
    monkeypatch.setattr(build, "MAX_FLOWS", max_flows)
    errors: list[Exception] = []
    real = refresh_mod.update_flows

    def strict(*a, **k):  # refresh nuốt lỗi của phần luồng; test thì không
        try:
            return real(*a, **k)
        except Exception as exc:
            errors.append(exc)
            raise

    monkeypatch.setattr(refresh_mod, "update_flows", strict)
    root = copy_fixture("flow_app")
    store, _, _ = index_project(root)
    for i, (rel, edit) in enumerate(FLOW_EDITS):
        if edit is None:
            (root / rel).unlink()
        else:
            write(root, rel, edit((root / rel).read_text(encoding="utf-8")))
        refresh_project(store, root)
        assert not errors, errors
        assert_same_as_full_index(store, root, index_project, step=f"sửa {i} ({rel}), MAX_FLOWS={max_flows}")


def test_refresh_rebuilds_flows_when_update_fails(project, index_project, monkeypatch):
    """Failure injection: update_flows ném lỗi thì phải dựng lại toàn bộ, không báo 'ok' mà giữ luồng cũ."""
    store, root = project
    calls: list[int] = []
    real_rebuild = refresh_mod.rebuild_flows

    def rebuild(s, r):
        calls.append(1)
        return real_rebuild(s, r)

    def broken(*a, **k):
        raise RuntimeError("boom-update-flows")

    monkeypatch.setattr(refresh_mod, "update_flows", broken)
    monkeypatch.setattr(refresh_mod, "rebuild_flows", rebuild)
    auth = (root / "lib/services/auth_service.dart").read_text(encoding="utf-8")
    write(root, "lib/services/auth_service.dart", auth.replace("'/auth/csrf'", "'/auth/csrf-fallback'"))
    result = refresh_project(store, root)
    assert calls == [1] and result.warnings and "update_flows" in result.warnings[0]
    assert store.conn.execute("SELECT count(*) FROM luong").fetchone()[0] > 0
    state = store.conn.execute(
        "SELECT trang_thai, thong_bao_loi FROM lan_lap_chi_muc ORDER BY ma_lan DESC LIMIT 1").fetchone()
    assert state["trang_thai"] == "hoan_tat" and state["thong_bao_loi"] is None
    assert_same_as_full_index(store, root, index_project, "fallback rebuild_flows")


def test_small_edit_updates_flows_without_a_full_rebuild(copy_fixture, index_project, monkeypatch):
    from nexgraph_engine.flows import build
    root = copy_fixture("flow_app")
    store, _, _ = index_project(root)
    kept = dict(store.conn.execute("SELECT ten, ma_luong FROM luong"))
    monkeypatch.setattr(build, "rebuild_flows", lambda *a, **k: pytest.fail("dựng lại toàn bộ luồng"))
    write(root, "service.py", (root / "service.py").read_text(encoding="utf-8").replace("def list_books():\n    return all_books()",
                                                                        "def list_books():\n    x = all_books()\n    return x"))
    refresh_project(store, root)
    after = dict(store.conn.execute("SELECT ten, ma_luong FROM luong"))
    assert after.keys() == kept.keys()
    assert after["login"] != kept["login"] or after["books"] != kept["books"]  # luồng qua service.py được tính lại


def _capped_project(tmp_path, index_project, monkeypatch):
    """Ba điểm vào ở ba tệp; MAX_FLOWS = 2 nên z_entry (điểm thấp nhất) là ứng viên bị cắt, không được lưu."""
    from nexgraph_engine.flows import build
    monkeypatch.setattr(build, "MAX_FLOWS", 2)
    write(tmp_path, "lib.py", "def leaf():\n    return 1\n\n\ndef mid():\n    return leaf()\n")
    write(tmp_path, "lib2.py", "def leaf2():\n    return 1\n")
    write(tmp_path, "x.py", "from lib import mid\n\n\ndef x_entry():\n    return mid()\n")
    write(tmp_path, "y.py", "from lib import mid\n\n\ndef y_entry():\n    return mid()\n")
    write(tmp_path, "z.py", "from lib2 import leaf2\n\n\ndef z_entry():\n    return leaf2()\n")
    store, _, _ = index_project(tmp_path)
    assert {r[0] for r in store.conn.execute("SELECT ten FROM luong")} == {"x_entry", "y_entry"}
    return store


def test_capped_flows_stored_flow_falling_below_an_unstored_candidate(tmp_path, index_project, monkeypatch):
    store = _capped_project(tmp_path, index_project, monkeypatch)
    write(tmp_path, "y.py", "def y_entry():\n    return y_local()\n\n\ndef y_local():\n    return 1\n")
    refresh_project(store, tmp_path)
    assert {r[0] for r in store.conn.execute("SELECT ten FROM luong")} == {"x_entry", "z_entry"}
    assert_same_as_full_index(store, tmp_path, index_project)


def test_capped_flows_unstored_candidate_rising_through_a_changed_callee(tmp_path, index_project, monkeypatch):
    from nexgraph_engine.flows import build
    store = _capped_project(tmp_path, index_project, monkeypatch)
    monkeypatch.setattr(build, "rebuild_flows", lambda *a, **k: pytest.fail("phải cập nhật cục bộ được"))
    write(tmp_path, "lib2.py", "def leaf2():\n    return l2()\n\n\ndef l2():\n    return l3()\n\n\ndef l3():\n    return 1\n")
    refresh_project(store, tmp_path)
    assert {r[0] for r in store.conn.execute("SELECT ten FROM luong")} == {"z_entry", "x_entry"}
    monkeypatch.undo()
    monkeypatch.setattr(build, "MAX_FLOWS", 2)
    assert_same_as_full_index(store, tmp_path, index_project)


def test_removing_a_duplicate_symbol_resolves_the_now_unique_name(tmp_path, index_project):
    write(tmp_path, "a.py", "def helper():\n    return 1\n")
    write(tmp_path, "b.py", "def helper():\n    return 2\n")
    write(tmp_path, "c.py", "def main():\n    return helper()\n")
    store, result, _ = index_project(tmp_path)
    assert result.state == "hoan_tat"
    (tmp_path / "b.py").unlink()
    refresh_project(store, tmp_path)
    assert_same_as_full_index(store, tmp_path, index_project, "xoá ký hiệu trùng")


def test_adding_a_dart_mixin_links_the_existing_with_clause(tmp_path, index_project):
    write(tmp_path, "pubspec.yaml", "name: m\n")
    write(tmp_path, "lib/a.dart", "class A with Walker {}\n")
    store, result, _ = index_project(tmp_path)
    assert result.state == "hoan_tat"
    write(tmp_path, "lib/walker.dart", "mixin Walker {}\n")
    refresh_project(store, tmp_path)
    assert_same_as_full_index(store, tmp_path, index_project, "thêm mixin")


def test_same_second_rewrite_after_indexing_is_detected_later(tmp_path, index_project, monkeypatch):
    import types
    src = tmp_path / "a.py"
    src.write_text("def old():\n    return 1\n", encoding="utf-8")
    store, result, _ = index_project(tmp_path)  # băm ngay sau khi ghi
    assert result.state == "hoan_tat"
    st = src.stat()
    src.write_text("def new():\n    return 1\n", encoding="utf-8")  # cùng cỡ, cùng giây (formatter, checkout + hook)
    os.utime(src, ns=(st.st_atime_ns, st.st_mtime_ns))
    real = time.time
    monkeypatch.setattr(refresh_mod, "time", types.SimpleNamespace(time=lambda: real() + 100))  # refresh chạy lâu sau đó
    assert refresh_project(store, tmp_path).changed == 1
