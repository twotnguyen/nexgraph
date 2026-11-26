"""N2-E2: refresh pipeline so với manifest ĐÃ NẠP vào graph.db, không với manifest.json trên đĩa.

Bước `extract` của vendor ghi thẳng `.nexgraph/manifest.json`. Job đầy đủ lỗi/huỷ sau bước đó, hay
refresh mà `replace_files` lỗi, để manifest trên đĩa đi trước graph.db: so với nó thì refresh sau
báo "0 thay đổi" mãi và thay đổi của người dùng không bao giờ vào chỉ mục (review #71 vòng 1).
"""
import shutil
import subprocess
from pathlib import Path

import pytest

import nexgraph_engine.graphify_import as graphify_import
import nexgraph_engine.pipeline.job as pipeline_job
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.changes.freshness import freshness
from nexgraph_engine.store.graph_store import GraphStore

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def indexed_pipeline(api, tmp_path, monkeypatch):
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "graphify")
    root = tmp_path / "pipeline app"
    shutil.copytree(FIXTURES / "graphify_import_app", root)
    p = api.open(root)
    assert api.index(p["project_id"], timeout=180)["state"] == "done"
    return root, p["project_id"]


def _count(root: Path, needle: str) -> int:
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        return conn.execute("SELECT count(*) FROM nut WHERE nhan LIKE ?", (f"%{needle}%",)).fetchone()[0]
    finally:
        conn.close()


def _add_function(root: Path, name: str) -> None:
    source = root / "app.py"
    source.write_text(source.read_text(encoding="utf-8") + f"\n\ndef {name}(x):\n    return x\n", encoding="utf-8")


def test_refresh_after_failed_full_job_loads_the_change(api, indexed_pipeline, monkeypatch):
    root, pid = indexed_pipeline
    _add_function(root, "zzz_lost")

    def broken_import(*_args, **_kwargs):
        raise RuntimeError("nạp lỗi giả sau bước extract")

    original = pipeline_job.import_graph_json
    monkeypatch.setattr(pipeline_job, "import_graph_json", broken_import)
    job = api.index(pid, timeout=180)
    monkeypatch.setattr(pipeline_job, "import_graph_json", original)
    assert job["state"] == "error", job  # extract đã ghi manifest.json mới, graph.db giữ bản cũ
    assert _count(root, "zzz_lost") == 0

    body = api.post(f"/v1/projects/{pid}/refresh").json()

    assert body["status"] == "ok" and body["pipeline"] == "graphify", body
    assert _count(root, "zzz_lost") == 1, body


def test_failed_refresh_is_retried_by_the_next_refresh(api, indexed_pipeline, monkeypatch):
    root, pid = indexed_pipeline
    _add_function(root, "zzz_retry")

    def broken_replace(*_args, **_kwargs):
        raise RuntimeError("replace_files lỗi giả")

    original = graphify_import.replace_files
    monkeypatch.setattr(graphify_import, "replace_files", broken_replace)
    try:  # TestClient ném lại lỗi server; bản thật trả 500 — cả hai đều là refresh thất bại
        failed_ok = api.post(f"/v1/projects/{pid}/refresh").json().get("status") == "ok"
    except RuntimeError:
        failed_ok = False
    monkeypatch.setattr(graphify_import, "replace_files", original)
    assert not failed_ok
    assert _count(root, "zzz_retry") == 0

    body = api.post(f"/v1/projects/{pid}/refresh").json()

    assert body["status"] == "ok" and body["changed"] == 1, body
    assert _count(root, "zzz_retry") == 1


def test_missing_applied_manifest_reloads_everything_without_losing_nodes(api, indexed_pipeline):
    """Dự án lập chỉ mục trước bản sửa (chưa có manifest.applied.json): refresh nạp lại toàn bộ, đủ nút."""
    root, pid = indexed_pipeline
    applied = root / ".nexgraph" / "manifest.applied.json"
    assert applied.is_file()
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        before = conn.execute("SELECT count(*), (SELECT count(*) FROM tep) FROM nut").fetchone()
    finally:
        conn.close()
    applied.unlink()

    body = api.post(f"/v1/projects/{pid}/refresh").json()

    assert body["status"] == "ok" and body["removed"] == 0 and body["replaced_files"] >= 1, body
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        assert conn.execute("SELECT count(*), (SELECT count(*) FROM tep) FROM nut").fetchone() == before
    finally:
        conn.close()
    assert applied.is_file()
    assert api.post(f"/v1/projects/{pid}/refresh").json()["replaced_files"] == 0  # mốc đã ghi lại


def test_refresh_with_changes_records_head_commit(api, tmp_path, monkeypatch):
    """Như refresh cũ: lần tăng dần ghi commit HEAD, nên freshness còn so được HEAD với chỉ mục."""
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "graphify")
    root = tmp_path / "git app"
    shutil.copytree(FIXTURES / "graphify_import_app", root)
    git = ["git", "-c", "user.email=qa@example.invalid", "-c", "user.name=qa"]
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run([*git, "add", "-A"], cwd=root, check=True)
    subprocess.run([*git, "commit", "-qm", "init"], cwd=root, check=True)
    pid = api.open(root)["project_id"]
    assert api.index(pid, timeout=180)["state"] == "done"
    _add_function(root, "zzz_commit")
    subprocess.run([*git, "commit", "-qam", "thêm hàm"], cwd=root, check=True)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, check=True, capture_output=True,
                          text=True).stdout.strip()

    body = api.post(f"/v1/projects/{pid}/refresh").json()

    assert body["status"] == "ok" and body["changed"] == 1, body
    conn = open_graph_db(root / ".nexgraph" / "graph.db")
    try:
        state = freshness(GraphStore(conn), root)
    finally:
        conn.close()
    assert state["index_commit"] == head and state["stale"] is False, state
