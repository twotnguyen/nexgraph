"""Công việc chạy nền (mỗi job một luồng, kết nối CSDL riêng), có hủy và sự kiện: lập chỉ mục và task tổng quát."""
from __future__ import annotations

import sqlite3
import threading
import uuid
from collections.abc import Callable
from contextlib import closing

from nexgraph_engine.index.events import EventBus
from nexgraph_engine.index.indexer import Indexer, ProgressEvent
from nexgraph_engine.index.scan import resolve_subdir
from nexgraph_engine.sources import sources_root
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectInfo, ProjectRegistry
from nexgraph_engine.store.publication import backup_graph, stage_graph

ACTIVE = ("queued", "structure", "resolve", "running")


class IndexAlreadyRunning(RuntimeError):
    """Project đã có một lần lập chỉ mục đang chạy (RB19)."""

    def __init__(self, project_id: str, job_id: str | None = None) -> None:
        super().__init__(project_id)
        self.job_id = job_id


class UnknownProject(KeyError):
    pass


class TaskCancelled(Exception):
    """`work` ném lỗi này (hoặc bất kỳ lỗi nào sau khi `cancel` đã bật) để job kết thúc ở `cancelled`."""


class TaskContext:
    """Truyền vào `work` của `start_task`: cờ huỷ và hàm báo tiến độ."""

    def __init__(self, cancel: threading.Event, report: Callable[[int, int, str], None]) -> None:
        self.cancel = cancel
        self._report = report

    def progress(self, done: int, total: int, message: str) -> None:
        self._report(done, total, message)


