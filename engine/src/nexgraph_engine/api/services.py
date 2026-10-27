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
