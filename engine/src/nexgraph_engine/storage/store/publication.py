"""Dựng đồ thị mới riêng và xuất bản vào đúng CSDL đang dùng."""
from __future__ import annotations

import errno
import os
import sqlite3
import time
from collections.abc import Iterator
from contextlib import closing, contextmanager
from pathlib import Path

from nexgraph_engine.core.schema.db import open_graph_db


class GraphWriteBusy(RuntimeError):
    """Một tiến trình khác đang ghi đồ thị."""


def is_busy_error(exc: BaseException) -> bool:
    """SQLite báo bận (khoá ghi) — khác lỗi thật như đầy đĩa hay CSDL hỏng."""
    if not isinstance(exc, sqlite3.OperationalError):
        return False
    text = str(exc).lower()
    return "locked" in text or "busy" in text


@contextmanager
def graph_writer(path: Path) -> Iterator[Path]:
    """Khóa ghi dùng chung giữa app và lệnh refresh; đóng tệp sẽ nhả khóa."""
    path = path.resolve()
    lock_path = path.with_name(f".{path.name}.writer-lock")
    with lock_path.open("a+b") as handle:
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if exc.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise
            raise GraphWriteBusy("Đồ thị đang được cập nhật bởi tiến trình khác") from exc
        yield path


def backup_graph(source: sqlite3.Connection, target: sqlite3.Connection, *, timeout: float = 30) -> None:
    """Chép và commit một snapshot bằng SQLite, giữ độc giả WAL đang mở."""
    deadline = time.monotonic() + timeout

    def check(status: int, _remaining: int, _total: int) -> None:
        if status != sqlite3.SQLITE_DONE and time.monotonic() >= deadline:
            raise sqlite3.OperationalError("Quá thời gian sao chép CSDL đồ thị")

    # Caller sở hữu kết nối đích. Để callback giới hạn thời gian chờ SQLite.
    target.execute("PRAGMA busy_timeout = 0")
    source.backup(target, pages=256, progress=check, sleep=0.05)


WAL_SIZE_LIMIT = 64 * 1024 * 1024  # WAL còn lại sau checkpoint (F7); đủ cho lô ghi bình thường


def publish_stage(stage: sqlite3.Connection, live_path: Path, *, timeout: float = 30) -> None:
    """Xuất bản bản staging đè lên CSDL thật; lỗi giữa chừng để nguyên bản đã công bố.

    Publish ghi toàn bộ staging vào WAL của bản thật nên đỉnh đĩa ~2× CSDL (F7 của review PR #41):
    đặt `journal_size_limit` rồi cắt WAL ngay sau khi xong. Refresh tăng dần không đi qua đây nữa
    (một giao dịch trên CSDL thật), nên rủi ro này chỉ còn ở lập chỉ mục đầy đủ.
    """
    with closing(sqlite3.connect(f"{live_path.as_uri()}?mode=rw", uri=True)) as live:
        live.execute(f"PRAGMA journal_size_limit = {WAL_SIZE_LIMIT}")
        backup_graph(stage, live, timeout=timeout)
        try:
            live.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.OperationalError:
            pass  # còn độc giả đang mở: checkpoint sau (hoặc lần publish sau) sẽ cắt


@contextmanager
def stage_graph(path: Path) -> Iterator[tuple[Path, sqlite3.Connection]]:
    """Tạo bản làm việc tách biệt, giữ khóa ghi và đóng graph hiện tại sau khi chép."""
    with graph_writer(path) as live_path:
        stage_path = live_path.with_name(f".{live_path.name}.index-stage")
        scratch = (stage_path, *(stage_path.with_name(stage_path.name + suffix)
                                 for suffix in ("-wal", "-shm", "-journal")))
        for file in scratch:
            file.unlink(missing_ok=True)  # dọn phần còn lại nếu engine trước bị dừng
        try:
            with closing(sqlite3.connect(f"{live_path.as_uri()}?mode=ro", uri=True)) as live:
                with closing(sqlite3.connect(stage_path)) as copy:
                    backup_graph(live, copy)
            # Chỉ nâng cấp schema trên bản tạm để lỗi vẫn giữ nguyên bản đã công bố.
            with closing(open_graph_db(stage_path)) as stage:
                yield live_path, stage
        finally:
            for file in scratch:
                try:
                    file.unlink(missing_ok=True)
                except OSError:
                    # Lần sau dọn lại dưới khóa. Không đổi kết quả sau khi đã xuất bản.
                    pass
