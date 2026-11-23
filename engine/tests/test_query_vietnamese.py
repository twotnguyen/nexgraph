"""A4-F4/MIN: câu hỏi tiếng Việt thuần không được khớp chuỗi con rác, và phải gợi ý thân thiện."""
import pytest

from nexgraph_engine.query.ask import ask_graph
from nexgraph_engine.query.context import build_context
from nexgraph_engine.query.terms import VI_STOPWORDS, has_vietnamese, name_matches
from nexgraph_engine.store.search import build_match_query, search


def test_get_context_vietnamese_only_is_friendly(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    pack = build_context(store, root, "làm sao đăng nhập")
    assert pack["items"] == [] and pack["flows"] == []
    assert "Chưa khớp từ khoá nào" in pack["suggestion"]
    assert "login" in pack["suggestion"] and "tên hàm/lớp/tệp" in pack["suggestion"]


def test_query_graph_vietnamese_does_not_match_substrings(copy_fixture, index_project):
    """`thế` không được khớp chuỗi con `the` trong `other` (A4-F4)."""
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    result = ask_graph(store, "người dùng đăng nhập thế nào")
    assert result["seeds"] == [] and result["nodes"] == []
    assert "other" not in {n["label"] for n in result["nodes"]}
    assert "Chưa khớp từ khoá nào" in result["suggestion"]


def test_query_graph_keeps_english_identifier_in_vietnamese_question(copy_fixture, index_project):
    root = copy_fixture("bookstore_app")
    store, _, _ = index_project(root)
    result = ask_graph(store, "người dùng đăng nhập bằng AuthService thế nào")
    assert result["seeds"] and result["seeds"][0]["label"] == "AuthService"
    assert "other" not in {n["label"] for n in result["nodes"]}


def test_get_context_keeps_english_identifier_in_vietnamese_question(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    pack = build_context(store, root, "làm sao dùng helper")
    assert pack["items"] and pack["items"][0]["node"]["label"] == "helper"


def test_get_context_has_no_words_still_errors(copy_fixture, index_project):
    import pytest
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    with pytest.raises(ValueError, match="không có từ nào"):
        build_context(store, root, "???")


def test_match_query_drops_vietnamese_stopwords_and_short_prefix():
    query = build_match_query("làm sao đăng nhập")
    assert query is not None
    assert '"lam"' not in query and '"sao"' not in query
    assert '"đăng"' in query  # từ nội dung vẫn giữ
    # Từ 2–3 ký tự chỉ khớp nguyên từ, không mở rộng tiền tố.
    assert build_match_query("lỗi đăng nhập") == '"lỗi" AND "đăng"* AND "nhập"*'


def test_ask_route_vietnamese_returns_suggestion(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    r = api.post(f"/v1/projects/{pid}/ask", json={"question": "người dùng đăng nhập thế nào"})
    assert r.status_code == 200 and r.json()["seeds"] == []
    assert "Chưa khớp từ khoá nào" in r.json()["suggestion"]
    r = api.post(f"/v1/projects/{pid}/context", json={"question": "làm sao đăng nhập"})
    assert r.status_code == 200 and r.json()["items"] == []
    assert "Chưa khớp từ khoá nào" in r.json()["suggestion"]


# --- I1 (review 23/11): định danh có dấu phân cách phải khớp camelCase và tên tệp ---


def test_name_matches_separator_identifiers():
    assert name_matches("AuthService", "auth_service")
    assert name_matches("auth_service.dart", "auth_service")
    assert name_matches("auth_service_test.dart", "AUTH_SERVICE")
    assert name_matches("auth-service.ts", "auth_service")
    assert name_matches("authService", "auth_service")  # camelCase ↔ snake_case
    assert not name_matches("author", "auth_service")  # không khớp một phần của cụm
    assert not name_matches("service", "auth_service")


def test_ask_keeps_snake_case_identifier_seeds(copy_fixture, index_project):
    """Câu tiếng Việt chứa định danh snake_case không được rỗng hạt giống (main có 3/2/2)."""
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    for question, expected in (
        ("sửa auth_service", {"AuthService", "auth_service.dart", "auth_service_test.dart"}),
        ("sửa api_client", {"ApiClient", "api_client.dart"}),
        ("lỗi trong api_client", {"ApiClient", "api_client.dart"}),
    ):
        result = ask_graph(store, question)
        assert {seed["label"] for seed in result["seeds"]} == expected, question


# --- I2 (review 23/11): từ có nghĩa không được nằm trong danh sách từ dừng ---


def test_vietnamese_stopwords_keep_meaningful_words():
    for word in ("nguoi", "dung", "bang", "chi", "qua", "moi", "con", "it", "nhieu"):
        assert word not in VI_STOPWORDS, word
    for word in ("la", "lam", "sao", "the", "nao", "gi", "cua", "va", "khong", "cac", "nhung", "o", "dau"):
        assert word in VI_STOPWORDS, word
    assert build_match_query("người dùng") == '"người"* AND "dùng"*'
    assert build_match_query("bảng người dùng") is not None


def _vietnamese_tree(tmp_path):
    """Cây Python đặt tên tiếng Việt như ca tái hiện trong review."""
    root = tmp_path / "Đồ án" / "vi app"
    root.mkdir(parents=True)
    (root / "nguoi_dung.py").write_text(
        "class NguoiDung:\n    def dang_nhap(self, mat_khau):\n        return True\n", encoding="utf-8")
    (root / "bang_nguoi_dung.py").write_text(
        "from nguoi_dung import NguoiDung\n\n\ndef tao_bang():\n    return {'admin': NguoiDung()}\n\n\n"
        "def tim_nguoi_dung(ten):\n    return tao_bang().get(ten)\n", encoding="utf-8")
    (root / "dang_nhap.py").write_text(
        "from bang_nguoi_dung import tim_nguoi_dung\n\n\ndef xu_ly_dang_nhap(ten, mat_khau):\n"
        "    nguoi = tim_nguoi_dung(ten)\n    return bool(nguoi and nguoi.dang_nhap(mat_khau))\n", encoding="utf-8")
    return root


def test_ask_vietnamese_words_on_vietnamese_named_tree(tmp_path, index_project):
    """Main cho 2/2/3/2 hạt giống; nhánh không được ít hơn (thêm tệp khớp là chấp nhận được)."""
    store, _, _ = index_project(_vietnamese_tree(tmp_path))
    assert {"nguoi_dung.py", "NguoiDung"} <= {s["label"] for s in ask_graph(store, "người dùng")["seeds"]}
    assert {"bang_nguoi_dung.py", "NguoiDung"} <= {s["label"] for s in ask_graph(store, "bảng người dùng")["seeds"]}
    assert {"NguoiDung", "nguoi_dung.py", "dang_nhap.py"} <= {
        s["label"] for s in ask_graph(store, "người dùng đăng nhập")["seeds"]}
    assert {"tim_nguoi_dung", "NguoiDung"} <= {s["label"] for s in ask_graph(store, "tìm người dùng")["seeds"]}
    # Hư từ ("thế", "nào") vẫn được chấm điểm như main để không mất hạt giống hợp lệ (`tim_nguoi_dung`).
    assert {"NguoiDung", "nguoi_dung.py", "tim_nguoi_dung", "dang_nhap.py"} <= {
        s["label"] for s in ask_graph(store, "người dùng đăng nhập thế nào")["seeds"]}


# --- I3 (review 23/11): chỉ ký tự thật sự tiếng Việt mới bật luật từ dừng ---


@pytest.mark.parametrize("text,expected", [
    ("user’s login", False),          # nháy cong U+2019
    ("what’s the login flow", False),
    ("😀 start", False),
    ("日本語", False),
    ("sửa auth_service", True),
    ("đăng nhập", True),
    ("Đồ án", True),
    ("café", True),                   # nguyên âm Latin có dấu
])
def test_has_vietnamese_detects_only_vietnamese_letters(text, expected):
    assert has_vietnamese(text) is expected


def test_search_with_curly_apostrophe_keeps_recall(copy_fixture, index_project):
    """`user’s login` (U+2019) phải giữ tiền tố như main: 1 hit AuthService.login, 11 item ngữ cảnh."""
    root = copy_fixture("bookstore_app")
    store, _, _ = index_project(root)
    assert build_match_query("user’s login") == '"user"* AND "s"* AND "login"*'
    hits = [node.id for node, _ in search(store.conn, "user’s login")]
    assert "lib/services/auth_service.dart::AuthService.login#method" in hits
    pack = build_context(store, root, "user’s login")
    assert len(pack["items"]) == 11
    assert pack["items"][0]["node"]["id"] == "lib/services/auth_service.dart::AuthService.login#method"
    assert len(build_context(store, root, "what’s the login flow")["items"]) == 12

