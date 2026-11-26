"""Công việc chạy nền (mỗi job một luồng, kết nối CSDL riêng), có hủy và sự kiện: lập chỉ mục và task tổng quát."""
from __future__ import annotations

import logging
import threading
import time
import uuid
from collections.abc import Callable

from nexgraph_engine.index.events import EventBus
from nexgraph_engine.index.extra_sources import ExtraSources
from nexgraph_engine.index.indexer import Indexer, ProgressEvent, RunResult
from nexgraph_engine.index.scan import resolve_subdir
from nexgraph_engine.sources import sources_root
from nexgraph_engine.store.graph_store import GraphStore
from nexgraph_engine.store.projects import ProjectInfo, ProjectRegistry
from nexgraph_engine.store.publication import publish_stage, stage_graph

ACTIVE = ("queued", "structure", "resolve", "running", "waiting_llm")  # waiting_llm: job semantic đường A chờ main (W9)
# Job đã xong chỉ giữ để client hỏi kết quả một lúc: giới hạn số lượng và TTL để `_jobs` không phình mãi (REV-19).
# Gỡ dự án chờ refresh nền nhả khoá tối đa chừng này (refresh qua pipeline mất cỡ giây);
# DELETE của desktop hết hạn sau 15 s (apps/desktop/src/main/platform/engine/api.ts `removeProject`).
REMOVE_WAIT_SECONDS = 10.0
MAX_FINISHED_JOBS = 50
FINISHED_JOB_TTL_SECONDS = 60 * 60
logger = logging.getLogger(__name__)


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

    def __init__(self, cancel: threading.Event, report: Callable[[int, int, str], None],
                 set_state: Callable[[str], None] | None = None) -> None:
        self.cancel = cancel
        self._report = report
        self._set_state = set_state

    def progress(self, done: int, total: int, message: str) -> None:
        self._report(done, total, message)

    def set_state(self, state: str) -> None:
        """Chỉ đổi giữa `running` và `waiting_llm`; trạng thái kết thúc do JobManager đặt."""
        if state not in ("running", "waiting_llm"):
            raise ValueError(state)
        if self._set_state is not None:
            self._set_state(state)


