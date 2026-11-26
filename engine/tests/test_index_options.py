"""W2 Task 5: tuỳ chọn index tệp cấu hình, số tiến trình, index lại từ đầu."""
import time

from nexgraph_engine.pipeline.legacy_refresh import refresh_project


def _wait(api, job_id):
    for _ in range(400):
        job = api.get(f"/v1/jobs/{job_id}").json()
        if job["state"] in ("done", "error", "cancelled"):
            return job
        time.sleep(0.05)
    raise AssertionError("job không xong")


def test_config_flag_persists_for_refresh(tmp_path, index_project, monkeypatch):
    (tmp_path / "a.py").write_text("x = 1\n")
    (tmp_path / "package.json").write_text('{"name": "a", "dependencies": {"left-pad": "1"}}\n')
    import nexgraph_engine.pipeline.legacy_indexer as ix
    real = ix.Indexer.__init__
    monkeypatch.setattr(ix.Indexer, "__init__", lambda self, *a, **k: real(self, *a, include_config=True, **k))
    store, _, _ = index_project(tmp_path)
    assert store.last_config_flag() is True
    assert store.file_record("package.json") is not None
    time.sleep(1.1)
    (tmp_path / "tsconfig.json").write_text('{"compilerOptions": {}}\n')
    refresh_project(store, tmp_path)
    assert store.file_record("tsconfig.json") is not None


def test_index_route_accepts_config_workers_and_force(api, copy_fixture):
    root = copy_fixture("py_mini")
    (root / "package.json").write_text('{"name": "mini"}\n')
    pid = api.open(root)["project_id"]
    before = api.post(f"/v1/projects/{pid}/index", json={})
    assert _wait(api, before.json()["job_id"])["state"] == "done"
    files = api.get(f"/v1/projects/{pid}/stats").json()["files"]
    r = api.post(f"/v1/projects/{pid}/index", json={"include_config": True, "workers": 2, "force": True})
    assert r.status_code == 202
    assert _wait(api, r.json()["job_id"])["state"] == "done"
    assert api.get(f"/v1/projects/{pid}/stats").json()["files"] == files + 1


def test_index_route_rejects_bad_workers(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.post(f"/v1/projects/{pid}/index", json={"workers": 0}).status_code in (400, 422)


def test_force_starts_a_fresh_ast_cache(tmp_path, index_project, monkeypatch):
    from nexgraph_engine.index import generic
    (tmp_path / "a.go").write_text("package main\nfunc main() {}\n")
    before = generic._cache_root()
    import nexgraph_engine.pipeline.legacy_indexer as ix
    real = ix.Indexer.__init__
    monkeypatch.setattr(ix.Indexer, "__init__", lambda self, *a, **k: real(self, *a, force=True, **k))
    index_project(tmp_path)
    assert generic._cache_root() != before


def test_polyglot_stats_list_generic_languages(api, copy_fixture):
    pid = api.open(copy_fixture("polyglot"))["project_id"]
    r = api.post(f"/v1/projects/{pid}/index", json={})
    assert _wait(api, r.json()["job_id"])["state"] == "done"
    stats = api.get(f"/v1/projects/{pid}/stats").json()
    assert {"go", "rust", "java", "kotlin", "ruby", "php", "swift", "cpp", "c"} <= set(stats["generic_languages"])
