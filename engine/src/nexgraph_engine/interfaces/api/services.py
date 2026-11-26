import tempfile
import threading
from pathlib import Path

from nexgraph_engine.indexing.index.events import EventBus
from nexgraph_engine.pipeline.job_manager import JobManager
from nexgraph_engine.pipeline.refresh_service import ProjectLocks, RefreshService
from nexgraph_engine.storage.store.projects import ProjectRegistry


class Services:
    def __init__(self, data_dir: Path | None) -> None:
        # Không có data_dir (test, chạy thử): thư mục tạm thuộc về Services, xoá khi tắt hoặc khi bị thu gom
        # nếu app bị bỏ mà lifespan không chạy (MIN-tmp-leak).
        self._owned_dir = None if data_dir else tempfile.TemporaryDirectory(prefix="nexgraph-data-",
                                                                            ignore_cleanup_errors=True)
        self.data_dir = Path(data_dir) if data_dir else Path(self._owned_dir.name)
        self.registry = ProjectRegistry(self.data_dir)
        self.bus = EventBus()
        self.locks = ProjectLocks()
        self.jobs = JobManager(self.registry, self.bus, locks=self.locks)
        self.refresh = RefreshService(self.registry, self.bus, self.jobs, self.locks)
        self.jobs.on_index_done.append(self._relink_if_member)
        self.refresh.on_refresh_done.append(self._relink_if_member)
        self.llm_queues: dict = {}  # job_id → LlmQueue của job semantic đường A (W9)
        self._relink_lock = threading.Lock()  # gộp hai yêu cầu relink trùng thời điểm

    def shutdown(self) -> None:
        """Tắt engine: huỷ/join job nền và đóng mọi hàng đợi LLM còn mở (REV-19)."""
        self.jobs.shutdown()
        for llm_queue in list(self.llm_queues.values()):
            llm_queue.close()
        self.llm_queues.clear()
        if self._owned_dir is not None:
            self._owned_dir.cleanup()

    # --- graph chung (W8) ---------------------------------------------------------------------------
    def relink_global(self) -> str:
        """Job tính lại cạnh liên repo; không khoá dự án nào vì chỉ đọc CSDL của chúng.

        Watcher bắn refresh liên tục nên nếu đã có job `global_link` đang **chờ** thì dùng lại
        (GFY-04). Job đang **chạy** có thể đã đọc CSDL trước lần refresh vừa xong, nên vẫn xếp thêm
        đúng một job; các lời gọi sau đó gộp vào job mới đang chờ ấy.
        """
        from nexgraph_engine.analysis.global_graph.link import relink
        with self._relink_lock:
            existing = self.jobs.active_task("global_link", states=("queued",))
            if existing is not None:
                return existing
            return self.jobs.start_task(None, "global_link", lambda ctx: relink(self.data_dir, self.registry))

    def _relink_if_member(self, project_id: str) -> None:
        from nexgraph_engine.analysis.global_graph.store import GlobalStore
        if any(pid == project_id for pid, _ in GlobalStore(self.data_dir).members(read_only=True)):
            self.relink_global()

    def leave_global(self, project_id: str) -> None:
        from nexgraph_engine.core.errors import ApiError
        from nexgraph_engine.analysis.global_graph.store import GlobalStore
        store = GlobalStore(self.data_dir)
        try:
            if store.path.is_file() and store.remove(project_id):
                self.relink_global()
        except ApiError:  # global.db của phiên bản mới hơn: không chặn việc gỡ dự án
            pass
