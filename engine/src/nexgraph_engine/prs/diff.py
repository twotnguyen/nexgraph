"""Đọc unified diff của `gh pr diff` thành ChangeSet để dùng lại `impact/analyze` mà không checkout nhánh.

Đồ thị cục bộ là bản của nhánh gốc, nên khoảng dòng lấy theo **phía cũ** của hunk (giống review của bản cloud:
"so thay đổi của PR với nhánh mặc định đã index").
"""
from __future__ import annotations

import codecs
import re
from dataclasses import dataclass, field

from nexgraph_engine.changes.model import MAX_FILES, ChangeSet, FileChange

_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


@dataclass
class DiffFile:
    path: str                      # đường dẫn mới (đường dẫn cũ nếu tệp bị xoá)
    status: str = "M"              # M | A | D | R
    old_path: str | None = None    # chỉ có khi R
    old_ranges: list[tuple[int, int]] = field(default_factory=list)
    removed: dict[int, str] = field(default_factory=dict)  # dòng phía cũ -> nội dung dòng bị bỏ
    added: list[str] = field(default_factory=list)
    binary: bool = False


def _unquote(p: str) -> str:
    """Tên tệp git đặt trong ngoặc kép, byte ngoài ASCII viết dạng \\ooo (core.quotepath)."""
    try:
        return codecs.escape_decode(p[1:-1].encode("utf-8"))[0].decode("utf-8", "replace")
    except ValueError:
        return p[1:-1]


def _strip(p: str, prefix: str) -> str | None:
    p = p.split("\t", 1)[0].strip()
    if len(p) >= 2 and p[0] == p[-1] == '"':
        p = _unquote(p)
    if p == "/dev/null":
        return None
    return p[len(prefix):] if p.startswith(prefix) else p


def _maybe_unquote(p: str) -> str:
    return _unquote(p) if len(p) >= 2 and p[0] == p[-1] == '"' else p


def _header_path(rest: str) -> str | None:
    """`a/P b/P` -> P (dùng khi khối không có dòng ---/+++, ví dụ tệp nhị phân hay chỉ đổi quyền)."""
    n = (len(rest) - 1) // 2
    if rest.startswith("a/") and rest[n + 1:] == "b/" + rest[2:n]:
        return rest[2:n]
    return None


def parse_unified_diff(text: str) -> list[DiffFile]:
    files: list[DiffFile] = []
    cur: DiffFile | None = None
    old = old_left = new_left = 0
    rename_from = rename_to = minus = plus = None
    header = None

    def finish() -> None:
        if cur is None:
            return
        path = rename_to or plus or minus or rename_from or header
        if path is None:
            return
        cur.path = path
        if cur.status == "R":
            cur.old_path = rename_from or minus
        files.append(cur)

    for line in text.split("\n"):  # không dùng splitlines: \u2028, \x0c trong dòng mã làm lệch số dòng hunk
        if line.startswith("diff --git "):
            finish()
            cur, old_left, new_left = DiffFile(path=""), 0, 0
            rename_from = rename_to = minus = plus = None
            header = _header_path(line[len("diff --git "):])
            continue
        if cur is None:
            continue
        if old_left > 0 or new_left > 0:  # đếm theo số dòng của hunk: dòng bị bỏ "-- x" không bị nhầm là "--- "
            if line.startswith("-"):
                cur.removed[old] = line[1:]
                old, old_left = old + 1, old_left - 1
            elif line.startswith("+"):
                cur.added.append(line[1:])
                new_left -= 1
            elif not line.startswith("\\"):
                old, old_left, new_left = old + 1, old_left - 1, new_left - 1
            continue
        m = _HUNK.match(line)
        if m:
            old, count = int(m.group(1)), int(m.group(2)) if m.group(2) is not None else 1
            old_left, new_left = count, int(m.group(4)) if m.group(4) is not None else 1
            cur.old_ranges.append((old, old + count - 1) if count > 0 else (max(old, 1), old + 1))
            continue
        if line.startswith("new file mode"):
            cur.status = "A"
        elif line.startswith("deleted file mode"):
            cur.status = "D"
        elif line.startswith("rename from "):
            cur.status, rename_from = "R", _maybe_unquote(line[len("rename from "):])
        elif line.startswith("rename to "):
            rename_to = _maybe_unquote(line[len("rename to "):])
        elif line.startswith("--- "):
            minus = _strip(line[4:], "a/")
        elif line.startswith("+++ "):
            plus = _strip(line[4:], "b/")
        elif line.startswith("Binary files "):
            cur.binary = True
    finish()
    return files


def to_changeset(files: list[DiffFile], max_files: int = MAX_FILES) -> ChangeSet:
    """Tệp sửa: khoảng dòng phía cũ; tệp xoá/đổi tên: cả tệp theo đường dẫn cũ (nút còn trong đồ thị nhánh gốc);
    tệp mới: chưa có nút nào nên bỏ."""
    out: list[FileChange] = []
    for f in files:
        if f.status == "A" or (f.status == "M" and not f.old_ranges):  # tệp mới, nhị phân, chỉ đổi quyền
            continue
        if f.status == "M":
            out.append(FileChange(f.path, "M", None, list(f.old_ranges)))
        else:
            out.append(FileChange(f.old_path or f.path, "M", None, None))
    out.sort(key=lambda c: c.path)
    return ChangeSet("git_head", None, out[:max_files], len(out) > max_files, None)
