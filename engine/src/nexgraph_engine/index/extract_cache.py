"""Thư mục cache AST của bộ trích xuất trong thư mục tạm của máy (ENG-extract-killed).

Mỗi tiến trình engine (và worker trích xuất) dùng một thư mục `nexgraph-extract-<pid>-xxxxxxxx`, xoá bằng `atexit`.
Tiến trình bị dừng cứng — `taskkill /T /F` khi thoát app trên Windows, SIGKILL khi quá hạn, worker bị `_kill_pool`,
crash — không chạy `atexit`, nên thư mục bị bỏ lại. Tiến trình engine sau dọn thư mục của pid đã chết.

Module nhẹ (không nạp bộ trích xuất) để `serve` gọi được ngay khi khởi động.
"""
from __future__ import annotations

import logging
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

from nexgraph_engine.subprocesses import pid_alive

logger = logging.getLogger(__name__)

PREFIX = "nexgraph-extract-"
_OWNED = re.compile(r"^nexgraph-extract-(\d+)-")
# Tên kiểu cũ (≤ 0.2.0-alpha.1) không có pid: chỉ xoá khi lâu không đổi, vì có thể là của engine bản cũ đang chạy.
LEGACY_MAX_AGE_SECONDS = 24 * 3600


def owned_prefix() -> str:
    """Tiền tố cho thư mục cache của tiến trình này."""
    return f"{PREFIX}{os.getpid()}-"


def _orphan(entry: os.DirEntry, now: float) -> bool:
    match = _OWNED.match(entry.name)
    if match:
        pid = int(match.group(1))
        # Cùng pid với tiến trình này mà chưa tạo cache thì là của tiến trình cũ trùng pid đã chết.
        return pid == os.getpid() or not pid_alive(pid)
    return now - entry.stat(follow_symlinks=False).st_mtime > LEGACY_MAX_AGE_SECONDS


def sweep_orphan_caches(base: Path | None = None) -> int:
    """Xoá cache của tiến trình đã chết trong `base` (mặc định thư mục tạm). Trả số thư mục đã xoá.

    Chỉ gọi khi tiến trình này chưa có cache (thư mục mang pid của chính nó là của tiến trình cũ trùng pid).
    """
    base = Path(base) if base is not None else Path(tempfile.gettempdir())
    removed = 0
    now = time.time()
    try:
        entries = [e for e in os.scandir(base) if e.name.startswith(PREFIX)]
    except OSError:
        return 0
    for entry in entries:
        try:
            if not entry.is_dir(follow_symlinks=False) or not _orphan(entry, now):
                continue
        except OSError:
            continue
        shutil.rmtree(entry.path, ignore_errors=True)
        removed += not os.path.exists(entry.path)
    if removed:
        logger.info("Đã dọn %d thư mục cache trích xuất của tiến trình đã dừng", removed)
    return removed
