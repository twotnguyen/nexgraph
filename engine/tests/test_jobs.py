import threading
import time

import pytest

from nexgraph_engine.index.events import EventBus
from nexgraph_engine.pipeline.legacy_indexer import Indexer, ProgressEvent
from nexgraph_engine.pipeline.job_manager import IndexAlreadyRunning, JobManager, UnknownProject
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.projects import ProjectRegistry

TERMINAL = {"done", "error", "cancelled"}


@pytest.fixture
def env(tmp_path, copy_fixture):
    registry = ProjectRegistry(tmp_path / "appdata")
    info = registry.open_project(copy_fixture("bookstore_app"))
    bus = EventBus()
    manager = JobManager(registry, bus)
    yield registry, info, bus, manager
    manager.shutdown()


def wait_done(manager, job_id, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        job = manager.get(job_id)
        if job["state"] in TERMINAL:
            return job
        time.sleep(0.01)
    raise AssertionError("job không kết thúc")


def drain(sub):
    out = []
    while (e := sub.get(timeout=0.2)) is not None:
        out.append(e)
    return out


def test_job_runs_to_done_and_emits_events(env):
    _, info, bus, manager = env
    sub = bus.subscribe()
    job_id = manager.start_index(info.project_id)
    job = wait_done(manager, job_id)
    assert job["state"] == "done" and job["files_done"] == job["files_total"] == 9
    events = drain(sub)
    progress = [e["state"] for e in events if e["type"] == "job_progress"]
    assert progress[0] == "queued" and progress[-1] == "done" and "structure" in progress and "resolve" in progress
    assert [e for e in events if e["type"] == "graph_updated"] == [
        {"type": "graph_updated", "project_id": info.project_id}]
    assert all(e["job_id"] == job_id and e["project_id"] == info.project_id
               for e in events if e["type"] == "job_progress")


class BlockingIndexer(Indexer):
    gate = threading.Event()

    def run(self):
        self.on_progress(ProgressEvent("structure", 0, 9))
        while not self.gate.is_set() and not self.cancel.is_set():
            time.sleep(0.01)
        if self.cancel.is_set():
            self.on_progress(ProgressEvent("cancelled", 0, 9))
            return None
        self.on_progress(ProgressEvent("done", 9, 9))
        return None


def test_second_start_while_running_rejected(env):
    registry, info, bus, _ = env
    BlockingIndexer.gate = threading.Event()
    manager = JobManager(registry, bus, indexer_cls=BlockingIndexer)
    try:
        first = manager.start_index(info.project_id)
        with pytest.raises(IndexAlreadyRunning) as conflict:
            manager.start_index(info.project_id)
        assert conflict.value.job_id == first
        BlockingIndexer.gate.set()
        wait_done(manager, first)
        assert manager.start_index(info.project_id)  # chạy lại được sau khi xong
    finally:
        BlockingIndexer.gate.set()
        manager.shutdown()


def test_cancel_running_job(env):
    registry, info, bus, _ = env
    BlockingIndexer.gate = threading.Event()
    manager = JobManager(registry, bus, indexer_cls=BlockingIndexer)
    try:
        job_id = manager.start_index(info.project_id)
        assert manager.cancel(job_id) is True
        assert wait_done(manager, job_id)["state"] == "cancelled"
        assert manager.cancel(job_id) is False  # đã kết thúc
    finally:
        manager.shutdown()


def test_unknown_project_and_job(env):
    _, _, _, manager = env
    with pytest.raises(UnknownProject):
        manager.start_index("00000000-0000-0000-0000-000000000000")
    assert manager.get("nope") is None and manager.cancel("nope") is False


def test_slow_subscriber_does_not_block_publisher():
    bus = EventBus()
    bus.subscribe()  # không bao giờ đọc
    start = time.time()
    for i in range(5000):
        bus.publish({"type": "job_progress", "i": i})
    assert time.time() - start < 2


def test_event_queue_is_bounded_and_keeps_latest_graph_updated():
    bus = EventBus()
    sub = bus.subscribe()
    for i in range(3000):
        bus.publish({"type": "job_progress", "i": i})
    bus.publish({"type": "graph_updated", "project_id": "p"})
    got = drain(sub)
    assert len(got) <= 1000  # drop-oldest tuyệt đối, kể cả khi graph_updated liên tiếp
    assert got[-1] == {"type": "graph_updated", "project_id": "p"}


def test_closed_subscription_stops_receiving():
    bus = EventBus()
    sub = bus.subscribe()
    sub.close()
    bus.publish({"type": "graph_updated", "project_id": "p"})
    assert sub.get(timeout=0.05) is None


def test_reader_can_query_during_index(env):
    _, info, bus, manager = env
    sub = bus.subscribe()
    job_id = manager.start_index(info.project_id)
    reader = None
    counts = []
    while (e := sub.get(timeout=5)) is not None:
        if e["type"] == "job_progress" and e["state"] in ("structure", "resolve"):
            reader = reader or open_graph_db(info.graph_db, read_only=True)
            counts.append(reader.execute("SELECT count(*) FROM nut").fetchone()[0])
        if e["type"] == "job_progress" and e["state"] in TERMINAL:
            break
    assert counts and wait_done(manager, job_id)["state"] == "done"
    if reader:
        reader.close()


def test_stale_run_from_crash_is_cleared(env):
    registry, info, bus, manager = env
    conn = open_graph_db(info.graph_db)
    conn.execute("INSERT INTO lan_lap_chi_muc (ma_du_an, loai, trang_thai, bat_dau_luc) "
                 "SELECT ma_du_an, 'day_du', 'cau_truc', 1 FROM du_an")
    conn.commit()
    conn.close()
    assert wait_done(manager, manager.start_index(info.project_id))["state"] == "done"


def test_finished_jobs_are_pruned_by_limit(env):
    """REV-19: `_jobs` không được phình mãi; job đã xong cũ bị bỏ, job mới còn tra được."""
    registry, info, bus, _ = env
    manager = JobManager(registry, bus, max_finished_jobs=2)
    try:
        ids = []
        for _ in range(4):
            job_id = manager.start_task(None, "probe", lambda ctx: {"ok": True})
            assert wait_done(manager, job_id)["state"] == "done"
            ids.append(job_id)
        assert manager.get(ids[0]) is None and manager.get(ids[1]) is None
        assert manager.get(ids[-1])["state"] == "done"
        assert len(manager._jobs) <= 2
    finally:
        manager.shutdown()


def test_finished_jobs_are_pruned_by_ttl(env, monkeypatch):
    registry, info, bus, _ = env
    manager = JobManager(registry, bus, finished_job_ttl_seconds=0.15)
    try:
        job_id = manager.start_task(None, "probe", lambda ctx: None)
        assert wait_done(manager, job_id)["state"] == "done"
        assert manager.get(job_id) is not None  # vừa xong: chưa bị dọn
        time.sleep(0.3)
        assert manager.get(job_id) is None
    finally:
        manager.shutdown()


def test_index_job_also_honours_finished_ttl(env):
    """F2: TTL 1 h áp cho mọi job đã xong, kể cả job index (trước chỉ job `start_task` có `finished_at`)."""
    registry, info, bus, _ = env
    manager = JobManager(registry, bus, finished_job_ttl_seconds=0.15)
    try:
        job_id = manager.start_index(info.project_id)
        assert wait_done(manager, job_id)["state"] == "done"
        assert manager.get(job_id)["finished_at"] > 0
        time.sleep(0.3)
        assert manager.get(job_id) is None
    finally:
        manager.shutdown()


def test_long_running_job_is_not_evicted_when_it_finishes(env):
    """F3: prune theo thời điểm xong — job dài xong sau nhiều job ngắn vẫn tra được kết quả."""
    registry, info, bus, _ = env
    manager = JobManager(registry, bus, max_finished_jobs=2)
    gate = threading.Event()
    try:
        long_id = manager.start_task(None, "long", lambda ctx: (gate.wait(10), {"ok": True})[1])
        deadline = time.time() + 10
        while manager.get(long_id)["state"] != "running" and time.time() < deadline:
            time.sleep(0.01)
        for _ in range(3):
            quick = manager.start_task(None, "quick", lambda ctx: {"ok": True})
            assert wait_done(manager, quick)["state"] == "done"
        gate.set()
        assert wait_done(manager, long_id)["state"] == "done"
        assert manager.get(long_id)["result"] == {"ok": True}
    finally:
        gate.set()
        manager.shutdown()


def test_app_shutdown_stops_job_manager(tmp_path, monkeypatch):
    """REV-19: engine tắt phải gọi shutdown() (huỷ + join job nền), không chỉ trong test."""
    from fastapi.testclient import TestClient

    from nexgraph_engine.api.app import create_app

    app = create_app("t" * 40, {"testserver"}, data_dir=tmp_path / "appdata")
    called: list[bool] = []
    monkeypatch.setattr(app.state.services.jobs, "shutdown", lambda: called.append(True))
    with TestClient(app):
        pass
    assert called == [True]
