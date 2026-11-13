import threading

from nexgraph_engine.index.indexer import Indexer, ProgressEvent
import time


class Blocking(Indexer):
    gate = threading.Event()

    def run(self):
        self.on_progress(ProgressEvent("structure", 0, 9))
        while not self.gate.is_set() and not self.cancel.is_set():
            time.sleep(0.01)
        self.on_progress(ProgressEvent("cancelled" if self.cancel.is_set() else "done", 0, 9))


def test_open_project_and_list(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    p = api.open(root)
    assert set(p) == {"project_id", "path", "name", "is_git", "storage", "last_indexed_at", "last_index_commit"}
    assert p["last_indexed_at"] is None
    assert p["storage"] == "in_project" and p["is_git"] is False and p["name"] == "bookstore_app app"
    (listed,) = api.get("/v1/projects").json()
    assert listed["project_id"] == p["project_id"] and listed["last_indexed_at"] is None
    assert listed["last_index_commit"] is None


def test_open_missing_path_400(api, tmp_path):
    r = api.post("/v1/projects", json={"path": str(tmp_path / "missing")})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_path"
    assert api.post("/v1/projects", json={}).status_code == 400


def test_index_then_stats_nonzero(api, copy_fixture):
    p = api.open(copy_fixture("bookstore_app"))
    job = api.index(p["project_id"])
    assert job["state"] == "done" and job["files_total"] == 9 and job["project_id"] == p["project_id"]
    stats = api.get(f"/v1/projects/{p['project_id']}/stats").json()
    assert stats["files"] == 9 and stats["nodes_by_kind"]["widget"] == 3 and stats["edges_by_type"]["CALLS"] > 5
    (listed,) = api.get("/v1/projects").json()
    assert isinstance(listed["last_indexed_at"], int)
    assert api.open(listed["path"])["last_indexed_at"] == listed["last_indexed_at"]  # mở lại: app biết đã index


def test_index_twice_409_while_running(api, copy_fixture):
    p = api.open(copy_fixture("bookstore_app"))
    Blocking.gate = threading.Event()
    api.app.state.services.jobs._indexer_cls = Blocking
    try:
        first = api.post(f"/v1/projects/{p['project_id']}/index")
        assert first.status_code == 202
        second = api.post(f"/v1/projects/{p['project_id']}/index")
        assert second.status_code == 409 and second.json()["error"]["code"] == "index_running"
        job_id = first.json()["job_id"]
        assert api.delete(f"/v1/jobs/{job_id}").json() == {"cancelled": True}
    finally:
        Blocking.gate.set()


def test_unknown_project_and_job(api):
    assert api.post("/v1/projects/nope/index").status_code == 404
    assert api.post("/v1/projects/nope/index").json()["error"]["code"] == "unknown_project"
    r = api.get("/v1/jobs/nope")
    assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_job"
    assert api.get("/v1/projects/nope/stats").status_code == 404


def test_all_routes_require_token_and_host(api, copy_fixture):
    p = api.open(copy_fixture("bookstore_app"))
    pid = p["project_id"]
    urls = ["/v1/health", "/v1/projects", f"/v1/projects/{pid}/stats", f"/v1/projects/{pid}/neighbors?node=x",
            f"/v1/projects/{pid}/code?file=lib/main.dart", "/v1/jobs/x", f"/v1/projects/{pid}/nodes/x"]
    for u in urls:
        assert api.client.get(u).status_code == 401, u
        assert api.client.get(u, headers={**api.headers, "Host": "evil.com"}).status_code == 403, u
    assert api.client.post("/v1/projects", json={"path": "/"}).status_code == 401


def test_index_with_subdir(api, copy_fixture):
    p = api.open(copy_fixture("bookstore_app"))
    pid = p["project_id"]
    r = api.post(f"/v1/projects/{pid}/index", json={"subdir": "lib/services"})
    assert r.status_code == 202
    for _ in range(300):
        job = api.get(f"/v1/jobs/{r.json()['job_id']}").json()
        if job["state"] in ("done", "error", "cancelled"):
            break
        time.sleep(0.02)
    assert job["state"] == "done" and job["files_total"] == 2
    stats = api.get(f"/v1/projects/{pid}/stats").json()
    assert stats["files"] == 2
    node = api.get(f"/v1/projects/{pid}/nodes/lib%2Fservices%2Fauth_service.dart%23file")
    assert node.status_code == 200


def test_index_bad_subdir_is_400_and_creates_no_job(api, copy_fixture):
    pid = api.open(copy_fixture("bookstore_app"))["project_id"]
    for bad in ("../x", "/etc", "nope", "lib/main.dart"):
        r = api.post(f"/v1/projects/{pid}/index", json={"subdir": bad})
        assert r.status_code == 400 and r.json()["error"]["code"] == "bad_path", bad
    assert api.index(pid)["state"] == "done"  # không có job nào bị kẹt


def test_scan_route(api, copy_fixture):
    pid = api.open(copy_fixture("bookstore_app"))["project_id"]
    body = api.get(f"/v1/projects/{pid}/scan").json()
    assert body["files"] == 9 and body["large"] is False and body["threshold"] == 5000
    assert body["by_language"] == {"dart": 9} and body["top_dirs"][0] == {"path": "lib", "files": 8}
    assert api.get("/v1/projects/nope/scan").status_code == 404