class JobManager:
    def __init__(self, registry: ProjectRegistry, bus: EventBus, *, indexer_cls: type[Indexer] = Indexer,
                 locks=None) -> None:
        self._registry, self._bus, self._indexer_cls = registry, bus, indexer_cls
        self._locks = locks
        self._jobs: dict[str, dict] = {}
        self._cancels: dict[str, threading.Event] = {}
        self._publishing: set[str] = set()
        self._threads: list[threading.Thread] = []
        self._lock = threading.Lock()

    def start_index(self, project_id: str, *, subdir: str | None = None, exclude: list[str] | None = None,
                    include_docs: bool | None = None, include_media: bool | None = None,
                    include_config: bool | None = None, workers: int | None = None, force: bool = False) -> str:
        with self._lock:
            info = self._registry.get(project_id)
            if info is None:
                raise UnknownProject(project_id)
            if subdir is not None:
                subdir = resolve_subdir(info.path, subdir)
            running = self._running_job(project_id)
            if running is not None:
                raise IndexAlreadyRunning(project_id, running["job_id"])
            job_id = str(uuid.uuid4())
            self._jobs[job_id] = {"job_id": job_id, "project_id": project_id, "kind": "index", "state": "queued",
                                  "files_done": 0, "files_total": 0, "message": None, "result": None}
            cancel = self._cancels[job_id] = threading.Event()
            thread = threading.Thread(target=self._run, args=(job_id, info, cancel, subdir, exclude, include_docs, include_media,
                                                                 include_config, workers, force), daemon=True,
                                      name=f"index-{job_id[:8]}")
            self._threads.append(thread)
        self._bus.publish({"type": "job_progress", **self._jobs[job_id]})
        thread.start()
        return job_id

    def start_task(self, project_id: str | None, kind: str, work: Callable[[TaskContext], dict]) -> str:
        """Chạy `work(ctx)` trong luồng riêng; giá trị trả về thành `result` của job.

        Có `project_id`: job giữ khoá dự án suốt lúc chạy và chặn mọi job khác của dự án (IndexAlreadyRunning),
        nên `work` được ghi CSDL của dự án (ví dụ qua `RefreshService.refresh_now`). `None`: không khoá gì.
        """
        with self._lock:
            if project_id is not None:
                if self._registry.get(project_id) is None:
                    raise UnknownProject(project_id)
                running = self._running_job(project_id)
                if running is not None:
                    raise IndexAlreadyRunning(project_id, running["job_id"])
            job_id = str(uuid.uuid4())
            self._jobs[job_id] = {"job_id": job_id, "project_id": project_id, "kind": kind, "state": "queued",
                                  "files_done": 0, "files_total": 0, "message": None, "result": None}
            cancel = self._cancels[job_id] = threading.Event()
            thread = threading.Thread(target=self._run_task, args=(job_id, project_id, work, cancel), daemon=True,
                                      name=f"{kind}-{job_id[:8]}")
            self._threads.append(thread)
        self._bus.publish({"type": "job_progress", **self._jobs[job_id]})
        thread.start()
        return job_id

    def _set(self, job_id: str, **fields) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.update(fields)
            snapshot = dict(job)
        self._bus.publish({"type": "job_progress", **snapshot})

    def _run_task(self, job_id: str, project_id: str | None, work: Callable[[TaskContext], dict],
                  cancel: threading.Event) -> None:
        lock = self._locks.get(project_id) if self._locks and project_id else None
        if lock is not None:
            lock.acquire()  # đợi lần refresh hiện tại của project xong
        final: dict = {"state": "cancelled"}
        try:
            if not cancel.is_set():
                self._set(job_id, state="running")
                ctx = TaskContext(cancel, lambda done, total, message: self._set(
                    job_id, files_done=max(0, done), files_total=max(0, total), message=message))
                final = {"state": "done", "result": work(ctx)}
        except Exception as exc:
            final = {"state": "cancelled" if cancel.is_set() or isinstance(exc, TaskCancelled) else "error",
                     "message": None if isinstance(exc, TaskCancelled) else f"{type(exc).__name__}: {exc}"}
        finally:
            if lock is not None:
                lock.release()
            self._set(job_id, **final)

    def remove_project(self, project_id: str) -> None:
        if self._registry.get(project_id) is None:
            raise UnknownProject(project_id)
        lock = self._locks.get(project_id) if self._locks else None
        if lock is not None and not lock.acquire(blocking=False):
            raise IndexAlreadyRunning(project_id)
        try:
            with self._lock:
                if self._running_job(project_id) is not None:
                    raise IndexAlreadyRunning(project_id)
                if not self._registry.remove(project_id):
                    raise UnknownProject(project_id)
        finally:
            if lock is not None:
                lock.release()

    def _running_job(self, project_id: str) -> dict | None:
        """Caller giữ `_lock`."""
        return next((job for job in self._jobs.values()
                     if job["project_id"] == project_id and job["state"] in ACTIVE), None)

    def is_active(self, project_id: str) -> bool:
        with self._lock:
            return self._running_job(project_id) is not None

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job["state"] not in ACTIVE or job_id in self._publishing:
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
            if e.state in ("done", "cancelled", "error"):
                self._publishing.discard(job_id)
            snapshot = dict(job)
        self._bus.publish({"type": "job_progress", **snapshot})
        if e.state == "done":  # đồ thị mới đã được xuất bản
            self._bus.publish({"type": "graph_updated", "project_id": snapshot["project_id"]})

    def _run(self, job_id: str, info: ProjectInfo, cancel: threading.Event, subdir: str | None,
             exclude: list[str] | None = None, include_docs: bool | None = None,
             include_media: bool | None = None, include_config: bool | None = None,
             workers: int | None = None, force: bool = False) -> None:
        lock = self._locks.get(info.project_id) if self._locks else None
        if lock is not None:
            lock.acquire()  # đợi lần refresh hiện tại của project xong
        terminal_event: ProgressEvent | None = None
        published = False

        def on_event(e: ProgressEvent) -> None:
            nonlocal terminal_event
            if e.state in ("done", "cancelled", "error"):
                terminal_event = e
            else:
                self._update(job_id, e)

        try:
            if cancel.is_set():
                terminal_event = ProgressEvent("cancelled", 0, 0)
                return

            with stage_graph(info.graph_db) as (live_path, stage):
                if cancel.is_set():
                    terminal_event = ProgressEvent("cancelled", 0, 0)
                    return
                store = GraphStore(stage)
                store.abort_stale_runs()
                last_docs, last_media = store.last_doc_flags()
                self._indexer_cls(
                    store, info.path, on_progress=on_event, cancel=cancel, subdir=subdir, exclude=exclude,
                    include_docs=last_docs if include_docs is None else include_docs,
                    include_media=last_media if include_media is None else include_media,
                    include_config=store.last_config_flag() if include_config is None else include_config,
                    workers=workers, force=force,
                    transcript_dir=self._registry.app_data_dir / "transcripts" / info.project_id,
                    sources_dir=sources_root(self._registry.app_data_dir, info.project_id),
                ).run()

                if terminal_event is None:
                    raise RuntimeError("Lập chỉ mục kết thúc mà chưa báo kết quả")
                if terminal_event.state != "done":
                    return

                # Hủy và bắt đầu commit được phân xử bằng cùng khóa.
                with self._lock:
                    if cancel.is_set():
                        terminal_event = ProgressEvent("cancelled", terminal_event.files_done,
                                                       terminal_event.files_total)
                        return
                    self._publishing.add(job_id)
                with closing(sqlite3.connect(f"{live_path.as_uri()}?mode=rw", uri=True)) as live:
                    backup_graph(stage, live)
                    published = True
        except Exception as exc:
            if not published:
                terminal_event = ProgressEvent("error", 0, 0, f"{type(exc).__name__}: {exc}")
        finally:
            if lock is not None:
                lock.release()
            if terminal_event is not None:
                self._update(job_id, terminal_event)
