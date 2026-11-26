"""Kịch bản demo bước 4 qua HTTP trên một repo Git thật: sửa hàm, vùng ảnh hưởng, test liên quan, test gap."""
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

import pytest

from nexgraph_engine.pipeline.legacy_indexer import Indexer, ProgressEvent

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="cần git trong PATH")
GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}
AUTH = "lib/services/auth_service.dart"


def git(root: Path, *args: str) -> None:
    out = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t.t", "-c", "commit.gpgsign=false", *args],
                         cwd=root, env=GIT_ENV, capture_output=True, text=True, encoding="utf-8")
    assert out.returncode == 0, out.stderr


def edit(root: Path, rel: str, old: str, new: str) -> None:
    p = root / rel
    text = p.read_text(encoding="utf-8")
    assert old in text
    p.write_text(text.replace(old, new), encoding="utf-8")


def graph_signature(api, pid) -> tuple:
    s = api.get(f"/v1/projects/{pid}/stats").json()
    return (s["files"], tuple(sorted(s["nodes_by_kind"].items())), tuple(sorted(s["edges_by_type"].items())), s["unresolved"])


@pytest.fixture
def repo_project(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    git(root, "init", "-q", "-b", "main")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    return root, pid


def test_demo_step_4_edit_refresh_changes_revert(api, repo_project):
    root, pid = repo_project
    initial = graph_signature(api, pid)
    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf2'")
    assert api.post(f"/v1/projects/{pid}/refresh").json()["changed"] == 1
    body = api.get(f"/v1/projects/{pid}/changes", params={"refresh": "false"}).json()
    assert body["base"] == "git_head"
    assert {n["qualified_name"] for n in body["changed_nodes"]} == {"AuthService", "AuthService.login"}
    impacted = {i["node"]["qualified_name"]: i for i in body["impacted"]}
    assert impacted["_LoginScreenState.build"]["score"] == 1.0
    assert "login returns a user" in {t["label"] for t in body["tests"]}
    assert body["test_gaps"] == []
    # hoàn tác bằng Git: không còn thay đổi và đồ thị trở lại như ban đầu
    git(root, "checkout", "--", ".")
    assert api.post(f"/v1/projects/{pid}/refresh").json()["changed"] == 1
    clean = api.get(f"/v1/projects/{pid}/changes", params={"refresh": "false"}).json()
    assert clean["changed_files"] == [] and clean["impacted"] == []
    assert graph_signature(api, pid) == initial


def test_rename_a_file_reports_rename_and_keeps_the_graph_consistent(api, repo_project):
    root, pid = repo_project
    git(root, "mv", "lib/widgets/primary_button.dart", "lib/widgets/main_button.dart")
    body = api.get(f"/v1/projects/{pid}/changes").json()
    assert {(f["path"], f["status"], f["old_path"]) for f in body["changed_files"]} == {
        ("lib/widgets/main_button.dart", "R", "lib/widgets/primary_button.dart")}
    assert any(n["file"] == "lib/widgets/main_button.dart" for n in body["changed_nodes"])
    stats = api.get(f"/v1/projects/{pid}/stats").json()
    assert stats["files"] == 9


def test_no_git_flow_and_reindex_clears_changes(api, copy_fixture):
    root = copy_fixture("bookstore_app")
    pid = api.open(root)["project_id"]
    api.index(pid)
    (root / "lib/services/cart.dart").write_text("class Cart {\n  void add() {}\n}\n", encoding="utf-8")
    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf2'")
    body = api.get(f"/v1/projects/{pid}/changes").json()
    assert body["base"] == "last_index" and body["note"].startswith("Không có Git")
    assert {(f["path"], f["status"]) for f in body["changed_files"]} == {(AUTH, "M"), ("lib/services/cart.dart", "A")}
    api.index(pid)
    assert api.get(f"/v1/projects/{pid}/changes").json()["changed_files"] == []


def test_edit_during_indexing_is_skipped_then_caught_up(api, repo_project):
    root, pid = repo_project

    class Blocking(Indexer):
        gate = threading.Event()

        def run(self):
            self.on_progress(ProgressEvent("structure", 0, 9))
            self.gate.wait(5)
            return super().run()

    api.app.state.services.jobs._indexer_cls = Blocking
    job = api.post(f"/v1/projects/{pid}/index").json()["job_id"]
    edit(root, AUTH, "'/auth/csrf'", "'/auth/csrf2'")
    assert api.post(f"/v1/projects/{pid}/refresh").json()["reason"] == "index_running"
    Blocking.gate.set()
    end = time.time() + 20
    while api.get(f"/v1/jobs/{job}").json()["state"] not in ("done", "error"):
        assert time.time() < end
        time.sleep(0.02)
    # lần lập chỉ mục đầy đủ đã thấy bản sửa; refresh sau đó không còn gì để làm và đồ thị đúng
    assert api.post(f"/v1/projects/{pid}/refresh").json()["changed"] == 0
    assert "AuthService.login" in {n["qualified_name"] for n in
                                    api.get(f"/v1/projects/{pid}/changes", params={"refresh": "false"}).json()["changed_nodes"]}
