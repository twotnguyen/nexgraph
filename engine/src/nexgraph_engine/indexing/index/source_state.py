"""Trạng thái nguồn so với đồ thị đã lập chỉ mục: HEAD của Git, ngưỡng mtime "racy", bản ghi tệp thật.

Dùng chung cho lập chỉ mục/refresh (tầng điều phối) và kiểm độ mới của đồ thị (tầng phân tích), nên nằm ở
tầng lập chỉ mục (ADR 0026 pha 4b; trước ở `index/indexer.py` và `index/refresh.py`).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from nexgraph_engine.indexing.index.extra_sources import is_source_path
from nexgraph_engine.storage.store.graph_store import GraphStore
from nexgraph_engine.storage.store.models import FileRec
from nexgraph_engine.core.subprocesses import run_captured

RACY_SECONDS = 2  # mtime gần hiện tại hơn mức này thì luôn băm lại (hai lần sửa trong cùng một giây)


def _git_head(root: Path) -> str | None:
    if not (root / ".git").exists():
        return None
    try:
        out = run_captured(["git", "rev-parse", "HEAD"], cwd=root, timeout=10)
        sha = out.stdout.decode("ascii", "replace").strip()
        return sha if out.returncode == 0 and 40 <= len(sha) <= 64 else None
    except (OSError, subprocess.SubprocessError):
        return None


def real_file_records(store: GraphStore) -> dict[str, FileRec]:
    """Tệp trên đĩa đã index; tệp ảo của nguồn bổ sung (W11) chỉ đổi khi index đầy đủ."""
    return {p: r for p, r in store.file_records().items() if not is_source_path(p)}
