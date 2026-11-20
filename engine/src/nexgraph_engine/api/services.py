import tempfile
from pathlib import Path

from nexgraph_engine.index.events import EventBus
from nexgraph_engine.index.jobs import JobManager
from nexgraph_engine.index.refresh_service import ProjectLocks, RefreshService
from nexgraph_engine.store.projects import ProjectRegistry


class Services:
    def __init__(self, data_dir: Path | None) -> None:
        self.data_dir = Path(data_dir) if data_dir else Path(tempfile.mkdtemp(prefix="nexgraph-data-"))
        self.registry = ProjectRegistry(self.data_dir)
        self.bus = EventBus()
        self.locks = ProjectLocks()
        self.jobs = JobManager(self.registry, self.bus, locks=self.locks)
        self.refresh = RefreshService(self.registry, self.bus, self.jobs, self.locks)
        self.jobs.on_index_done.append(self._relink_if_member)
        self.llm_queues: dict = {}  # job_id → LlmQueue của job semantic đường A (W9)

    # --- graph chung (W8) ---------------------------------------------------------------------------
    def relink_global(self) -> str:
        """Job tính lại cạnh liên repo; không khoá dự án nào vì chỉ đọc CSDL của chúng."""
        from nexgraph_engine.global_graph.link import relink
        return self.jobs.start_task(None, "global_link", lambda ctx: relink(self.data_dir, self.registry))

    def _relink_if_member(self, project_id: str) -> None:
        from nexgraph_engine.global_graph.store import GlobalStore
        if any(pid == project_id for pid, _ in GlobalStore(self.data_dir).members(read_only=True)):
            self.relink_global()
