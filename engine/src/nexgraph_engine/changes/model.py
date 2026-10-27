"""Mô hình thay đổi của project và chọn nguồn so sánh (Git hoặc lần lập chỉ mục trước)."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from nexgraph_engine.store.graph_store import GraphStore

MAX_FILES = 500
NO_GIT_NOTE = "Không có Git: so với lần lập chỉ mục trước"


@dataclass(frozen=True)
class FileChange:
    path: str
    status: Literal["M", "A", "D", "R"]
    old_path: str | None = None
    ranges: list[tuple[int, int]] | None = None  # dòng (1-based, gồm hai đầu) phía tệp mới; None = cả tệp


@dataclass(frozen=True)
class ChangeSet:
    base: Literal["git_head", "last_index"]
    base_commit: str | None
    files: list[FileChange] = field(default_factory=list)
    truncated: bool = False
    note: str | None = None


def read_changes(root: Path, store: GraphStore) -> ChangeSet:
    from nexgraph_engine.changes.baseline import baseline_changes
    from nexgraph_engine.changes.gitdiff import git_changes_or_reason

    cs, reason = git_changes_or_reason(root)
    if cs is not None:
        return cs
    base = baseline_changes(store)
    if reason == "no_commit":
        note = "Repo Git chưa có commit: so với lần lập chỉ mục trước"
    elif reason == "no_git":
        note = "Không có Git (không tìm thấy lệnh git): so với lần lập chỉ mục trước"
    else:
        note = NO_GIT_NOTE
    return ChangeSet(base.base, None, base.files, base.truncated, note)
