import pytest

from nexgraph_engine.query.context import build_context, rrf


def test_rrf_scores_and_reasons():
    out = rrf({"search": ["a", "b"], "flow": ["b", "c"]}, {"search": 1.0, "flow": 0.8})
    assert [x[0] for x in out] == ["b", "a", "c"]
    assert out[0][1] == pytest.approx(1.0 / 62 + 0.8 / 61) and sorted(out[0][2]) == ["flow", "search"]


def test_context_for_login_question(copy_fixture, index_project):
    root = copy_fixture("flow_app")
    store, _, _ = index_project(root)
    pack = build_context(store, root, "login password", budget=4000)
    ids = [i["node"]["id"] for i in pack["items"]]
    assert "service.py::login_user#function" in ids and "service.py::check_password#function" in ids
    assert not any(i["node"]["is_test"] for i in pack["items"])
    item = next(i for i in pack["items"] if i["node"]["id"] == "service.py::login_user#function")
    assert item["code"] == {"file": "service.py", "start": 4, "end": 7,
                            "text": "\n".join((root / "service.py").read_text().splitlines()[3:7])}
    assert pack["flows"][0]["name"] == "login" and pack["truncated"] is False
    assert pack["tokens"] == sum(len(i["code"]["text"]) // 4 + 20 for i in pack["items"])


def test_context_respects_budget(copy_fixture, index_project):
    root = copy_fixture("flow_app")
    store, _, _ = index_project(root)
    pack = build_context(store, root, "login password user session", budget=60)
    assert pack["truncated"] is True and 1 <= len(pack["items"]) <= 2 and pack["tokens"] <= 60


def test_context_includes_tests_only_when_asked(copy_fixture, index_project):
    root = copy_fixture("flow_app")
    store, _, _ = index_project(root)
    assert any(i["node"]["is_test"] for i in build_context(store, root, "test login", 4000)["items"])


def test_locate_innermost_symbol_then_file(api, pid_flow):
    assert api.get(f"/v1/projects/{pid_flow}/locate", params={"file": "service.py", "line": 6}).json()["node"]["id"] == "service.py::login_user#function"
    assert api.get(f"/v1/projects/{pid_flow}/locate", params={"file": "service.py", "line": 1}).json()["node"]["id"] == "service.py#file"
    assert api.get(f"/v1/projects/{pid_flow}/locate", params={"file": "nope.py", "line": 1}).json()["error"]["code"] == "file_not_found"
    assert api.post(f"/v1/projects/{pid_flow}/context", json={"question": "???"}).status_code == 400
    assert api.post(f"/v1/projects/{pid_flow}/context", json={"question": "login", "budget": 10}).status_code == 400
