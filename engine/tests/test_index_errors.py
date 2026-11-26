"""ENG-07: lỗi trên đường người dùng thấy phải tới được người dùng, không im lặng.

Tệp không đọc được trước đây chỉ ghi vào bảng `loi_phan_tich`; job vẫn báo "done" nên app không có gì để hiện.
Nay số tệp lỗi đi theo `ProgressEvent` cuối (thành `job.message`), và lần lập chỉ mục mà **không đọc được tệp
nào** kết thúc ở trạng thái lỗi thay vì công bố đồ thị rỗng.
"""
import os
import threading

import pytest

from nexgraph_engine.core.ids import file_node_id
from nexgraph_engine.pipeline import legacy_indexer as indexer_module
from nexgraph_engine.indexing.index.events import EventBus
from nexgraph_engine.pipeline.legacy_indexer import ExtractedFile, Indexer, ProgressEvent, RunResult
from nexgraph_engine.pipeline.job_manager import JobManager
from nexgraph_engine.indexing.index.scan import scan_project
from nexgraph_engine.core.schema.db import open_graph_db
from nexgraph_engine.core.schema.enums import NodeKind
from nexgraph_engine.storage.store.graph_store import GraphStore
from nexgraph_engine.storage.store.models import FileRec, Node

unreadable_only = pytest.mark.skipif(os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0),
                                     reason="chmod 000 không chặn được trên Windows/root")

FILES = {
    "a.py": "def a():\n    return 1\n",
    "b.py": "def b():\n    return 2\n",
    "c.py": "def c():\n    return 3\n",
}


def _write(root):
    for rel, text in FILES.items():
        (root / rel).write_text(text, encoding="utf-8")


def _broken(monkeypatch, names):
    real = indexer_module.extract_file

    def fake(root, f, **kw):
        if f.rel_path in names:
            rec = FileRec(f.rel_path, f.language, f.size, f.mtime, "0" * 64, f.is_test)
            node = Node(id=file_node_id(f.rel_path), kind=NodeKind.FILE, label=f.rel_path,
                        qualified_name=f.rel_path, file=f.rel_path, is_test=f.is_test)
            return ExtractedFile(rec, [node], [], [], {}, [("read", f"Không đọc được tệp: {f.rel_path}")])
        return real(root, f, **kw)

    monkeypatch.setattr(indexer_module, "extract_file", fake)


def _run(root, tmp_path, events):
    store = GraphStore(open_graph_db(tmp_path / "g.db"))
    store.init_project("p", has_git=False)
    result = Indexer(store, root, on_progress=events.append, cancel=threading.Event()).run()
    return result


def test_partial_read_failure_is_reported_in_done_event(tmp_path, monkeypatch):
    root = tmp_path / "src"
    root.mkdir()
    _write(root)
    _broken(monkeypatch, {"b.py"})
    events: list[ProgressEvent] = []
    result = _run(root, tmp_path, events)

    assert result.state == "hoan_tat"
    final = events[-1]
    assert final.state == "done"
    assert final.message and "1 tệp" in final.message and "b.py" in final.message


def test_clean_run_keeps_done_message_empty(tmp_path):
    root = tmp_path / "src"
    root.mkdir()
    _write(root)
    events: list[ProgressEvent] = []
    result = _run(root, tmp_path, events)
    assert result.state == "hoan_tat" and events[-1].state == "done" and events[-1].message is None


def test_nothing_readable_fails_the_run(tmp_path, monkeypatch):
    root = tmp_path / "src"
    root.mkdir()
    _write(root)
    _broken(monkeypatch, set(FILES))
    events: list[ProgressEvent] = []
    result = _run(root, tmp_path, events)

    assert result.state == "loi"
    assert events[-1].state == "error"
    assert events[-1].message and "3 tệp" in events[-1].message


class WarningIndexer(Indexer):
    """Indexer giả: chỉ phát sự kiện cuối kèm cảnh báo để kiểm job.message."""

    def run(self) -> RunResult:
        self.on_progress(ProgressEvent("done", 1, 1, "1 tệp không đọc được"))
        return RunResult(1, "hoan_tat", 1, 0, 0, 0.0)


def test_job_payload_carries_the_warning_message(tmp_path, copy_fixture):
    from nexgraph_engine.storage.store.projects import ProjectRegistry

    registry = ProjectRegistry(tmp_path / "appdata")
    info = registry.open_project(copy_fixture("py_mini"))
    manager = JobManager(registry, EventBus(), indexer_cls=WarningIndexer)
    try:
        job_id = manager.start_index(info.project_id)
        job = None
        for _ in range(2000):
            job = manager.get(job_id)
            if job["state"] in ("done", "error", "cancelled"):
                break
            threading.Event().wait(0.01)
        assert job["state"] == "done"
        assert job["message"] == "1 tệp không đọc được"
    finally:
        manager.shutdown()


def _run_indexer(root, tmp_path, events):
    store = GraphStore(open_graph_db(tmp_path / "g.db"))
    store.init_project("p", has_git=False)
    indexer = Indexer(store, root, on_progress=events.append, cancel=threading.Event())
    return indexer.run(), indexer


@unreadable_only
def test_unreadable_directory_is_reported_not_silently_skipped(tmp_path):
    """A1 F6: thư mục chmod 000 bị bỏ qua im lặng — phải thành cảnh báo, index vẫn xong."""
    root = tmp_path / "src"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    secret = root / "secret"
    secret.mkdir()
    (secret / "b.py").write_text("def b():\n    return 2\n", encoding="utf-8")
    secret.chmod(0)
    try:
        events: list[ProgressEvent] = []
        result, indexer = _run_indexer(root, tmp_path, events)
        assert result.state == "hoan_tat"
        assert indexer.unreadable_paths == ["secret"]
        final = events[-1]
        assert final.state == "done" and final.message and "secret" in final.message

        scan = scan_project(root)
        assert scan.files == 1 and scan.unreadable == ["secret"]
    finally:
        secret.chmod(0o755)


@unreadable_only
def test_index_job_result_carries_unreadable_paths(tmp_path):
    """A1 F6: kết quả job index có trường ổn định để desktop hiện cảnh báo."""
    from nexgraph_engine.storage.store.projects import ProjectRegistry

    root = tmp_path / "proj"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    locked = root / "locked"
    locked.mkdir()
    (locked / "b.py").write_text("def b():\n    return 2\n", encoding="utf-8")
    locked.chmod(0)
    registry = ProjectRegistry(tmp_path / "appdata")
    info = registry.open_project(root)
    manager = JobManager(registry, EventBus())
    try:
        job_id = manager.start_index(info.project_id)
        job = None
        for _ in range(3000):
            job = manager.get(job_id)
            if job["state"] in ("done", "error", "cancelled"):
                break
            threading.Event().wait(0.01)
        assert job["state"] == "done", job
        assert job["result"]["unreadable_paths"] == ["locked"]
        assert job["result"]["unreadable_count"] == 1
        assert "locked" in (job["message"] or "")
    finally:
        manager.shutdown()
        locked.chmod(0o755)
