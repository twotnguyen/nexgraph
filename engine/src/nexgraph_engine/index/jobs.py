"""Công việc lập chỉ mục chạy nền (mỗi job một luồng, kết nối CSDL riêng), có hủy và sự kiện."""
from __future__ import annotations

import sqlite3
import threading
import uuid
from contextlib import closing

from nexgraph_engine.index.events import EventBus
from nexgraph_engine.index.indexer import Indexer, ProgressEvent
from nexgraph_engine.index.scan import resolve_subdir
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectInfo, ProjectRegistry
from nexgraph_engine.store.publication import backup_graph, stage_graph

ACTIVE = ("queued", "structure", "resolve")


class IndexAlreadyRunning(RuntimeError):
    """Project đã có một lần lập chỉ mục đang chạy (RB19)."""

    def __init__(self, project_id: str, job_id: str | None = None) -> None:
        super().__init__(project_id)
        self.job_id = job_id


class UnknownProject(KeyError):
    pass


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
                    include_docs: bool | None = None, include_media: bool | None = None) -> str:
        info = self._registry.get(project_id)
        if info is None:
            raise UnknownProject(project_id)
        if subdir is not None:
            subdir = resolve_subdir(info.path, subdir)  # ném ProjectPathError nếu không hợp lệ
        with self._lock:
            running = next((j for j in self._jobs.values()
                            if j["project_id"] == project_id and j["state"] in ACTIVE), None)
            if running is not None:
                raise IndexAlreadyRunning(project_id, running["job_id"])
            job_id = str(uuid.uuid4())
            self._jobs[job_id] = {"job_id": job_id, "project_id": project_id, "state": "queued",
                                  "files_done": 0, "files_total": 0, "message": None}
            cancel = self._cancels[job_id] = threading.Event()
            thread = threading.Thread(target=self._run, args=(job_id, info, cancel, subdir, exclude, include_docs, include_media), daemon=True,
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
             include_media: bool | None = None) -> None:
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
                    transcript_dir=self._registry.app_data_dir / "transcripts" / info.project_id,
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
