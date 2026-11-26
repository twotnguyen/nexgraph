"""MIN-41b N2/N3: mtime=0 nằm trong giao dịch refresh; COMMIT lỗi thì rollback trước khi ghi 'loi'."""
import os
import sqlite3

import pytest

from nexgraph_engine.pipeline.legacy_refresh import refresh_project
from nexgraph_engine.store.graph_store import GraphStore


class _CommitBoom:
    """Bọc sqlite3.Connection: COMMIT ném lỗi như đĩa đầy, các lệnh khác đi nguyên."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    @property
    def in_transaction(self) -> bool:
        return self._conn.in_transaction

    @property
    def isolation_level(self):
        return self._conn.isolation_level

    @isolation_level.setter
    def isolation_level(self, value) -> None:
        self._conn.isolation_level = value

    def execute(self, sql: str, *args):
        if sql.strip().upper().startswith("COMMIT"):
            raise sqlite3.OperationalError("disk I/O error")
        return self._conn.execute(sql, *args)

    def __getattr__(self, name: str):
        return getattr(self._conn, name)


def test_touch_file_runs_inside_refresh_transaction(copy_fixture, index_project, monkeypatch):
    """N2: chỉ đổi mtime (nội dung y nguyên) thì `touch_file` phải nằm trong giao dịch atomic."""
    root = copy_fixture("flow_app")
    store, _, _ = index_project(root)
    os.utime(root / "app.py", None)  # mtime mới, size/hash không đổi → nhánh `touched`
    seen: list[bool] = []
    real = GraphStore.touch_file

    def spy(self, record):
        seen.append(self.conn.in_transaction)
        return real(self, record)

    monkeypatch.setattr(GraphStore, "touch_file", spy)
    result = refresh_project(store, root)
    assert (result.added, result.changed, result.removed) == (0, 0, 0)
    assert seen == [True]


def test_commit_failure_rolls_back_before_error_state(copy_fixture, index_project):
    """N3: COMMIT ném lỗi → atomic() rollback ngay, không để handler ghi 'loi' commit lại dữ liệu dở."""
    root = copy_fixture("flow_app")
    store, _, _ = index_project(root)
    real = store.conn
    nodes_before = real.execute("SELECT count(*) FROM nut").fetchone()[0]
    path = root / "app.py"
    path.write_text(path.read_text(encoding="utf-8") + "\n\ndef commit_boom_probe():\n    return 9\n", encoding="utf-8")
    os.utime(path, (os.path.getmtime(path), os.path.getmtime(path)))  # mtime khác bản ghi để refresh thấy
    store.conn = _CommitBoom(real)

    with pytest.raises(sqlite3.OperationalError, match="disk I/O error"):
        refresh_project(store, root)

    store.conn = real
    assert real.in_transaction is False
    assert real.execute("SELECT count(*) FROM nut").fetchone()[0] == nodes_before
    row = real.execute("SELECT trang_thai FROM lan_lap_chi_muc WHERE loai = 'tang_dan'"
                       " ORDER BY ma_lan DESC LIMIT 1").fetchone()
    assert row["trang_thai"] == "loi"
