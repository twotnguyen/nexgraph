from nexgraph_engine.index.discovery import discover
from nexgraph_engine.index.refresh import refresh_project


def test_discover_exclude(tmp_path):
    (tmp_path / "keep.py").write_text("x = 1\n")
    (tmp_path / "gen").mkdir()
    (tmp_path / "gen" / "skip.py").write_text("x = 1\n")
    assert {f.rel_path for f in discover(tmp_path, exclude=["gen/"])} == {"keep.py"}
    assert {f.rel_path for f in discover(tmp_path)} == {"keep.py", "gen/skip.py"}


def test_exclude_persists_for_refresh(tmp_path, index_project, monkeypatch):
    (tmp_path / "keep.py").write_text("x = 1\n")
    (tmp_path / "gen").mkdir()
    (tmp_path / "gen" / "skip.py").write_text("y = 1\n")
    import nexgraph_engine.index.indexer as ix
    real = ix.Indexer.__init__
    monkeypatch.setattr(ix.Indexer, "__init__", lambda self, *a, **k: real(self, *a, exclude=["gen/"], **k))
    store, _, _ = index_project(tmp_path)
    assert store.last_exclude() == ["gen/"]
    assert store.file_record("gen/skip.py") is None
    (tmp_path / "gen" / "skip.py").write_text("y = 2\n")
    refresh_project(store, tmp_path)
    assert store.file_record("gen/skip.py") is None


def _indexed(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    assert api.index(pid)["state"] == "done"
    return pid


def test_recluster_route(api, copy_fixture):
    pid = _indexed(api, copy_fixture)
    r = api.post(f"/v1/projects/{pid}/communities")
    assert r.status_code == 200 and r.json()["communities"] >= 0


def test_index_route_accepts_exclude(api, copy_fixture):
    pid = api.open(copy_fixture("py_mini"))["project_id"]
    r = api.post(f"/v1/projects/{pid}/index", json={"exclude": ["test_util.py"]})
    assert r.status_code == 202
    import time
    for _ in range(300):
        job = api.get(f"/v1/jobs/{r.json()['job_id']}").json()
        if job["state"] in ("done", "error"):
            break
        time.sleep(0.05)
    assert job["state"] == "done"
    s = api.get(f"/v1/projects/{pid}/stats").json()
    assert s["files"] == 2
