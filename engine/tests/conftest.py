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


TOKEN = "t" * 40


class Api:
    """TestClient có sẵn token; `app.state.services` cho phép test chọc vào JobManager."""

    def __init__(self, client, app):
        self.client, self.app = client, app
        self.headers = {"Authorization": f"Bearer {TOKEN}"}

    def get(self, url, **kw):
        return self.client.get(url, headers={**self.headers, **kw.pop("headers", {})}, **kw)

    def post(self, url, **kw):
        return self.client.post(url, headers=self.headers, **kw)

    def delete(self, url, **kw):
        return self.client.delete(url, headers=self.headers, **kw)

    def open(self, path) -> dict:
        r = self.post("/v1/projects", json={"path": str(path)})
        assert r.status_code == 200, r.text
        return r.json()

    def index(self, project_id: str, timeout: float = 30) -> dict:
        import time
        r = self.post(f"/v1/projects/{project_id}/index")
        assert r.status_code == 202, r.text
        job_id = r.json()["job_id"]
        end = time.time() + timeout
        while time.time() < end:
            job = self.get(f"/v1/jobs/{job_id}").json()
            if job["state"] in ("done", "error", "cancelled"):
                return job
            time.sleep(0.02)
        raise AssertionError("job không kết thúc")


@pytest.fixture
def api(tmp_path):
    from fastapi.testclient import TestClient
    from nexgraph_engine.api.app import create_app
    app = create_app(TOKEN, {"testserver"}, data_dir=tmp_path / "appdata", sse_ping_seconds=0.2)
    yield Api(TestClient(app), app)
    app.state.services.jobs.shutdown()
