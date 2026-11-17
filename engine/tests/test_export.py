import pytest

from nexgraph_engine.bridge.to_nx import Scope
from nexgraph_engine.export.run import export_graph


@pytest.mark.parametrize("fmt,expect", [
    ("html", "py_mini app-graph.html"), ("callflow_html", "py_mini app-callflow.html"),
    ("obsidian", "py_mini app-obsidian"), ("wiki", "py_mini app-wiki"), ("svg", "py_mini app-graph.svg"),
    ("graphml", "py_mini app.graphml"), ("cypher", "py_mini app-cypher.txt"), ("json", "py_mini app-graph.json"),
    ("markdown", "py_mini app-GRAPH_REPORT.md")])
def test_export_each_format(copy_fixture, index_project, tmp_path, fmt, expect):
    store, _, _ = index_project(copy_fixture("py_mini"))
    r = export_graph(store, fmt, Scope(), tmp_path, "py_mini app")
    target = tmp_path / expect
    assert str(target) in r.files and target.exists()
    assert (target.is_dir() and any(target.iterdir())) or (target.is_file() and target.stat().st_size > 0)
    assert r.truncated is False


def test_export_does_not_call_llm(copy_fixture, index_project, tmp_path, monkeypatch):
    import shutil
    monkeypatch.setattr(shutil, "which", lambda name, *a, **k: pytest.fail(f"không được dò {name}"))
    store, _, _ = index_project(copy_fixture("py_mini"))
    export_graph(store, "wiki", Scope(), tmp_path, "x")


def test_export_community_scope(copy_fixture, index_project, tmp_path):
    store, _, _ = index_project(copy_fixture("py_mini"))
    cid = store.communities()[0]["id"] if store.communities() else None
    if cid is None:
        pytest.skip("fixture không có cụm")
    r = export_graph(store, "json", Scope(kind="community", value=f"com:{cid}"), tmp_path, "x")
    assert r.files


def _indexed(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    return pid


def test_export_route_ok(api, copy_fixture, tmp_path):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/export", json={"format": "json", "scope": {"kind": "all"}, "out_dir": str(tmp_path)})
    assert r.status_code == 200 and r.json()["files"] and r.json()["truncated"] is False


@pytest.mark.parametrize("out_dir", ["relative/dir", "/nonexistent/nexgraph-x"])
def test_export_route_bad_out_dir(api, copy_fixture, out_dir):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/export", json={"format": "json", "scope": {"kind": "all"}, "out_dir": out_dir})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_path"


def test_export_route_unindexed(api, tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.py").write_text("x = 1\n")
    pid = api.open(tmp_path / "src")["project_id"]
    r = api.post(f"/v1/projects/{pid}/export", json={"format": "json", "scope": {"kind": "all"}, "out_dir": str(tmp_path)})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_indexed"


@pytest.mark.parametrize("uri", [
    "http://127.0.0.1:7474", "https://example.com", "file:///etc/passwd",
    "http://169.254.169.254/latest/meta-data", "khong-co-scheme", "javascript:alert(1)",
])
def test_push_rejects_unsupported_scheme(api, copy_fixture, uri):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/export/push",
                 json={"target": "neo4j", "uri": uri, "user": "neo4j", "password": "s3cret-pw-scheme", "scope": {"kind": "all"}})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_param"
    assert "s3cret-pw-scheme" not in r.text


@pytest.mark.parametrize("uri", ["bolt://h:7687", "bolt+s://h", "neo4j://h", "neo4j+s://h", "redis://h", "rediss://h"])
def test_validate_push_uri_allows_driver_schemes(uri):
    from nexgraph_engine.export.run import validate_push_uri
    assert validate_push_uri(uri) == uri.split("://")[0]


def test_export_route_obeys_export_root(api, copy_fixture, tmp_path, monkeypatch):
    pid = _indexed(api, copy_fixture)
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    monkeypatch.setenv("NEXGRAPH_EXPORT_ROOT", str(allowed))
    body = {"format": "json", "scope": {"kind": "all"}, "out_dir": str(allowed)}
    assert api.post(f"/v1/projects/{pid}/export", json=body).status_code == 200
    body["out_dir"] = str(tmp_path)  # thư mục cha nằm ngoài root được phép
    r = api.post(f"/v1/projects/{pid}/export", json=body)
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_path"


def test_push_unreachable_server(api, copy_fixture):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/export/push",
                 json={"target": "neo4j", "uri": "bolt://127.0.0.1:1", "user": "neo4j", "password": "s3cret-pw", "scope": {"kind": "all"}})
    assert r.status_code == 502 and r.json()["error"]["code"] == "push_failed"
    assert "s3cret-pw" not in r.text  # mật khẩu không lộ trong thông điệp


def test_svg_export_of_graph_over_500_nodes(index_project, tmp_path):
    # networkx.spring_layout chuyển sang ma trận thưa (scipy) khi đồ thị >= 500 nút: lỗi thật trên dự án NestJS.
    root = tmp_path / "big"
    root.mkdir()
    for f in range(3):
        (root / f"m{f}.py").write_text("".join(f"def f{f}_{i}():\n    return f{f}_{(i + 1) % 200}()\n" for i in range(200)))
    store, _, _ = index_project(root)
    r = export_graph(store, "svg", Scope(), tmp_path, "big")
    assert (tmp_path / "big-graph.svg").stat().st_size > 0 and r.files


def test_export_route_unexpected_error_is_json(api, copy_fixture, tmp_path, monkeypatch):
    pid = _indexed(api, copy_fixture)
    import nexgraph_engine.api.routes_export as routes
    monkeypatch.setattr(routes, "export_graph", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    r = api.post(f"/v1/projects/{pid}/export", json={"format": "svg", "scope": {"kind": "all"}, "out_dir": str(tmp_path)})
    assert r.status_code == 500 and r.json()["error"]["code"] == "export_failed" and "boom" in r.json()["error"]["message"]
