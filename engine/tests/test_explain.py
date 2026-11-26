import pytest

from nexgraph_engine.core.errors import ApiError
from nexgraph_engine.analysis.query.explain import explain_json

TARGET = "t.py::target#function"


def _callers(prefix: str, n: int) -> str:
    return "from t import target\n\n" + "".join(f"def {prefix}{i}():\n    return target()\n\n" for i in range(n))


@pytest.fixture
def store(tmp_path, index_project):
    root = tmp_path / "p"
    root.mkdir()
    (root / "t.py").write_text("def target():\n    return helper()\n\ndef helper():\n    return 1\n", encoding="utf-8")
    for name, n in (("a", 10), ("b", 10), ("c", 5)):
        (root / f"{name}.py").write_text(_callers(name, n), encoding="utf-8")
    store, _, _ = index_project(root)
    return store


def _group(out, direction, type_):
    return next(g for g in out["groups"] if g["direction"] == direction and g["type"] == type_)


def test_explain_groups_and_overflow(store):
    out = explain_json(store, TARGET, limit=20)
    calls_in = _group(out, "in", "CALLS")
    assert calls_in["total"] == 25 and len(calls_in["nodes"]) == 20
    assert calls_in["more_by_file"] == [{"file": "c.py", "count": 5}]
    assert [n["label"] for n in _group(out, "out", "CALLS")["nodes"]] == ["helper"]
    assert [g["total"] for g in out["groups"]] == sorted((g["total"] for g in out["groups"]), reverse=True)
    assert not any(g["type"] == "CONTAINS" for g in out["groups"])


def test_explain_degree_and_community(store):
    out = explain_json(store, TARGET)
    assert out["node"]["id"] == TARGET
    assert out["degree"] == sum(g["total"] for g in out["groups"])
    assert out["community"] is None or (out["community"]["id"].startswith("com:") and out["community"]["label"])


def test_explain_unknown_404(store):
    with pytest.raises(ApiError) as exc:
        explain_json(store, "nope#file")
    assert exc.value.status == 404


def test_explain_route(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    r = api.get(f"/v1/projects/{pid}/explain", params={"node": "main.py::App.step#method", "limit": 5})
    assert r.status_code == 200, r.text
    assert r.json()["node"]["id"] == "main.py::App.step#method"
    assert api.get(f"/v1/projects/{pid}/explain", params={"node": "nope#file"}).status_code == 404
    assert api.get(f"/v1/projects/{pid}/explain", params={"node": "main.py#file", "limit": 0}).status_code in (400, 422)
