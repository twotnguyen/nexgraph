import os
import shutil
import tempfile
import threading
from pathlib import Path

import pytest

from nexgraph_engine.pipeline.legacy_indexer import Indexer, ProgressEvent, RunResult
from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.storage.store.graph_store import GraphStore

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="session", autouse=True)
def _tmp_trong_basetemp(tmp_path_factory):
    """Thư mục tạm của cả phiên test nằm trong basetemp của pytest (MIN-tmp-leak).

    Mã và test gọi `tempfile` trực tiếp, tiến trình engine con bị test dừng giữa chừng (không chạy `atexit`)
    từng để lại `tmp*`, `nexgraph-extract-*`, `nexgraph-data-*` trong thư mục tạm của máy sau mỗi lượt.
    Đổi biến môi trường để cả tiến trình con thừa hưởng; pytest chỉ giữ basetemp của 3 lượt gần nhất.
    """
    root = tmp_path_factory.mktemp("tmp", numbered=False)
    saved = {key: os.environ.get(key) for key in ("TMPDIR", "TEMP", "TMP")}
    saved_tempdir = tempfile.tempdir
    for key in saved:
        os.environ[key] = str(root)
    tempfile.tempdir = None  # gettempdir() đọc lại biến môi trường
    yield root
    for key, value in saved.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    tempfile.tempdir = saved_tempdir


@pytest.fixture(autouse=True)
def _legacy_pipeline_for_existing_fixtures(monkeypatch):
    """Đường lập chỉ mục mặc định đã đổi sang pipeline vendor (N2-E2).

    Fixture hiện có dựng cho bộ trích xuất cũ (Dart, tài liệu, nguồn bổ sung, thư mục con…) nên
    test cũ chạy đường legacy như trước — giữ khẳng định cũ thay vì sửa. Test của đường mới tự
    đặt `NEXGRAPH_PIPELINE=graphify`. Đây là môi trường, không phải skip hay nới test.
    """
    monkeypatch.setenv("NEXGRAPH_PIPELINE", "legacy")


@pytest.fixture
def watched_tmp(tmp_path, monkeypatch):
    """Thư mục tạm riêng cho cả tiến trình này lẫn worker con (spawn kế thừa biến môi trường)."""
    tmp = tmp_path / "tmp"
    tmp.mkdir()
    for key in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.setenv(key, str(tmp))
    monkeypatch.setattr(tempfile, "tempdir", None)
    return tmp


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
        return self.client.post(url, headers={**self.headers, **kw.pop("headers", {})}, **kw)

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
    from nexgraph_engine.interfaces.api.app import create_app
    app = create_app(TOKEN, {"testserver"}, data_dir=tmp_path / "appdata", sse_ping_seconds=0.2)
    yield Api(TestClient(app), app)
    app.state.services.jobs.shutdown()


@pytest.fixture
def pid_flow(api, copy_fixture):
    root = copy_fixture("flow_app")
    p = api.open(root)
    assert api.index(p["project_id"])["state"] == "done"
    return p["project_id"]


@pytest.fixture
def indexed_flow(api, copy_fixture, tmp_path):
    root = copy_fixture("flow_app")
    app_dir = tmp_path / "appdata"
    p = api.open(root)
    assert api.index(p["project_id"])["state"] == "done"
    return root, app_dir
