"""Điều phối `POST /refresh`: không chạy chồng với lập chỉ mục đầy đủ hay với một lần refresh khác của cùng project."""
from __future__ import annotations

import sqlite3
import threading
from collections.abc import Callable
from contextlib import closing

from nexgraph_engine.indexing.index.events import EventBus
from nexgraph_engine.pipeline.job_manager import JobManager, UnknownProject
from nexgraph_engine.pipeline.legacy_refresh import refresh_project
from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.indexing.sources import sources_root
from nexgraph_engine.storage.store.graph_store import GraphStore
from nexgraph_engine.storage.store.projects import ProjectRegistry
from nexgraph_engine.storage.store.publication import GraphWriteBusy, graph_writer, is_busy_error


class NotIndexed(Exception):
    pass


class ProjectLocks:
    """Một khoá cho mỗi project: lập chỉ mục và refresh không bao giờ cùng ghi vào một graph.db."""

    def __init__(self) -> None:
        self._guard = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}

    def get(self, project_id: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(project_id, threading.Lock())


class RefreshService:
    def __init__(self, registry: ProjectRegistry, bus: EventBus, jobs: JobManager, locks: ProjectLocks) -> None:
        self._registry, self._bus, self._jobs, self._locks = registry, bus, jobs, locks
        # Móc sau refresh tăng dần: graph chung phải nối lại cạnh liên repo khi nội dung dự án đổi (GFY-04).
        self.on_refresh_done: list[Callable[[str], None]] = []

    @staticmethod
    def _skipped(reason: str) -> dict:
        return {"status": "skipped", "reason": reason, "added": 0, "changed": 0, "removed": 0, "seconds": 0.0}

    def recluster(self, project_id: str) -> int:
        """Gom cụm lại trên đồ thị hiện có (`graphify cluster-only`). Ném IndexAlreadyRunning khi đang index/refresh."""
        from nexgraph_engine.analysis.arch.communities import detect_communities
        from nexgraph_engine.pipeline.job_manager import IndexAlreadyRunning
        if self._registry.get(project_id) is None:
            raise UnknownProject(project_id)
        lock = self._locks.get(project_id)
        if self._jobs.is_active(project_id) or not lock.acquire(blocking=False):
            raise IndexAlreadyRunning(project_id)
        try:
            info = self._registry.get(project_id)
            if info is None:
                raise UnknownProject(project_id)
            with graph_writer(info.graph_db) as db, closing(open_graph_db(db)) as conn:
                store = GraphStore(conn)
                if not store.has_published_graph():
                    raise NotIndexed(project_id)
                count = detect_communities(store)
        except GraphWriteBusy as exc:
            raise IndexAlreadyRunning(project_id) from exc
        finally:
            lock.release()
        self._bus.publish({"type": "graph_updated", "project_id": project_id})
        return count

    def refresh(self, project_id: str) -> dict:
        if self._registry.get(project_id) is None:
            raise UnknownProject(project_id)
        if self._jobs.is_active(project_id):
            return self._skipped("index_running")
        lock = self._locks.get(project_id)
        if not lock.acquire(blocking=False):
            return self._skipped("refresh_running")
        try:
            return self.refresh_now(project_id)
        finally:
            lock.release()

    def refresh_now(self, project_id: str) -> dict:
        """Refresh khi người gọi đã giữ khoá dự án (task của `JobManager.start_task` gắn với dự án này).

        Ghi thẳng vào CSDL thật trong MỘT giao dịch (REV-10): lỗi/kill giữa chừng thì SQLite rollback
        journal/WAL nên đồ thị đã công bố còn nguyên, mà không phải chép cả CSDL sang bản staging hai lần
        (refresh 1 tệp trên graph 295 MB từng vượt 2 s chỉ vì copy).
        """
        info = self._registry.get(project_id)
        if info is None:
            raise UnknownProject(project_id)
        try:
            with graph_writer(info.graph_db) as live_path, closing(open_graph_db(live_path)) as conn:
                store = GraphStore(conn)
                if not store.has_published_graph():
                    return self._skipped("not_indexed")
                # Lần refresh trước bị kill để lại dòng 'cho' (dữ liệu đã rollback khi mở CSDL).
                store.abort_stale_runs()
                from nexgraph_engine.pipeline.refresh import refresh_pipeline, use_pipeline_refresh

                if use_pipeline_refresh(info.path):
                    # Đồ thị dựng bằng pipeline vendor: `update` tăng dần + replace_files theo manifest.
                    result = refresh_pipeline(store, info.path)
                else:
                    result = refresh_project(store, info.path,
                                             transcript_dir=self._registry.app_data_dir / "transcripts" / project_id,
                                             sources_dir=sources_root(self._registry.app_data_dir, project_id))
        except GraphWriteBusy:
            return self._skipped("refresh_running")
        except sqlite3.OperationalError as exc:
            if is_busy_error(exc):  # tiến trình khác đang giữ khoá ghi CSDL
                return self._skipped("refresh_running")
            raise
        if result.added or result.changed or result.removed:
            extra = {"warnings": list(result.warnings)} if result.warnings else {}
            self._bus.publish({"type": "graph_updated", "project_id": project_id, **extra})
            self._bus.publish({"type": "changes_updated", "project_id": project_id, **extra})
            for callback in self.on_refresh_done:
                callback(project_id)
        payload = {"status": "ok", "reason": None, "added": result.added, "changed": result.changed,
                   "removed": result.removed, "seconds": round(result.seconds, 3),
                   "pipeline": result.pipeline, "replaced_files": result.replaced_files}
        if result.warnings:
            # Phần phụ phải fallback: không báo "ok" im lặng khi luồng/cụm được giữ lại hoặc dựng lại.
            payload["warnings"] = list(result.warnings)
        return payload
