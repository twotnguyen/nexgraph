import json
import shutil
import time

from nexgraph_engine.global_graph.store import GlobalStore

APP_CALL = ("src/cart.ts::checkout#function", "src/calculator.ts::Calculator.add#method")


def _wait(api, job_id, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        job = api.get(f"/v1/jobs/{job_id}").json()
        if job["state"] in ("done", "error", "cancelled"):
            assert job["state"] == "done", job
            return job
        time.sleep(0.02)
    raise AssertionError("job không kết thúc")


def _wait_edges(api, pred, timeout=30):
    store = GlobalStore(api.app.state.services.data_dir)
    end = time.time() + timeout
    while time.time() < end:
        rows = store.edges()
        if pred(rows):
            return rows
        time.sleep(0.05)
    raise AssertionError(store.edges())


def _pair(api, copy_fixture, index=True):
    pids = []
    for name in ("global_ts_lib", "global_ts_app"):
        p = api.open(copy_fixture(name))
        if index:
            assert api.index(p["project_id"])["state"] == "done"
        pids.append(p["project_id"])
    return pids


def _join(api, *pids):
    for pid in pids:
        r = api.post("/v1/global/projects", json={"project_id": pid})
        assert r.status_code == 200, r.text
        _wait(api, r.json()["job_id"])


def test_add_both_then_index_creates_cross_edges(api, copy_fixture):
    lib, app = _pair(api, copy_fixture, index=False)
    _join(api, lib, app)
    assert GlobalStore(api.app.state.services.data_dir).edges() == []  # chưa index: không có gì để nối
    assert api.index(lib)["state"] == "done"
    assert api.index(app)["state"] == "done"  # móc cuối job index chạy relink
    rows = _wait_edges(api, lambda rows: any((r["id_nut_nguon"], r["id_nut_dich"]) == APP_CALL for r in rows))
    assert {r["muc_tin_cay"] for r in rows} == {"INFERRED"}
    listed = api.get("/v1/global/projects").json()
    assert [(m["project_id"], m["available"]) for m in listed] == [(lib, True), (app, True)]


def test_add_unknown_project_404(api):
    r = api.post("/v1/global/projects", json={"project_id": "0" * 36})
    assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_project"


def test_delete_member_removes_edges(api, copy_fixture):
    lib, app = _pair(api, copy_fixture)
    _join(api, lib, app)
    assert GlobalStore(api.app.state.services.data_dir).edges()
    r = api.delete(f"/v1/global/projects/{lib}")
    assert r.status_code == 200
    assert GlobalStore(api.app.state.services.data_dir).edges() == []  # ngay, không đợi job
    _wait(api, r.json()["job_id"])
    assert GlobalStore(api.app.state.services.data_dir).edges() == []
    assert api.delete(f"/v1/global/projects/{lib}").status_code == 404


def test_search_skips_removed_and_missing(api, copy_fixture, tmp_path):
    lib, app = _pair(api, copy_fixture)
    third = api.open(copy_fixture("py_mini"))
    assert api.index(third["project_id"])["state"] == "done"
    _join(api, lib, app, third["project_id"])
    hits = api.get("/v1/global/search", params={"q": "Calculator"}).json()
    assert {h["project_id"] for h in hits} == {lib}
    assert hits[0]["project_name"] == "global_ts_lib app" and hits[0]["node"]["label"] == "Calculator"
    assert api.delete(f"/v1/projects/{lib}").status_code in (200, 204)  # gỡ khỏi app
    for t in list(api.app.state.services.jobs._threads):  # job relink do việc gỡ khởi chạy còn mở graph.db (Windows khoá tệp)
        t.join(30)
    shutil.rmtree(api.app.state.services.registry.get(app).path)  # mất thư mục
    r = api.get("/v1/global/search", params={"q": "checkout"})
    assert r.status_code == 200 and r.json() == []
    r = api.get("/v1/global/graph")
    assert r.status_code == 200 and r.json()["skipped"] == [app]  # lib đã rời nhóm khi bị gỡ khỏi app
    listed = {m["project_id"]: m["available"] for m in api.get("/v1/global/projects").json()}
    assert listed == {app: False, third["project_id"]: True}


def test_graph_merges_with_prefixed_ids(api, copy_fixture):
    lib, app = _pair(api, copy_fixture)
    _join(api, lib, app)
    g = api.get("/v1/global/graph", params={"projects": f"{lib},{app}"}).json()
    ids = {n["id"] for n in g["nodes"]}
    assert f"{app}::{APP_CALL[0]}" in ids and f"{lib}::{APP_CALL[1]}" in ids
    assert all(n["project_id"] in (lib, app) for n in g["nodes"])
    cross = [e for e in g["edges"] if e.get("cross_repo")]
    assert any((e["source"], e["target"]) == (f"{app}::{APP_CALL[0]}", f"{lib}::{APP_CALL[1]}") for e in cross)
    assert all(e["source"] in ids and e["target"] in ids for e in g["edges"])
    assert len({e["id"] for e in g["edges"]}) == len(g["edges"])
    only_lib = api.get("/v1/global/graph", params={"projects": lib}).json()
    assert not any(e.get("cross_repo") for e in only_lib["edges"])


def test_export_writes_merged_graph_json(api, copy_fixture, tmp_path):
    lib, app = _pair(api, copy_fixture)
    _join(api, lib, app)
    out = tmp_path / "out"
    out.mkdir()
    r = api.post("/v1/global/export", json={"out_dir": str(out)})
    assert r.status_code == 200, r.text
    data = json.loads((out / "nexgraph-global-graph.json").read_text(encoding="utf-8"))
    repos = {n.get("repo") for n in data["nodes"]}
    assert repos == {"global_ts_lib app", "global_ts_app app"}
    cross = [link for link in data["links"] if link.get("context") == "cross_repo"]
    assert {"source": f"global_ts_app app::{APP_CALL[0]}", "target": f"global_ts_lib app::{APP_CALL[1]}"}.items() <= next(
        link for link in cross if link["target"].endswith("Calculator.add#method")).items()
    assert all(link["confidence"] == "INFERRED" for link in cross)
    assert api.post("/v1/global/export", json={"out_dir": "relative"}).status_code == 400


def test_newer_global_db_is_409(api):
    from nexgraph_engine.schema.db import GLOBAL_SCHEMA_VERSION, open_global_db
    conn = open_global_db(api.app.state.services.data_dir / "global.db")
    conn.execute(f"PRAGMA user_version = {GLOBAL_SCHEMA_VERSION + 1}")
    conn.close()
    r = api.get("/v1/global/projects")
    assert r.status_code == 409 and r.json()["error"]["code"] == "schema_version"
    assert api.get("/v1/global/search", params={"q": "x"}).status_code == 409


def test_search_filters_projects(api, copy_fixture):
    lib, app = _pair(api, copy_fixture)
    _join(api, lib, app)
    assert api.get("/v1/global/search", params={"q": "Calculator", "projects": app}).json() == []
    hits = api.get("/v1/global/search", params={"q": "Calculator", "projects": f"{lib},{app}"}).json()
    assert {h["project_id"] for h in hits} == {lib}


def test_graph_limit_counts_forced_nodes(api, copy_fixture):
    lib, app = _pair(api, copy_fixture)
    _join(api, lib, app)
    for limit in (1, 2, 3, 5):
        g = api.get("/v1/global/graph", params={"limit": limit}).json()
        assert len(g["nodes"]) <= limit and g["truncated"]


def test_removing_project_from_app_leaves_the_group(api, copy_fixture):
    lib, app = _pair(api, copy_fixture)
    _join(api, lib, app)
    assert GlobalStore(api.app.state.services.data_dir).edges()
    assert api.delete(f"/v1/projects/{lib}").status_code == 200
    assert [m["project_id"] for m in api.get("/v1/global/projects").json()] == [app]
    assert GlobalStore(api.app.state.services.data_dir).edges() == []
