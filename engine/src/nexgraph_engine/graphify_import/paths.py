"""Xác thực đích thật (realpath) của tệp nguồn phải nằm trong gốc dự án (QA #67.2).

`graph.json` do vendor sinh có thể nhắc tới đường dẫn tuyệt đối, `../` hoặc symlink trỏ ra
ngoài dự án. Mọi chỗ đọc tệp (metadata, sha256, span) phải đi qua đây **trước khi** mở tệp;
mục không hợp lệ bị bỏ qua và ghi vào báo cáo nạp, không đọc nội dung.

Đường tuyệt đối được nhận dạng theo nền tảng (POSIX `/…`, Windows `C:\…`/`C:/…`, UNC
`\\server\…`) rồi mới đổi thành POSIX tương đối (QA vòng 2.1).
"""
from __future__ import annotations

import re
from pathlib import Path, PurePath, PureWindowsPath

# `C:\…`, `C:/…`, hoặc UNC `\\server\share…` — nhận dạng được cả trên nền POSIX.
_WINDOWS_ABSOLUTE = re.compile(r"^(?:[A-Za-z]:[\\/]|\\\\)")


def root_realpath(root: Path) -> Path:
    """Đích thật của gốc dự án (gọi một lần cho mỗi lần nạp)."""
    return Path(root).resolve()


def is_windows_absolute(text: str) -> bool:
    """Chuỗi có dạng đường tuyệt đối Windows (ổ đĩa hoặc UNC), bất kể nền tảng đang chạy."""
    return bool(_WINDOWS_ABSOLUTE.match(text))


def is_absolute_source(text: str) -> bool:
    """Đường tuyệt đối theo nền tảng hiện tại hoặc có dạng Windows."""
    return is_windows_absolute(text) or Path(text).is_absolute()


def relative_posix_in_root(root: PurePath, candidate: PurePath) -> str | None:
    """Đường tương đối POSIX nếu `candidate` nằm trong `root`; `None` nếu ngoài/bằng gốc.

    Hàm thuần (không I/O) nên kiểm được cả `PureWindowsPath` trên macOS.
    """
    try:
        rel = candidate.relative_to(root)
    except ValueError:
        return None
    if not rel.parts or any(part == ".." for part in rel.parts):
        return None
    return "/".join(rel.parts)


def windows_relative_source(raw: str, root: PureWindowsPath) -> str | None:
    """Đường Windows tuyệt đối → POSIX tương đối trong `root` (thuần, dùng cho test đa nền tảng)."""
    candidate = PureWindowsPath(raw)
    if not candidate.is_absolute():
        return None
    return relative_posix_in_root(root, candidate)


def resolve_inside_root(root_real: Path, rel_path: str) -> Path | None:
    """Đường dẫn tuyệt đối thật của `rel_path` nếu nằm trong `root_real`; `None` nếu ra ngoài.

    Chặn trước I/O: đường dẫn tuyệt đối, `..`, và symlink có đích thật ra ngoài gốc.
    `root_real` phải là kết quả của `root_realpath` (đã resolve).
    """
    if not rel_path or is_absolute_source(rel_path):
        return None
    try:
        candidate = (root_real / rel_path).resolve()
    except (OSError, RuntimeError):
        return None
    if candidate == root_real:
        return None
    try:
        candidate.relative_to(root_real)
    except ValueError:
        return None
    return candidate
