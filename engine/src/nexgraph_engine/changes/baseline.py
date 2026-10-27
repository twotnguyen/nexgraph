"""So sánh với trạng thái của lần lập chỉ mục đầy đủ gần nhất, dựa trên mã băm nội dung (project không có Git)."""
from __future__ import annotations

from nexgraph_engine.changes import model
from nexgraph_engine.changes.model import ChangeSet, FileChange, NO_GIT_NOTE
from nexgraph_engine.store.graph_store import GraphStore


def baseline_changes(store: GraphStore) -> ChangeSet:
    now = {p: r.sha256 for p, r in store.file_records().items()}
    base = store.baseline()
    files = [FileChange(p, "A") for p in now if p not in base]
    files += [FileChange(p, "M") for p, h in now.items() if p in base and base[p] != h]
    files += [FileChange(p, "D") for p in base if p not in now]
    files.sort(key=lambda f: f.path)
    truncated = len(files) > model.MAX_FILES
    return ChangeSet("last_index", None, files[:model.MAX_FILES], truncated, NO_GIT_NOTE)
