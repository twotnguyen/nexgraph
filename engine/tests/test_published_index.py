import json
import os
import signal
import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import closing

import pytest

from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.mcp.server import build_server
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from test_mcp import call, payload
from test_refresh import graph_state


def wait_job(api, job_id):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        job = api.get(f"/v1/jobs/{job_id}").json()
        if job["state"] in {"done", "cancelled", "error"}:
            return job
        time.sleep(0.02)
    pytest.fail("Index job did not finish")


@pytest.mark.parametrize("outcome", ["done", "cancelled", "error"])
def test_rebuild_keeps_published_graph_until_commit(api, copy_fixture, tmp_path, index_project, monkeypatch, outcome):
    root = copy_fixture("flow_app")
    pid = api.open(root)["project_id"]
    prefix = f"/v1/projects/{pid}"
    assert api.index(pid)["state"] == "done"
    previous = api.open(root)["last_indexed_at"]
    previous_flows = api.get(f"{prefix}/flows").json()
    db_path = root / ".nexgraph" / "graph.db"
    server = build_server(root, tmp_path / "appdata")
    (root / "probe.py").write_text("def rebuild_probe():\n    return 1\n", encoding="utf-8")

    staged = threading.Event()
    release = threading.Event()

    class PausedIndexer(Indexer):
        def _structure(self, run_id, files):
            result = super()._structure(run_id, files)
            staged.set()
            if not release.wait(20):
                raise TimeoutError("Test did not release the staging worker")
            return result and not self.cancel.is_set()

    if outcome == "error":
        def fail_flows(*_):
            raise sqlite3.OperationalError("Injected SQLite write failure")

        monkeypatch.setattr("nexgraph_engine.index.indexer.rebuild_flows", fail_flows)

    jobs = api.app.state.services.jobs
    jobs._indexer_cls = PausedIndexer
    with closing(open_graph_db(db_path, read_only=True)) as snapshot, closing(api.app.state.services.bus.subscribe()) as sub:
        snapshot_store = GraphStore(snapshot)
        baseline = graph_state(snapshot_store)
        start = api.post(f"{prefix}/index")
        assert start.status_code == 202
        job_id = start.json()["job_id"]
        try:
            assert staged.wait(10), "Indexer did not commit its staged structure"
            assert api.open(root)["last_indexed_at"] == previous
            assert api.get(f"{prefix}/stats").json()["files"] == 4
            assert api.get(f"{prefix}/flows").json() == previous_flows
            assert api.get(f"{prefix}/search", params={"q": "rebuild_probe"}).json() == []
            assert payload(call(server, "search", {"query": "rebuild_probe"})) == []
            assert api.post(f"{prefix}/refresh").json()["reason"] == "index_running"
            if outcome == "done":
                hook = subprocess.run([sys.executable, "-m", "nexgraph_engine.cli", "refresh", "--project", str(root)],
                                      capture_output=True, timeout=10, check=True)
                assert json.loads(hook.stdout)["reason"] == "index_running"
            if outcome == "cancelled":
                assert api.delete(f"/v1/jobs/{job_id}").json()["cancelled"] is True
        finally:
            release.set()

        job = wait_job(api, job_id)
        assert job["state"] == outcome, job
        events = []
        while (event := sub.get(timeout=0.1)) is not None:
            events.append(event["type"])
        assert events.count("graph_updated") == (1 if outcome == "done" else 0)
        assert graph_state(snapshot_store) == baseline

    expected = baseline
    if outcome == "done":
        clean, result, _ = index_project(root)
        assert result.state == "hoan_tat"
        expected = graph_state(clean)
        assert api.get(f"{prefix}/search", params={"q": "rebuild_probe"}).json()[0]["node"]["label"] == "rebuild_probe"
        assert payload(call(server, "search", {"query": "rebuild_probe"}))[0]["node"]["label"] == "rebuild_probe"
    else:
        assert api.open(root)["last_indexed_at"] == previous
        assert api.get(f"{prefix}/search", params={"q": "rebuild_probe"}).json() == []
        assert payload(call(server, "search", {"query": "rebuild_probe"})) == []
        assert api.get(f"{prefix}/flows").json() == previous_flows
    with closing(open_graph_db(db_path, read_only=True)) as conn:
        assert graph_state(GraphStore(conn)) == expected


