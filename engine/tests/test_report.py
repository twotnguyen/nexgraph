from nexgraph_engine.report.build import report_json, report_markdown


def test_report_excludes_tests_and_files(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    r = report_json(store)
    assert set(r) == {"god_nodes", "communities", "surprising", "questions", "benchmark", "truncated"}
    assert r["god_nodes"] and all(not g["node"]["is_test"] and g["node"]["kind"] != "file" for g in r["god_nodes"])
    assert r["god_nodes"] == sorted(r["god_nodes"], key=lambda g: -g["degree"])
    assert all(c["id"].startswith("com:") for c in r["communities"])
    assert all(set(q) == {"question", "why"} for q in r["questions"])
    assert r["truncated"] is False


def test_report_markdown_has_sections(copy_fixture, index_project):
    store, _, _ = index_project(copy_fixture("py_mini"))
    md = report_markdown(store, "py_mini")
    assert md.startswith("#") and "helper" in md


def test_report_markdown_has_no_invented_figures(copy_fixture, index_project):
    # Không có số từ thật và không gọi LLM: không in "~N words" hay "Token cost: 0 input".
    store, _, _ = index_project(copy_fixture("py_mini"))
    md = report_markdown(store, "py_mini")
    assert "words" not in md and "Token cost" not in md
    assert "- 3 files" in md


def test_report_route_unindexed_project(api, tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n")
    pid = api.open(tmp_path)["project_id"]
    r = api.get(f"/v1/projects/{pid}/report")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_indexed"


def test_report_route_ok(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    r = api.get(f"/v1/projects/{pid}/report")
    assert r.status_code == 200 and r.json()["god_nodes"]


def test_report_uses_published_graph_during_reindex(api, copy_fixture, monkeypatch):
    from nexgraph_engine.schema.db import open_graph_db
    from nexgraph_engine.store.graph_store import GraphStore
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    url = f"/v1/projects/{pid}/report"
    published = api.get(url).json()
    jobs = api.app.state.services.jobs
    monkeypatch.setattr(jobs, "is_active", lambda p: p == pid)
    r = api.get(url)
    assert r.status_code == 200 and r.json() == published
    monkeypatch.undo()
    # Lần lập chỉ mục tại chỗ từ một bản cũ có thể đã làm mất đồ thị tốt.
    conn = open_graph_db(api.app.state.services.registry.get(pid).graph_db)
    store = GraphStore(conn)
    store.set_run_state(store.begin_run(3), "huy")
    conn.close()
    r = api.get(url)
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_indexed"
