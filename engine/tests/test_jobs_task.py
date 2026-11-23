"""Job tổng quát `JobManager.start_task` (hợp đồng dùng chung W6/W7/W8/W9)."""
import threading
import time

import pytest

from nexgraph_engine.index.events import EventBus
from nexgraph_engine.index.jobs import IndexAlreadyRunning, JobManager, TaskCancelled, UnknownProject
from nexgraph_engine.index.refresh_service import ProjectLocks, RefreshService
from nexgraph_engine.store.projects import ProjectRegistry

TERMINAL = {"done", "error", "cancelled"}


@pytest.fixture
def env(tmp_path, copy_fixture):
    registry = ProjectRegistry(tmp_path / "appdata")
    info = registry.open_project(copy_fixture("py_mini"))
    bus = EventBus()
    locks = ProjectLocks()
    manager = JobManager(registry, bus, locks=locks)
    yield registry, info, bus, manager, locks
    manager.shutdown()


def wait_done(manager, job_id, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        job = manager.get(job_id)
        if job["state"] in TERMINAL:
            return job
        time.sleep(0.01)
    raise AssertionError("job không kết thúc")


def test_task_runs_to_done_with_result_and_progress_events(env):
    _, info, bus, manager, _ = env
    sub = bus.subscribe()

    def work(ctx):
        ctx.progress(1, 2, "nửa đường")
        return {"answer": 42}

    job_id = manager.start_task(info.project_id, "demo", work)
    job = wait_done(manager, job_id)
    assert job["state"] == "done" and job["kind"] == "demo" and job["result"] == {"answer": 42}
    events = []
    while (e := sub.get(timeout=0.2)) is not None:
        events.append(e)
    progress = [e for e in events if e["type"] == "job_progress"]
    assert [e["state"] for e in progress][0] == "queued" and progress[-1]["state"] == "done"
    assert any(e["files_done"] == 1 and e["files_total"] == 2 and e["message"] == "nửa đường" for e in progress)
    assert all(e["kind"] == "demo" and e["job_id"] == job_id for e in progress)


def test_task_exception_becomes_error(env):
    _, info, _, manager, _ = env

    def work(ctx):
        raise RuntimeError("hỏng")

    job = wait_done(manager, manager.start_task(info.project_id, "demo", work))
    assert job["state"] == "error" and "hỏng" in job["message"] and job["result"] is None


def test_task_cancel(env):
    _, info, _, manager, _ = env
    started = threading.Event()

    def work(ctx):
        started.set()
        ctx.cancel.wait(10)
        raise TaskCancelled

    job_id = manager.start_task(info.project_id, "demo", work)
    assert started.wait(5)
    assert manager.cancel(job_id) is True
    assert wait_done(manager, job_id)["state"] == "cancelled"


def test_project_task_blocks_other_writers(env):
    registry, info, bus, manager, locks = env
    gate = threading.Event()
    started = threading.Event()

    def work(ctx):
        started.set()
        gate.wait(10)
        return {}

    first = manager.start_task(info.project_id, "ingest", work)
    assert started.wait(5)
    try:
        with pytest.raises(IndexAlreadyRunning) as conflict:
            manager.start_index(info.project_id)
        assert conflict.value.job_id == first
        with pytest.raises(IndexAlreadyRunning):
            manager.start_task(info.project_id, "ingest", lambda ctx: {})
        refresh = RefreshService(registry, bus, manager, locks)
        assert refresh.refresh(info.project_id)["reason"] == "index_running"
        # Task không gắn dự án chạy song song được.
        assert wait_done(manager, manager.start_task(None, "clone", lambda ctx: {"ok": True}))["state"] == "done"
    finally:
        gate.set()
    assert wait_done(manager, first)["state"] == "done"


def test_project_task_holds_project_lock(env):
    _, info, _, manager, locks = env
    seen = {}

    def work(ctx):
        seen["locked"] = not locks.get(info.project_id).acquire(blocking=False)
        return {}

    wait_done(manager, manager.start_task(info.project_id, "demo", work))
    assert seen["locked"] is True


def test_unknown_project_rejected(env):
    _, _, _, manager, _ = env
    with pytest.raises(UnknownProject):
        manager.start_task("00000000-0000-0000-0000-000000000000", "demo", lambda ctx: {})


def test_index_job_has_kind_and_result(api, copy_fixture):
    p = api.open(copy_fixture("py_mini"))
    job = api.index(p["project_id"])
    # Hợp đồng đổi ở PERF-L mục 3: job index có `result` chứa số liệu lần chạy (trước đây luôn None),
    # để UI/bench biết đã bỏ bao nhiêu tệp sinh tự động và chạy với bao nhiêu worker.
    assert job["kind"] == "index" and job["result"]["files_skipped"] == 0


def test_project_task_can_refresh_now(api, copy_fixture):
    root = copy_fixture("py_mini")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    services = api.app.state.services
    (root / "extra.py").write_text("def extra():\n    return 1\n", encoding="utf-8")
    job_id = services.jobs.start_task(pid, "demo", lambda ctx: services.refresh.refresh_now(pid))
    job = wait_done(services.jobs, job_id)
    assert job["state"] == "done" and job["result"]["status"] == "ok" and job["result"]["added"] == 1


def test_base_exception_is_error_not_cancelled(env):
    _, info, _, manager, _ = env

    def work(ctx):
        raise SystemExit(1)

    job = wait_done(manager, manager.start_task(info.project_id, "demo", work))
    assert job["state"] == "error" and job["message"]


def test_task_waiting_llm_state_blocks_writers_and_cancels(env):
    _, info, _, manager, _ = env
    waiting = threading.Event()

    def work(ctx):
        ctx.set_state("waiting_llm")
        waiting.set()
        ctx.cancel.wait(10)
        raise TaskCancelled

    job_id = manager.start_task(info.project_id, "semantic", work)
    assert waiting.wait(5)
    assert manager.get(job_id)["state"] == "waiting_llm"
    with pytest.raises(IndexAlreadyRunning):
        manager.start_index(info.project_id)
    assert manager.cancel(job_id) is True
    assert wait_done(manager, job_id)["state"] == "cancelled"


def test_task_set_state_rejects_terminal_states(env):
    _, info, _, manager, _ = env
    seen = {}

    def work(ctx):
        with pytest.raises(ValueError):
            ctx.set_state("done")
        ctx.set_state("waiting_llm")
        ctx.set_state("running")
        seen["ok"] = True
        return {}

    assert wait_done(manager, manager.start_task(info.project_id, "semantic", work))["state"] == "done"
    assert seen["ok"]