@pytest.mark.parametrize("phase", ["structure", "publication"])
def test_engine_crash_during_rebuild_keeps_old_graph_and_allows_retry(api, copy_fixture, tmp_path, phase):
    root = copy_fixture("flow_app")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    previous = api.open(root)["last_indexed_at"]
    (root / "crash_probe.py").write_text("def crash_probe():\n    return 1\n", encoding="utf-8")
    ready = tmp_path / "staging-ready"
    script = """
import os, sqlite3, sys, time
from pathlib import Path
from nexgraph_engine.index.events import EventBus
from nexgraph_engine.index.indexer import Indexer
from nexgraph_engine.index import jobs
from nexgraph_engine.store.projects import ProjectRegistry

def pause():
    marker = Path(sys.argv[3])
    pending = marker.with_suffix('.tmp')
    pending.write_text(str(os.getpid()), encoding='ascii')
    pending.replace(marker)
    time.sleep(30)

class InterruptedIndexer(Indexer):
    def _structure(self, run_id, files):
        super()._structure(run_id, files)
        pause()
        return True

def interrupted_backup(source, destination):
    def before_commit(status, remaining, total):
        if status == sqlite3.SQLITE_OK and 0 < remaining < total:
            pause()
    source.backup(destination, pages=1, progress=before_commit)

indexer = InterruptedIndexer
if sys.argv[4] == 'publication':
    import nexgraph_engine.store.publication as publication
    publication.backup_graph = interrupted_backup
    indexer = Indexer
manager = jobs.JobManager(ProjectRegistry(Path(sys.argv[1])), EventBus(), indexer_cls=indexer)
manager.start_index(sys.argv[2])
time.sleep(30)
"""
    child = subprocess.Popen([sys.executable, "-c", script, str(tmp_path / "appdata"), pid, str(ready), phase])
    try:
        deadline = time.monotonic() + 15
        while not ready.is_file() and child.poll() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        assert ready.is_file(), f"No staged data before engine crash (exit {child.poll()})"
        assert api.get(f"/v1/projects/{pid}/stats").json()["files"] == 4
    finally:
        if child.poll() is None:
            if ready.is_file():
                # Windows virtualenv launchers may have started a second process.
                os.kill(int(ready.read_text(encoding="ascii")), signal.SIGTERM)
            else:
                child.kill()
        child.wait(timeout=5)

    assert api.open(root)["last_indexed_at"] == previous
    assert api.get(f"/v1/projects/{pid}/search", params={"q": "crash_probe"}).json() == []
    assert api.index(pid)["state"] == "done"
    assert api.get(f"/v1/projects/{pid}/stats").json()["files"] == 5
    assert not list((root / ".nexgraph").glob(".graph.db.index-stage*"))


def test_cancel_inside_structure_keeps_published_graph(api, copy_fixture):
    """ENG-03: huỷ giữa lúc dựng cấu trúc không được để lại đồ thị trắng/dở trên CSDL thật."""
    root = copy_fixture("flow_app")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    previous = api.open(root)["last_indexed_at"]
    db_path = root / ".nexgraph" / "graph.db"
    with closing(open_graph_db(db_path, read_only=True)) as snapshot:
        baseline = graph_state(GraphStore(snapshot))
    (root / "cancel_probe.py").write_text("def cancel_probe():\n    return 1\n", encoding="utf-8")

    reached = threading.Event()

    class CancelledMidStructure(Indexer):
        def _structure(self, run_id, files):
            super()._structure(run_id, files)  # dữ liệu dở đã ghi (và commit) vào bản đang ghi
            reached.set()
            while not self.cancel.is_set():
                time.sleep(0.01)
            return False

    api.app.state.services.jobs._indexer_cls = CancelledMidStructure
    start = api.post(f"/v1/projects/{pid}/index")
    assert start.status_code == 202
    job_id = start.json()["job_id"]
    assert reached.wait(15), "Indexer did not reach the structure phase"
    assert api.delete(f"/v1/jobs/{job_id}").json()["cancelled"] is True
    job = wait_job(api, job_id)
    assert job["state"] == "cancelled", job

    assert api.open(root)["last_indexed_at"] == previous
    assert api.get(f"/v1/projects/{pid}/stats").json()["files"] == 4
    assert api.get(f"/v1/projects/{pid}/search", params={"q": "cancel_probe"}).json() == []
    with closing(open_graph_db(db_path, read_only=True)) as conn:
        store = GraphStore(conn)
        assert store.has_published_graph()
        assert graph_state(store) == baseline



def test_failed_refresh_keeps_published_graph(api, copy_fixture, monkeypatch):
    """REV-10: lỗi giữa lúc refresh tăng dần không được để lại đồ thị dở trên CSDL thật."""
    root = copy_fixture("flow_app")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    previous = api.open(root)["last_indexed_at"]
    db_path = root / ".nexgraph" / "graph.db"
    with closing(open_graph_db(db_path, read_only=True)) as snapshot:
        baseline = graph_state(GraphStore(snapshot))
    (root / "refresh_probe.py").write_text("def refresh_probe():\n    return 1\n", encoding="utf-8")
    app_py = root / "app.py"
    app_py.write_text(app_py.read_text(encoding="utf-8") + "\n\ndef refresh_added():\n    return 2\n", encoding="utf-8")

    def boom(*_args, **_kwargs):
        raise RuntimeError("Injected refresh failure")

    # Sau `set_run_state(..., "phan_giai")` (mốc commit giữa lần refresh) và trước khi xong.
    monkeypatch.setattr("nexgraph_engine.index.refresh.derive_tested_by", boom)
    # TestClient dựng lại exception thay vì trả 500 như server thật.
    with pytest.raises(RuntimeError, match="Injected refresh failure"):
        api.post(f"/v1/projects/{pid}/refresh")

    assert api.open(root)["last_indexed_at"] == previous
    assert api.get(f"/v1/projects/{pid}/stats").json()["files"] == 4
    assert api.get(f"/v1/projects/{pid}/search", params={"q": "refresh_probe"}).json() == []
    assert api.get(f"/v1/projects/{pid}/search", params={"q": "refresh_added"}).json() == []
    with closing(open_graph_db(db_path, read_only=True)) as conn:
        assert graph_state(GraphStore(conn)) == baseline
