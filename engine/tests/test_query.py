import pytest

from nexgraph_engine.query.ask import ask_graph
from nexgraph_engine.query.paths import PATH_TYPES, find_paths, impact_of


def test_path_through_real_edges(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    r = find_paths(store, ["main.py::App.step#method", "util.py::helper#function"])
    assert r["unconnected"] == []
    assert r["edges"] and {e["type"] for e in r["edges"]} <= {t.value for t in PATH_TYPES}
    assert r["edges"][0]["source"] == "main.py::App.step#method"
    assert {"main.py::App.step#method", "util.py::helper#function"} <= {n["id"] for n in r["nodes"]}


def test_path_directed_vs_undirected(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    back = ["util.py::helper#function", "main.py::App.step#method"]
    assert find_paths(store, back)["unconnected"] == ["main.py::App.step#method"]
    assert find_paths(store, back, directed=False)["unconnected"] == []


def test_path_unconnected_reports_node(tmp_path, index_project):
    (tmp_path / "a.py").write_text("def f():\n    return 1\n")
    (tmp_path / "b.py").write_text("def g():\n    return 2\n")
    store, _, _ = index_project(tmp_path)
    r = find_paths(store, ["a.py::f#function", "b.py::g#function"])
    assert r["unconnected"] == ["b.py::g#function"] and r["edges"] == []


def test_path_unknown_node(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    with pytest.raises(KeyError):
        find_paths(store, ["nope", "util.py::helper#function"])


def test_impact_of_node_lists_callers(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    r = impact_of(store, "util.py::helper#function")
    assert r["node"]["id"] == "util.py::helper#function"
    assert "main.py::App.step#method" in {i["node"]["id"] for i in r["impacted"]}
    assert set(r) == {"node", "impacted", "tests", "truncated"}
    assert "test_util.py::test_helper#function" in {t["id"] for t in r["tests"]}


def test_ask_graph_respects_budget(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    small = ask_graph(store, "helper", budget=5)
    assert small["seeds"] and small["truncated"]
    full = ask_graph(store, "helper", budget=100_000)
    assert not full["truncated"] and len(full["nodes"]) > len(small["nodes"])
    assert "main.py::App.step#method" in {n["id"] for n in full["nodes"]}


def test_ask_graph_dfs_mode(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    r = ask_graph(store, "helper", mode="dfs", budget=100_000)
    assert r["seeds"] and r["nodes"]


def test_ask_graph_matches_any_word_of_a_question(copy_fixture, index_project):
    # Câu hỏi tự nhiên: không nút nào chứa đủ mọi từ; nút khớp nhiều từ hơn đứng trước (như graphify query).
    store, _, _ = index_project(copy_fixture("py_mini"))
    r = ask_graph(store, "how does the helper flow work")
    assert r["seeds"] and r["seeds"][0]["label"] == "helper"


def _indexed(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    return pid


def test_query_routes(api, copy_fixture):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/paths", json={"node_ids": ["main.py::App.step#method", "util.py::helper#function"]})
    assert r.status_code == 200 and r.json()["unconnected"] == []
    r = api.get(f"/v1/projects/{pid}/impact", params={"node": "util.py::helper#function"})
    assert r.status_code == 200 and r.json()["impacted"]
    r = api.post(f"/v1/projects/{pid}/ask", json={"question": "helper"})
    assert r.status_code == 200 and r.json()["seeds"]


@pytest.mark.parametrize("body", [{"node_ids": ["a"]}, {"node_ids": ["a", "b"], "max_hops": 0},
                                  {"node_ids": ["a", "b"], "max_hops": 7}])
def test_paths_bad_param(api, copy_fixture, body):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/paths", json=body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_param"


def test_query_route_errors(api, copy_fixture):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/paths", json={"node_ids": ["nope", "util.py::helper#function"]})
    assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_node"
    r = api.post(f"/v1/projects/{pid}/ask", json={"question": "???"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_param"
    r = api.post(f"/v1/projects/{pid}/ask", json={"question": "helper", "depth": 7})
    assert r.status_code == 400
