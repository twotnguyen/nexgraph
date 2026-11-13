"""Graph có còn khớp mã nguồn không: để MCP và Tổng quan báo "graph cũ". Chỉ đọc Git."""
from __future__ import annotations

from pathlib import Path

from nexgraph_engine.changes.model import read_changes
from nexgraph_engine.index.discovery import discover, sha256_file
from nexgraph_engine.store.graph_store import GraphStore


def _disk_changes(store: GraphStore, root: Path) -> int:
    """Không có Git: đếm tệp thêm/xoá/đổi nội dung so với đồ thị, chỉ đọc đĩa (không ghi gì)."""
    known = store.file_records()
    disk = {f.rel_path: f for f in discover(root, subdir=store.last_scope(), exclude=store.last_exclude(),
                                            include_docs=store.last_doc_flags()[0], include_media=store.last_doc_flags()[1])}
    changed = len(disk.keys() ^ known.keys())
    for p, f in disk.items():
        k = known.get(p)
        if k and (f.size, f.mtime) != (k.size, k.mtime) and sha256_file(root / p) != k.sha256:
            changed += 1
    return changed


def freshness(store: GraphStore, root: Path) -> dict:
    run = store.last_completed_run()
    out: dict = {"indexed_at": run[0] if run else None, "index_commit": run[1] if run else None,
                 "head_commit": None, "changed_files": None, "stale": False}
    try:
        cs = read_changes(root, store)
    except Exception:  # Git hỏng, hết giờ...: không biết thì không báo cũ
        return out
    out["head_commit"] = cs.base_commit
    try:
        out["changed_files"] = _disk_changes(store, root) if cs.base == "last_index" else len(cs.files)
    except OSError:
        return out
    moved = bool(out["head_commit"] and out["index_commit"] and out["head_commit"] != out["index_commit"])
    out["stale"] = moved or out["changed_files"] > 0
    return out
