"""Graph có còn khớp mã nguồn không: so sánh nội dung phạm vi đã lập chỉ mục."""
from __future__ import annotations

import time
from pathlib import Path

from nexgraph_engine.index.discovery import discover, sha256_file
from nexgraph_engine.index.indexer import _git_head
from nexgraph_engine.index.refresh import RACY_SECONDS, real_file_records
from nexgraph_engine.store.graph_store import GraphStore


def _disk_changes(store: GraphStore, root: Path) -> int:
    """Đếm khác biệt giữa toàn bộ phạm vi đã lập chỉ mục và đồ thị hiện tại."""
    known = real_file_records(store)
    docs, media = store.last_doc_flags()
    disk = {
        f.rel_path: f
        for f in discover(root, subdir=store.last_scope(), exclude=store.last_exclude(),
                          include_docs=docs, include_media=media, include_config=store.last_config_flag())
    }
    changed = len(disk.keys() ^ known.keys())
    now = time.time()
    for rel_path, f in disk.items():
        record = known.get(rel_path)
        if record is None:
            continue
        # Cùng điều kiện bỏ qua như refresh_project: báo "cũ" cho tệp mà refresh sẽ không đọc lại thì cũ mãi,
        # và băm cả 17.000 tệp mỗi lần mở Tổng quan mất 3,7 s.
        if f.size == record.size and f.mtime == record.mtime and abs(now - f.mtime) >= RACY_SECONDS:
            continue
        if sha256_file(root / rel_path) != record.sha256:
            changed += 1
    return changed


def freshness(store: GraphStore, root: Path) -> dict:
    run = store.last_completed_run()
    out: dict = {"indexed_at": run[0] if run else None, "index_commit": run[1] if run else None,
                 "head_commit": _git_head(root), "changed_files": None, "stale": False}
    # Theo dõi HEAD bằng một lệnh. Phạm vi mã nguồn đối chiếu trực tiếp với bản công bố.
    moved = bool(out["head_commit"] and out["index_commit"] and out["head_commit"] != out["index_commit"])
    try:
        out["changed_files"] = _disk_changes(store, root)
    except OSError:
        out["stale"] = moved
        return out
    out["stale"] = moved or out["changed_files"] > 0
    return out
