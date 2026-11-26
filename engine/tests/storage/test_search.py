from pathlib import Path

import pytest

from nexgraph_engine.core.schema.enums import NodeKind
from nexgraph_engine.storage.store.search import build_match_query, search


def write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


@pytest.fixture
def bookstore(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    return store


def ids(hits):
    return [n.id for n, _ in hits]


def test_exact_name_first(bookstore):
    hits = search(bookstore.conn, "AuthService")
    assert ids(hits)[0] == "lib/services/auth_service.dart::AuthService#class"
    assert "lib/services/auth_service.dart::AuthService.login#method" in ids(hits)
    scores = [s for _, s in hits]
    assert scores == sorted(scores, reverse=True)


def test_prefix_and_camel_parts(bookstore):
    assert "lib/services/auth_service.dart::AuthService#class" in ids(search(bookstore.conn, "authserv"))
    got = ids(search(bookstore.conn, "login"))
    assert "lib/services/auth_service.dart::AuthService.login#method" in got
    assert "lib/screens/login_screen.dart::LoginScreen#widget" in got
    assert "lib/screens/login_screen.dart#file" in got
    assert "lib/services/auth_service.dart::AuthService#class" in ids(search(bookstore.conn, "auth service"))


def test_kinds_filter_limit_and_no_repository(bookstore):
    methods = search(bookstore.conn, "login", kinds={NodeKind.METHOD})
    assert methods and all(n.kind == NodeKind.METHOD for n, _ in methods)
    assert len(search(bookstore.conn, "login", limit=2)) == 2
    assert all(n.kind != NodeKind.REPOSITORY for n, _ in search(bookstore.conn, "app"))


def test_search_in_doc_comments_and_signature(tmp_path, index_project):
    root = tmp_path / "proj"
    write(root, "lib/pay.dart", "/// Creates invoice for a customer.\nvoid pay(Money wallet) {}\n")
    store, _, _ = index_project(root)
    assert "lib/pay.dart::pay#function" in ids(search(store.conn, "invoice"))  # chỉ có trong tài liệu
    assert "lib/pay.dart::pay#function" in ids(search(store.conn, "wallet"))   # chỉ có trong chữ ký


def test_vietnamese_diacritics(tmp_path, index_project):
    root = tmp_path / "proj"
    write(root, "lib/a.dart", "/// Đăng nhập vào hệ thống\nvoid signIn() {}\n")
    store, _, _ = index_project(root)
    # Tokenizer `unicode61` mặc định bỏ dấu `ă` nhưng không gập `đ` thành `d` và không gập hết dấu chồng như `ậ`:
    # "dang", "nhap" không đảm bảo khớp (giới hạn ghi ở UC04); gõ có dấu thì luôn khớp.
    for q in ("đăng", "đang", "nhập", "hệ thống"):
        assert "lib/a.dart::signIn#function" in ids(search(store.conn, q)), q


@pytest.mark.parametrize("q", ['"', '"unclosed', "*", "-login", "login AND", "a OR", "NEAR(a b)", "login:", "(((",
                               "\\", "x" * 5000, "login OR OR", "^login", "{login}", "auth*service", "a b c d e f g h i j"])
def test_special_characters_never_break_query(bookstore, q):
    assert isinstance(search(bookstore.conn, q), list)


def test_build_match_query():
    assert build_match_query("") is None and build_match_query('"*-') is None and build_match_query("___") is None
    assert build_match_query("login") == '"login"*'
    assert build_match_query("LoginScreen") == '("loginscreen"* OR ("login" AND "screen"))'
    assert build_match_query("a b") == '"a"* AND "b"*'
    assert build_match_query(" ".join(["abc"] * 20)).count("AND") == 7  # tối đa 8 từ
    assert build_match_query("login AND") == '"login"* AND "and"*'  # toán tử FTS trong dữ liệu chỉ là chữ thường


def test_search_ranks_production_symbol_above_same_named_test_double(tmp_path, index_project):
    (tmp_path / "db.py").write_text("class SessionDB:\n    def get(self):\n        return 1\n")
    (tmp_path / "test_db.py").write_text("class SessionDB:\n    def get(self):\n        return 2\n")
    store, _, _ = index_project(tmp_path)
    hits = search(store.conn, "SessionDB")
    assert [n.file for n, _ in hits[:2]] == ["db.py", "test_db.py"]
