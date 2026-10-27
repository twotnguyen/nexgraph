import threading
import time

import pytest

from nexgraph_engine.index.events import EventBus
from nexgraph_engine.index.indexer import Indexer, ProgressEvent
from nexgraph_engine.index.jobs import IndexAlreadyRunning, JobManager, UnknownProject
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
        {"type": "graph_updated", "project_id": info.project_id}] * 2
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
        with pytest.raises(IndexAlreadyRunning):
            manager.start_index(info.project_id)
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


def test_graph_updated_never_dropped():
    bus = EventBus()
    sub = bus.subscribe()
    bus.publish({"type": "graph_updated", "project_id": "p"})
    for i in range(3000):
        bus.publish({"type": "job_progress", "i": i})
    got = drain(sub)
    assert {"type": "graph_updated", "project_id": "p"} in got
    assert len(got) <= 1001  # job_progress cũ nhất bị bỏ


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
