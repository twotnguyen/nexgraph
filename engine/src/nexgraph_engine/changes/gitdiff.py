"""Đọc thay đổi từ Git, chỉ đọc: không bao giờ ghi vào `.git/` hay mã nguồn (spec §5.6).

Chỉ dùng rev-parse, diff, ls-files, luôn kèm `--no-optional-locks` và `GIT_OPTIONAL_LOCKS=0` để Git không tự làm mới index.
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

from nexgraph_engine.changes.model import MAX_FILES as _MAX_FILES_DEFAULT  # noqa: F401  (đọc lại ở lúc gọi)
from nexgraph_engine.changes.model import ChangeSet, FileChange
from nexgraph_engine.index.discovery import GENERATED_SUFFIXES, SKIP_DIRS, language_of
from nexgraph_engine.subprocesses import run_captured

MAX_FILES = _MAX_FILES_DEFAULT
TIMEOUT = 15
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


class _GitError(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _git(root: Path, *args: str) -> str:
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0"}
    try:
        out = run_captured(["git", "--no-optional-locks", "-c", "core.quotepath=off", *args],
                           cwd=root, env=env, timeout=TIMEOUT)
    except FileNotFoundError:
        raise _GitError("no_git") from None
    except (OSError, subprocess.SubprocessError):
        raise _GitError("failed") from None
    if out.returncode != 0:
        raise _GitError("failed")
    return out.stdout.decode("utf-8", "replace")


def _relevant(path: str) -> bool:
    parts = path.split("/")
    return (language_of(path) is not None and not path.endswith(GENERATED_SUFFIXES)
            and not (set(parts[:-1]) & SKIP_DIRS))


def _parse_hunks(diff: str, modified: set[str]) -> dict[str, list[tuple[int, int]] | None]:
    """Đoạn dòng (phía mới) theo từng tệp sửa; tệp nhị phân ánh xạ sang `...` (bị bỏ) bằng khoá vắng mặt."""
    header_to_path = {f"diff --git a/{p} b/{p}": p for p in modified}
    out: dict[str, list[tuple[int, int]] | None] = {}
    current: str | None = None
    for line in diff.splitlines():
        if line.startswith("diff --git "):
            current = header_to_path.get(line)
            if current is not None:
                out[current] = []
        elif current is not None and line.startswith("Binary files "):
            out.pop(current, None)
            current = None
        elif current is not None and line.startswith("@@"):
            m = _HUNK.match(line)
            if not m:
                continue
            start, count = int(m.group(1)), int(m.group(2)) if m.group(2) is not None else 1
            rng = (start, start + count - 1) if count > 0 else (max(start, 1), start + 1)
            out[current].append(rng)  # type: ignore[union-attr]
    return out


def git_changes_or_reason(root: Path) -> tuple[ChangeSet | None, str | None]:
    """(ChangeSet, None) nếu dùng được Git, ngược lại (None, lý do: no_git | not_repo | no_commit | failed)."""
    root = Path(root)
    if not (root / ".git").exists():
        return None, "not_repo"
    try:
        try:
            _git(root, "rev-parse", "--is-inside-work-tree")
        except _GitError as e:
            raise _GitError("not_repo" if e.reason == "failed" else e.reason) from None
        try:
            head = _git(root, "rev-parse", "--verify", "HEAD").strip()
        except _GitError as e:
            raise _GitError("no_commit" if e.reason == "failed" else e.reason) from None
        status = _git(root, "diff", "--name-status", "-z", "-M", "--relative", "HEAD").split("\0")
        untracked = [p for p in _git(root, "ls-files", "--others", "--exclude-standard", "-z").split("\0") if p]
        entries: dict[str, FileChange] = {}
        i = 0
        while i < len(status) and status[i]:
            code = status[i][0]
            if code in "RC":
                old, new = status[i + 1], status[i + 2]
                i += 3
                if _relevant(new):
                    entries[new] = FileChange(new, "R", old, None)
            else:
                path = status[i + 1]
                i += 2
                if _relevant(path):
                    st = {"M": "M", "A": "A", "D": "D", "T": "M"}.get(code, "M")
                    entries[path] = FileChange(path, st, None, None)  # type: ignore[arg-type]
        for p in untracked:
            if _relevant(p) and p not in entries:
                entries[p] = FileChange(p, "A", None, None)
        ordered = sorted(entries.values(), key=lambda f: f.path)
        truncated = len(ordered) > MAX_FILES
        ordered = ordered[:MAX_FILES]
        modified = {f.path for f in ordered if f.status == "M"}
        if modified:
            diff = _git(root, "diff", "-U0", "--no-color", "--no-ext-diff", "-M", "--relative", "HEAD")
            hunks = _parse_hunks(diff, modified)
            result = []
            for f in ordered:
                if f.status != "M":
                    result.append(f)
                elif f.path in hunks:
                    result.append(FileChange(f.path, "M", None, hunks[f.path]))
                elif _is_binary_or_unknown(f.path, diff):
                    continue  # nhị phân: bỏ
                else:
                    result.append(f)  # không thấy khối diff (ví dụ chỉ đổi quyền): coi cả tệp
            ordered = result
        return ChangeSet("git_head", head, ordered, truncated, None), None
    except _GitError as e:
        return None, e.reason


def _is_binary_or_unknown(path: str, diff: str) -> bool:
    return f"diff --git a/{path} b/{path}" in diff  # có khối nhưng bị gỡ vì nhị phân


def git_changes(root: Path) -> ChangeSet | None:
    return git_changes_or_reason(root)[0]