class JobManager:
    def __init__(self, registry: ProjectRegistry, bus: EventBus, *, indexer_cls: type[Indexer] = Indexer,
                 locks=None, max_finished_jobs: int = MAX_FINISHED_JOBS,
                 finished_job_ttl_seconds: float = FINISHED_JOB_TTL_SECONDS) -> None:
        self._registry, self._bus, self._indexer_cls = registry, bus, indexer_cls
        self._locks = locks
        self._max_finished = max(0, max_finished_jobs)
        self._finished_ttl = max(0.0, finished_job_ttl_seconds)
        self._jobs: dict[str, dict] = {}
        self._cancels: dict[str, threading.Event] = {}
        self._publishing: set[str] = set()
        self._threads: list[threading.Thread] = []
        self._lock = threading.Lock()
        # Gọi với project_id sau khi job index công bố đồ thị mới (W8: tính lại cạnh liên repo).
        self.on_index_done: list[Callable[[str], None]] = []

    def start_index(self, project_id: str, *, subdir: str | None = None, exclude: list[str] | None = None,
                    include_docs: bool | None = None, include_media: bool | None = None,
                    include_config: bool | None = None, workers: int | None = None, force: bool = False,
                    sources: ExtraSources | None = None, include_images: bool | None = None) -> str:
        with self._lock:
            self._prune_finished_locked()
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
                                                                 include_config, workers, force, sources, include_images), daemon=True,
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
            self._prune_finished_locked()
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
            if job["state"] not in ACTIVE and fields.get("state") not in (None, "running", "waiting_llm"):
                job["finished_at"] = time.time()
                self._prune_finished_locked(keep=job_id)
            snapshot = dict(job)
        self._bus.publish({"type": "job_progress", **snapshot})

    @staticmethod
    def _job_result(indexer: "Indexer | None", result: RunResult) -> dict:
        """Số liệu một lần index cho JSON của job: tệp sinh tự động đã bỏ (mục 3) và số worker hiệu dụng (mục 4)."""
        skipped = indexer.skipped_files() if indexer is not None else {}
        return {"files_skipped": result.files_skipped, "skipped": skipped,
                "workers_effective": result.workers_effective, "fallback_serial": result.fallback_serial,
                "parallel_files": result.parallel_files, "serial_files": result.serial_files}

    def _forget_locked(self, job_id: str) -> None:
        """Caller giữ `_lock`: bỏ job đã xong khỏi bộ nhớ (client cũ nhận 404 như job không tồn tại)."""
        self._jobs.pop(job_id, None)
        self._cancels.pop(job_id, None)
        self._publishing.discard(job_id)

    def _prune_finished_locked(self, keep: str | None = None) -> None:
        """Caller giữ `_lock`: dọn job đã xong quá TTL hoặc vượt giới hạn, theo thời điểm xong (REV-19).

        `keep`: job vừa chuyển trạng thái kết thúc trong lần này — luôn giữ để client còn đọc kết quả
        (cắt theo thứ tự tạo từng xoá ngay job dài vừa xong khi có nhiều job ngắn xong trước — F3).
        """
        now = time.time()
        finished = [(job_id, job) for job_id, job in self._jobs.items() if job["state"] not in ACTIVE]
        for job_id, job in finished:
            if job_id != keep and now - job.get("finished_at", now) >= self._finished_ttl:
                self._forget_locked(job_id)
        finished = [(job_id, job) for job_id, job in self._jobs.items() if job["state"] not in ACTIVE]
        excess = len(finished) - self._max_finished
        if excess > 0:
            # Job xong lâu nhất bị bỏ trước; job vừa xong không bao giờ bị bỏ trong chính lần prune này.
            for job_id, _job in sorted(finished, key=lambda item: item[1].get("finished_at") or 0.0):
                if excess <= 0:
                    break
                if job_id == keep:
                    continue
                self._forget_locked(job_id)
                excess -= 1
        self._threads = [thread for thread in self._threads if thread.is_alive()]

    def _run_task(self, job_id: str, project_id: str | None, work: Callable[[TaskContext], dict],
                  cancel: threading.Event) -> None:
        lock = self._locks.get(project_id) if self._locks and project_id else None
        if lock is not None:
            lock.acquire()  # đợi lần refresh hiện tại của project xong
        final: dict = {"state": "error", "message": "Công việc dừng bất thường"}  # BaseException (SystemExit…)
        try:
            if cancel.is_set():
                final = {"state": "cancelled"}
            else:
                self._set(job_id, state="running")
                ctx = TaskContext(cancel, lambda done, total, message: self._set(
                    job_id, files_done=max(0, done), files_total=max(0, total), message=message),
                    lambda state: self._set(job_id, state=state))
                final = {"state": "done", "result": work(ctx)}
        except Exception as exc:
            if not (cancel.is_set() or isinstance(exc, TaskCancelled)):
                logger.exception("Job %s (%s, dự án %s) thất bại", job_id, self._jobs[job_id]["kind"], project_id)
            final = {"state": "cancelled" if cancel.is_set() or isinstance(exc, TaskCancelled) else "error",
                     "message": None if isinstance(exc, TaskCancelled) else f"{type(exc).__name__}: {exc}"}
        finally:
            if lock is not None:
                lock.release()
            self._set(job_id, **final)

    def remove_project(self, project_id: str) -> None:
        if self._registry.get(project_id) is None:
            raise UnknownProject(project_id)
        if self.is_active(project_id):  # job do người dùng chạy: từ chối ngay, họ huỷ được
            raise IndexAlreadyRunning(project_id)
        lock = self._locks.get(project_id) if self._locks else None
        if lock is not None and not lock.acquire(timeout=REMOVE_WAIT_SECONDS):  # refresh nền: chờ xong
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

    def active_task(self, kind: str, *, states: tuple[str, ...] = ACTIVE) -> str | None:
        """Job cùng loại ở một trong `states` (mặc định: còn hoạt động); dùng để gộp việc trùng."""
        with self._lock:
            return next((job["job_id"] for job in self._jobs.values()
                         if job["kind"] == kind and job["state"] in states), None)

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            self._prune_finished_locked()
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
    def _update(self, job_id: str, e: ProgressEvent, *, result: dict | None = None) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.update(state=e.state, files_done=e.files_done, message=e.message)
            if result is not None:
                job["result"] = result
            if e.files_total or e.state in ("done", "structure"):
                job["files_total"] = e.files_total
            if e.state in ("done", "cancelled", "error"):
                # F2: job index cũng phải có `finished_at`, nếu không TTL 1 h không bao giờ áp cho nó.
                job["finished_at"] = time.time()
                self._publishing.discard(job_id)
                self._prune_finished_locked(keep=job_id)
            snapshot = dict(job)
        self._bus.publish({"type": "job_progress", **snapshot})
        if e.state == "done":  # đồ thị mới đã được xuất bản
            self._bus.publish({"type": "graph_updated", "project_id": snapshot["project_id"]})
            for hook in list(self.on_index_done):
                try:
                    hook(snapshot["project_id"])
                except Exception:  # móc phụ không được làm hỏng job index đã xong
                    logger.warning("Móc sau khi index xong lỗi (dự án %s)", snapshot["project_id"], exc_info=True)

    def _run(self, job_id: str, info: ProjectInfo, cancel: threading.Event, subdir: str | None,
             exclude: list[str] | None = None, include_docs: bool | None = None,
             include_media: bool | None = None, include_config: bool | None = None,
             workers: int | None = None, force: bool = False, sources: ExtraSources | None = None,
             include_images: bool | None = None) -> None:
        lock = self._locks.get(info.project_id) if self._locks else None
        if lock is not None:
            lock.acquire()  # đợi lần refresh hiện tại của project xong
        terminal_event: ProgressEvent | None = None
        published = False
        indexer: Indexer | None = None  # giữ lại để lấy số liệu kết quả (workers_effective, tệp bị bỏ)
        result: RunResult | None = None
        index_result: dict | None = None

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
                docs = last_docs if include_docs is None else include_docs
                media = last_media if include_media is None else include_media
                config = store.last_config_flag() if include_config is None else include_config
                images = store.last_image_flag() if include_images is None else include_images
                # Đường mặc định là pipeline vendor (N2-E2); bộ trích xuất cũ chạy khi
                # NEXGRAPH_PIPELINE=legacy hoặc job cần thứ pipeline code-only chưa làm.
                from nexgraph_engine.pipeline.job import fallback_reason, legacy_result, run_index_pipeline
                from nexgraph_engine.pipeline.mode import GRAPHIFY, LEGACY, pipeline_mode

                mode = pipeline_mode()
                reason = "env_legacy" if mode == LEGACY else fallback_reason(
                    subdir=subdir, sources=sources, include_docs=docs, include_media=media,
                    include_images=images, include_config=config)
                if mode == GRAPHIFY and reason is None:
                    index_result = run_index_pipeline(store, info.path, exclude=exclude,
                                                      on_event=on_event, cancel=cancel)
                    if index_result is None:
                        return  # đã phát sự kiện kết thúc (huỷ/lỗi), không công bố staging
                else:
                    if mode == GRAPHIFY:
                        on_event(ProgressEvent("structure", 0, 0,
                                               f"Dùng bộ trích xuất cũ cho lần này ({reason})"))
                    indexer = self._indexer_cls(
                        store, info.path, on_progress=on_event, cancel=cancel, subdir=subdir, exclude=exclude,
                        include_docs=docs, include_media=media, include_config=config, include_images=images,
                        workers=workers, force=force, **({"sources": sources} if sources is not None else {}),
                        transcript_dir=self._registry.app_data_dir / "transcripts" / info.project_id,
                        sources_dir=sources_root(self._registry.app_data_dir, info.project_id),
                    )
                    result = indexer.run()
                    # (A1 F6) Thư mục/tệp không đọc được khi quét + số liệu PERF-L đi CÙNG một dict kết quả job.
                    unreadable = indexer.unreadable_paths
                    index_result = legacy_result(
                        {**self._job_result(indexer, result), "unreadable_paths": unreadable,
                         "unreadable_count": len(unreadable)}, reason)

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
                # Qua `publish_stage` (không backup tay) để WAL của bản thật được cắt ngay sau khi xong (F7).
                publish_stage(stage, live_path)
                published = True
                if index_result.get("pipeline") == GRAPHIFY:
                    from nexgraph_engine.pipeline.applied import mark_applied

                    try:  # mốc refresh tăng dần; lỗi ở đây chỉ làm refresh sau nạp lại toàn bộ
                        mark_applied(info.path)
                    except OSError:
                        logger.warning("Không ghi được manifest đã nạp (dự án %s)", info.project_id, exc_info=True)
        except Exception as exc:
            logger.exception("Lập chỉ mục thất bại (job %s, dự án %s, đã công bố: %s)",
                             job_id, info.project_id, published)
            if not published:
                terminal_event = ProgressEvent("error", 0, 0, f"{type(exc).__name__}: {exc}")
        finally:
            if lock is not None:
                lock.release()
            if terminal_event is not None:
                self._update(job_id, terminal_event, result=index_result)
