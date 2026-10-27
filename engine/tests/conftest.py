import shutil
import threading
from pathlib import Path

import pytest

from nexgraph_engine.index.indexer import Indexer, ProgressEvent, RunResult
from nexgraph_engine.schema.db import open_graph_db
from nexgraph_engine.store.graph_store import GraphStore

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES


@pytest.fixture
def copy_fixture(tmp_path):
    """Chép một fixture sang đường dẫn có dấu tiếng Việt và khoảng trắng."""
    def _copy(name: str) -> Path:
        dest = tmp_path / "Đồ án" / f"{name} app"
        shutil.copytree(FIXTURES / name, dest)
        return dest
    return _copy


@pytest.fixture
def index_project(tmp_path):
    """index_project(root) -> (store, RunResult, events). Dữ liệu đồ thị đặt ngoài project."""
    opened: list = []

    def _run(root: Path, *, cancel: threading.Event | None = None, on_event=None):
        conn = open_graph_db(tmp_path / f"graph-{len(opened)}.db")
        opened.append(conn)
        store = GraphStore(conn)
        store.init_project(root.name, has_git=(root / ".git").exists())
        events: list[ProgressEvent] = []

        def on_progress(e: ProgressEvent) -> None:
            events.append(e)
            if on_event:
                on_event(e)

        result: RunResult = Indexer(store, root, on_progress=on_progress, cancel=cancel or threading.Event()).run()
        return store, result, events

    yield _run
    for c in opened:
        c.close()
