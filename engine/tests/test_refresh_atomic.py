"""F1: refresh tăng dần là MỘT giao dịch trên CSDL thật (không copy sang bản staging).

REV-10 vẫn phải giữ: lỗi hoặc tiến trình bị kill giữa chừng thì đồ thị đã công bố còn nguyên,
nhưng không được chép cả CSDL hai lần cho mỗi lần refresh (graph 295 MB từng vượt 2 s chỉ vì copy).
"""
import os
import signal
import subprocess
import sys
import time
from contextlib import closing
from pathlib import Path

import pytest

from nexgraph_engine.pipeline import legacy_refresh as refresh_mod
from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.storage.store.graph_store import GraphStore
from test_refresh import graph_state


def _write(root: Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    os.utime(path, (time.time() - 100, time.time() - 100 + len(text) % 7))  # tránh nhánh "mtime quá mới"


def _baseline(db_path: Path) -> dict:
    with closing(open_graph_db(db_path, read_only=True)) as conn:
        return graph_state(GraphStore(conn))


def _stage_files(root: Path) -> list[str]:
    return sorted(p.name for p in (root / ".nexgraph").glob(".graph.db.index-stage*"))


def _edit(root: Path) -> None:
    _write(root, "refresh_probe.py", "def refresh_probe():\n    return 1\n")
    app_py = root / "app.py"
    _write(root, "app.py", app_py.read_text(encoding="utf-8") + "\n\ndef refresh_added():\n    return 2\n")


def test_refresh_writes_live_db_in_one_transaction(api, copy_fixture, monkeypatch):
    """Không còn bản `.index-stage`; độc giả chỉ thấy đồ thị cũ cho tới khi giao dịch COMMIT."""
    root = copy_fixture("flow_app")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    db = root / ".nexgraph" / "graph.db"
    baseline = _baseline(db)
    _edit(root)

    seen: dict[str, object] = {}
    real = refresh_mod.derive_tested_by

    def probe(store):
        seen["stage"] = _stage_files(root)
        with closing(open_graph_db(db, read_only=True)) as reader:
            other = GraphStore(reader)
            seen["files"] = len(other.file_records())
            seen["probe"] = other.conn.execute("SELECT count(*) FROM nut WHERE id_nut LIKE '%refresh_probe%'").fetchone()[0]
        real(store)

    monkeypatch.setattr(refresh_mod, "derive_tested_by", probe)
    out = api.post(f"/v1/projects/{pid}/refresh").json()

    assert out["status"] == "ok" and (out["added"], out["changed"]) == (1, 1), out
    # Bản cũ chép CSDL sang staging: lúc này `.graph.db.index-stage` tồn tại. Bản mới ghi thẳng, một giao dịch.
    assert seen["stage"] == []
    assert seen["files"] == len(baseline["files"])  # độc giả chưa thấy tệp mới khi refresh chưa commit
    assert seen["probe"] == 0
    assert api.get(f"/v1/projects/{pid}/stats").json()["files"] == len(baseline["files"]) + 1
    assert _stage_files(root) == []


def test_refresh_failure_rolls_back_live_db(api, copy_fixture, monkeypatch):
    """Lỗi giữa refresh: giao dịch rollback, đồ thị cũ nguyên, lần chạy được ghi là lỗi."""
    root = copy_fixture("flow_app")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    db = root / ".nexgraph" / "graph.db"
    baseline = _baseline(db)
    previous = api.open(root)["last_indexed_at"]
    _edit(root)

    def boom(*_args, **_kwargs):
        raise RuntimeError("Injected refresh failure")

    monkeypatch.setattr(refresh_mod, "derive_tested_by", boom)
    with pytest.raises(RuntimeError, match="Injected refresh failure"):
        api.post(f"/v1/projects/{pid}/refresh")

    assert _baseline(db) == baseline
    assert api.open(root)["last_indexed_at"] == previous
    assert _stage_files(root) == []
    with closing(open_graph_db(db, read_only=True)) as conn:
        state = conn.execute("SELECT trang_thai, thong_bao_loi FROM lan_lap_chi_muc"
                             " WHERE loai = 'tang_dan' ORDER BY ma_lan DESC LIMIT 1").fetchone()
    assert state["trang_thai"] == "loi" and "Injected refresh failure" in state["thong_bao_loi"]


@pytest.mark.parametrize("mode", ["sigkill", "exit"])
def test_killed_refresh_keeps_old_graph_and_leaves_no_stage_files(api, copy_fixture, tmp_path, mode):
    """`kill -9`/`os._exit` giữa refresh: mở lại thấy đồ thị cũ, integrity ok, không rác staging."""
    root = copy_fixture("flow_app")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    db = root / ".nexgraph" / "graph.db"
    baseline = _baseline(db)
    previous = api.open(root)["last_indexed_at"]
    _edit(root)
    marker = tmp_path / "mid-refresh"

    script = """
import os, sys, time
from pathlib import Path
from nexgraph_engine.pipeline import legacy_refresh as refresh_mod
from nexgraph_engine.pipeline.legacy_refresh import refresh_project
from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.storage.store.graph_store import GraphStore
from nexgraph_engine.storage.store.publication import graph_writer

db, root, marker, mode = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]

def halt():
    pending = marker.with_suffix('.tmp')
    pending.write_text(str(os.getpid()), encoding='ascii')
    pending.replace(marker)
    if mode == 'exit':
        os._exit(9)
    time.sleep(30)

def blocked(*_args, **_kwargs):
    halt()
    raise RuntimeError('unreachable')

refresh_mod.derive_tested_by = blocked
with graph_writer(db) as live:
    with open_graph_db(live) as conn:
        refresh_project(GraphStore(conn), root)
"""
    child = subprocess.Popen([sys.executable, "-c", script, str(db), str(root), str(marker), mode])
    try:
        deadline = time.monotonic() + 30
        while not marker.is_file() and child.poll() is None and time.monotonic() < deadline:
            time.sleep(0.02)
        assert marker.is_file(), f"refresh không tới được giữa giao dịch (exit {child.poll()})"
        if mode == "sigkill" and child.poll() is None:
            os.kill(int(marker.read_text(encoding="ascii")),
                    getattr(signal, "SIGKILL", signal.SIGTERM))  # TerminateProcess trên Windows
    finally:
        if child.poll() is None:
            child.kill()
        child.wait(timeout=10)
    assert child.returncode != 0

    with closing(open_graph_db(db, read_only=True)) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert graph_state(GraphStore(conn)) == baseline
    assert _stage_files(root) == []
    assert api.open(root)["last_indexed_at"] == previous

    # Lần refresh sau vẫn chạy được và thấy đúng thay đổi đã sửa trước khi bị kill.
    out = api.post(f"/v1/projects/{pid}/refresh").json()
    assert out["status"] == "ok" and (out["added"], out["changed"]) == (1, 1), out
    assert api.get(f"/v1/projects/{pid}/search", params={"q": "refresh_probe"}).json()
