from nexgraph_engine.report.build import report_json, report_markdown


def test_report_excludes_tests_and_files(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    r = report_json(store, root)
    assert set(r) == {"god_nodes", "communities", "surprising", "questions", "benchmark", "truncated",
                      "cycles", "freshness", "gaps"}
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


def test_audit_ratios_sum_to_one(copy_fixture, index_project):
    from nexgraph_engine.report.build import audit_json
    store, _, _ = index_project(copy_fixture("bookstore_app"))
    audit = audit_json(store)
    want = dict(store.conn.execute("SELECT muc_tin_cay, count(*) FROM canh GROUP BY muc_tin_cay").fetchall())
    assert {k: v["count"] for k, v in audit["by_confidence"].items() if v["count"]} == want
    assert audit["edges"] == sum(want.values())
    assert abs(sum(v["ratio"] for v in audit["by_confidence"].values()) - 1) < 1e-3


def test_audit_lists_parse_errors(copy_fixture, index_project):
    from nexgraph_engine.report.build import audit_json
    store, _, _ = index_project(copy_fixture("bookstore_app"))  # lib/broken.dart cú pháp hỏng
    errors = audit_json(store)["parse_errors"]
    assert errors["total"] >= 1
    assert any(f["file"] == "lib/broken.dart" for f in errors["files"])
    assert sum(errors["by_kind"].values()) == errors["total"]


def _write(root, files):
    root.mkdir(parents=True, exist_ok=True)
    for rel, text in files.items():
        (root / rel).write_text(text, encoding="utf-8")
    return root


def test_report_lists_import_cycles(tmp_path, index_project):
    root = _write(tmp_path / "p", {"a.py": "import b\n\ndef fa():\n    return b.fb()\n",
                                   "b.py": "import a\n\ndef fb():\n    return 1\n"})
    store, _, _ = index_project(root)
    cycles = report_json(store, root)["cycles"]
    assert cycles["total"] == 1 and cycles["cycles"][0]["files"] == ["a.py", "b.py"]


def test_report_freshness_without_git(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    r = report_json(store, root)
    assert r["freshness"]["head_commit"] is None and r["freshness"]["stale"] is False
    assert r["cycles"]["total"] == 0


def test_report_gaps_isolated_and_ambiguous(tmp_path, index_project):
    root = _write(tmp_path / "p", {"m.py": "def lonely():\n    return 1\n\ndef caller():\n    return used()\n\n"
                                           "def used():\n    return 2\n"})
    store, _, _ = index_project(root)
    store.conn.execute("UPDATE canh SET muc_tin_cay = 'AMBIGUOUS', diem_tin_cay = 0.2 WHERE loai_canh = 'CALLS'")
    gaps = report_json(store, root)["gaps"]
    assert [n["label"] for n in gaps["isolated"]["nodes"]] == ["lonely"] and gaps["isolated"]["total"] == 1
    assert gaps["ambiguous_edges"]["total"] == 1
    assert gaps["ambiguous_edges"]["edges"][0]["confidence"] == "AMBIGUOUS"
