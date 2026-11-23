"""A4-F4/MIN: câu hỏi tiếng Việt thuần không được khớp chuỗi con rác, và phải gợi ý thân thiện."""
from nexgraph_engine.query.ask import ask_graph
from nexgraph_engine.query.context import build_context
from nexgraph_engine.store.search import build_match_query


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
