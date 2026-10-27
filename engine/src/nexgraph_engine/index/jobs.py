"""Công việc lập chỉ mục chạy nền (mỗi job một luồng, kết nối CSDL riêng), có hủy và sự kiện."""
from __future__ import annotations

import threading
import uuid

from nexgraph_engine.index.events import EventBus
from nexgraph_engine.index.indexer import Indexer, ProgressEvent
from nexgraph_engine.index.scan import resolve_subdir
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectRegistry

ACTIVE = ("queued", "structure", "resolve")


class IndexAlreadyRunning(RuntimeError):
    """Project đã có một lần lập chỉ mục đang chạy (RB19)."""


class UnknownProject(KeyError):
    pass


class JobManager:
    def __init__(self, registry: ProjectRegistry, bus: EventBus, *, indexer_cls: type[Indexer] = Indexer,
                 locks=None) -> None:
        self._registry, self._bus, self._indexer_cls = registry, bus, indexer_cls
        self._locks = locks
        self._jobs: dict[str, dict] = {}
        self._cancels: dict[str, threading.Event] = {}
        self._threads: list[threading.Thread] = []
        self._lock = threading.Lock()

    def start_index(self, project_id: str, *, subdir: str | None = None) -> str:
        info = self._registry.get(project_id)
        if info is None:
            raise UnknownProject(project_id)
        if subdir is not None:
            subdir = resolve_subdir(info.path, subdir)  # ném ProjectPathError nếu không hợp lệ
        with self._lock:
            if any(j["project_id"] == project_id and j["state"] in ACTIVE for j in self._jobs.values()):
                raise IndexAlreadyRunning(project_id)
            job_id = str(uuid.uuid4())
            self._jobs[job_id] = {"job_id": job_id, "project_id": project_id, "state": "queued",
                                  "files_done": 0, "files_total": 0, "message": None}
            cancel = self._cancels[job_id] = threading.Event()
            thread = threading.Thread(target=self._run, args=(job_id, info, cancel, subdir), daemon=True,
                                      name=f"index-{job_id[:8]}")
            self._threads.append(thread)
        self._bus.publish({"type": "job_progress", **self._jobs[job_id]})
        thread.start()
        return job_id

    def is_active(self, project_id: str) -> bool:
        with self._lock:
            return any(j["project_id"] == project_id and j["state"] in ACTIVE for j in self._jobs.values())

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job["state"] not in ACTIVE:
                return False
            self._cancels[job_id].set()
            return True

    def shutdown(self) -> None:
        with self._lock:
            for ev in self._cancels.values():
                ev.set()
            threads = list(self._threads)
        for t in threads:
            t.join(timeout=10)

    # ------------------------------------------------------------------------------------------------
    def _update(self, job_id: str, e: ProgressEvent) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.update(state=e.state, files_done=e.files_done, message=e.message)
            if e.files_total or e.state in ("done", "structure"):
                job["files_total"] = e.files_total
            snapshot = dict(job)
        self._bus.publish({"type": "job_progress", **snapshot})
        if e.state in ("resolve", "done"):  # giai đoạn 1 xong rồi giai đoạn 2 xong: giao diện nạp lại đồ thị
            self._bus.publish({"type": "graph_updated", "project_id": snapshot["project_id"]})

    def _run(self, job_id: str, info, cancel: threading.Event, subdir: str | None) -> None:
        conn = None
        lock = self._locks.get(info.project_id) if self._locks else None
        if lock is not None:
            lock.acquire()  # đợi một lần refresh đang chạy dở (vài giây) rồi mới ghi đồ thị
        try:
            conn = open_graph_db(info.graph_db)
            store = GraphStore(conn)
            store.abort_stale_runs()  # lần chạy dở do engine từng chết giữa chừng
            self._indexer_cls(store, info.path, on_progress=lambda e: self._update(job_id, e), cancel=cancel,
                              subdir=subdir).run()
        except Exception as exc:
            self._update(job_id, ProgressEvent("error", 0, 0, f"{type(exc).__name__}: {exc}"))
        finally:
            if conn is not None:
                conn.close()
            if lock is not None:
                lock.release()
