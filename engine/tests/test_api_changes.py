import hashlib
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

import pytest

from nexgraph_engine.changes import gitdiff
from nexgraph_engine.index import refresh_service
from nexgraph_engine.index.indexer import Indexer, ProgressEvent

needs_git = pytest.mark.skipif(shutil.which("git") is None, reason="cần git trong PATH")
GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
AUTH = "lib/services/auth_service.dart"


def git(root: Path, *args: str) -> None:
    out = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t.t", "-c", "commit.gpgsign=false", *args],
                         cwd=root, env=GIT_ENV, capture_output=True, text=True, encoding="utf-8")
    assert out.returncode == 0, out.stderr


def make_repo(root: Path) -> None:
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")


def edit(root: Path, rel: str, old: str, new: str) -> None:
    p = root / rel
    text = p.read_text(encoding="utf-8")
    assert old in text
    p.write_text(text.replace(old, new), encoding="utf-8")


def snapshot(d: Path) -> dict[str, str]:
    return {str(p.relative_to(d)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(d.rglob("*")) if p.is_file()}


class Blocking(Indexer):
    gate = threading.Event()

    def run(self):
        self.on_progress(ProgressEvent("structure", 0, 9))
        while not self.gate.is_set() and not self.cancel.is_set():
            time.sleep(0.01)
        self.on_progress(ProgressEvent("done", 0, 9))


@pytest.fixture
def opened(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    p = api.open(root)
    assert api.index(p["project_id"])["state"] == "done"
    return root, p["project_id"]


def drain(sub):
    out = []
    while (e := sub.get(0.05)) is not None:
        out.append(e)
    return out


def test_refresh_reports_counts_and_events(api, opened):
    root, pid = opened
    sub = api.app.state.services.bus.subscribe()
    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf2'")
    r = api.post(f"/v1/projects/{pid}/refresh")
    assert r.status_code == 200
    body = r.json()
    assert (body["status"], body["reason"], body["added"], body["changed"], body["removed"]) == ("ok", None, 0, 1, 0)
    assert {"changes_updated", "graph_updated"} <= {e["type"] for e in drain(sub)}
    again = api.post(f"/v1/projects/{pid}/refresh").json()
    assert (again["status"], again["changed"]) == ("ok", 0)
    assert drain(sub) == []
    sub.close()
    assert api.post("/v1/projects/nope/refresh").status_code == 404


def test_refresh_response_shows_fallback_warning(api, opened, monkeypatch):
    from nexgraph_engine.index.refresh import RefreshResult

    real = refresh_service.refresh_project

    def with_warning(store, root, *, transcript_dir=None):
        r = real(store, root, transcript_dir=transcript_dir)
        return RefreshResult(r.added, r.changed, r.removed, r.unchanged, r.seconds,
                             ("update_flows lỗi; đã dựng lại toàn bộ luồng",))

    monkeypatch.setattr(refresh_service, "refresh_project", with_warning)
    root, pid = opened
    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf-warn'")
    body = api.post(f"/v1/projects/{pid}/refresh").json()
    assert body["status"] == "ok" and "update_flows" in body["warnings"][0]


def test_refresh_skipped_while_indexing(api, opened):
    _, pid = opened
    Blocking.gate = threading.Event()
    api.app.state.services.jobs._indexer_cls = Blocking
    try:
        assert api.post(f"/v1/projects/{pid}/index").status_code == 202
        r = api.post(f"/v1/projects/{pid}/refresh").json()
        assert (r["status"], r["reason"]) == ("skipped", "index_running")
    finally:
        Blocking.gate.set()


def test_refresh_skipped_when_never_indexed(api, copy_fixture):
    pid = api.open(copy_fixture("bookstore_app"))["project_id"]
    r = api.post(f"/v1/projects/{pid}/refresh").json()
    assert (r["status"], r["reason"]) == ("skipped", "not_indexed")


def test_concurrent_refresh_second_is_skipped(api, opened, monkeypatch):
    _, pid = opened
    started, release = threading.Event(), threading.Event()
    real = refresh_service.refresh_project

    def slow(store, root, **kw):
        started.set()
        release.wait(15)
        return real(store, root, **kw)

    monkeypatch.setattr(refresh_service, "refresh_project", slow)
    service = api.app.state.services.refresh
    first = threading.Thread(target=lambda: service.refresh(pid))
    first.start()
    assert started.wait(15)
    second = service.refresh(pid)
    assert (second["status"], second["reason"]) == ("skipped", "refresh_running")
    release.set()
    first.join(15)
    assert service.refresh(pid)["status"] == "ok"


@needs_git
def test_edit_function_shows_impact_and_tests(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    make_repo(root)
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    clean = api.get(f"/v1/projects/{pid}/changes").json()
    assert clean["changed_files"] == [] and clean["impacted"] == [] and clean["tests"] == []

    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf2'")
    body = api.get(f"/v1/projects/{pid}/changes").json()
    assert body["base"] == "git_head" and len(body["base_commit"]) == 40 and body["note"] is None
    assert body["changed_files"] == [{"path": AUTH, "status": "M", "old_path": None}]
    assert "AuthService.login" in {n["qualified_name"] for n in body["changed_nodes"]}
    impacted = {i["node"]["qualified_name"]: i for i in body["impacted"]}
    assert impacted["_LoginScreenState.build"]["score"] == 1.0 and impacted["_LoginScreenState.build"]["hops"] == 1
    assert "login returns a user" in {t["label"] for t in body["tests"]}
    assert body["test_gaps"] == [] and body["truncated"] is False

    edit(root, AUTH, "  Future<User> login(", "  void logout() {}\n\n  Future<User> login(")
    body = api.get(f"/v1/projects/{pid}/changes").json()
    assert {n["qualified_name"] for n in body["test_gaps"]} == {"AuthService.logout"}


def test_changes_without_git_uses_last_index(api, opened):
    root, pid = opened
    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf2'")
    body = api.get(f"/v1/projects/{pid}/changes").json()
    assert body["base"] == "last_index" and body["base_commit"] is None and body["note"].startswith("Không có Git")
    assert [f["path"] for f in body["changed_files"]] == [AUTH]
    assert "AuthService.login" in {n["qualified_name"] for n in body["changed_nodes"]}
    assert api.index(pid)["state"] == "done"
    assert api.get(f"/v1/projects/{pid}/changes").json()["changed_files"] == []


@needs_git
def test_project_without_git_does_not_inherit_the_parent_repository(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    parent = root.parent
    (parent / "outer.py").write_text("outer = True\n", encoding="utf-8")
    make_repo(parent)
    project = api.open(root)
    pid = project["project_id"]
    assert not project["is_git"]
    assert api.index(pid)["state"] == "done"
    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf2'")
    changes = api.get(f"/v1/projects/{pid}/changes").json()
    assert changes["base"] == "last_index" and changes["base_commit"] is None
    assert [entry["path"] for entry in changes["changed_files"]] == [AUTH]


@needs_git
def test_changes_does_not_touch_git(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    make_repo(root)
    pid = api.open(root)["project_id"]
    api.index(pid)
    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf2'")
    os.utime(root / AUTH, (1, 1))
    before = snapshot(root / ".git")
    api.get(f"/v1/projects/{pid}/changes")
    api.post(f"/v1/projects/{pid}/refresh")
    assert snapshot(root / ".git") == before


def test_changes_refresh_false_does_not_write(api, opened):
    root, pid = opened
    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf2'")
    db = root / ".nexgraph" / "graph.db"
    before = (db.stat().st_size, db.stat().st_mtime_ns)
    body = api.get(f"/v1/projects/{pid}/changes", params={"refresh": "false"}).json()
    assert (db.stat().st_size, db.stat().st_mtime_ns) == before  # tệp -wal/-shm có thể được tạo khi mở đọc
    assert body["changed_nodes"] == []  # đồ thị chưa được làm mới
    assert api.get(f"/v1/projects/{pid}/changes", params={"refresh": "true"}).json()["changed_nodes"]


@needs_git
def test_changes_truncated_flag(api, copy_fixture, monkeypatch):
    root = copy_fixture("bookstore_app")
    make_repo(root)
    pid = api.open(root)["project_id"]
    api.index(pid)
    monkeypatch.setattr(gitdiff, "MAX_FILES", 1)
    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf2'")
    (root / "lib/main.dart").write_text((root / "lib/main.dart").read_text(encoding="utf-8") + "\n// x\n", encoding="utf-8")
    body = api.get(f"/v1/projects/{pid}/changes").json()
    assert body["truncated"] is True and len(body["changed_files"]) == 1


def test_routes_need_token_and_host(api, opened):
    _, pid = opened
    for method, url in (("get", f"/v1/projects/{pid}/changes"), ("post", f"/v1/projects/{pid}/refresh")):
        r = getattr(api.client, method)(url)
        assert r.status_code == 401
        r = getattr(api.client, method)(url, headers={**api.headers, "Host": "evil.example"})
        assert r.status_code == 403
    assert api.get("/v1/projects/nope/changes").status_code == 404
