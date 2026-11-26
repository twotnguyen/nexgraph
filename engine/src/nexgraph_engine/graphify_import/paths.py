"""Xác thực đích thật (realpath) của tệp nguồn phải nằm trong gốc dự án (QA #67.2).

`graph.json` do vendor sinh có thể nhắc tới đường dẫn tuyệt đối, `../` hoặc symlink trỏ ra
ngoài dự án. Mọi chỗ đọc tệp (metadata, sha256, span) phải đi qua đây **trước khi** mở tệp;
mục không hợp lệ bị bỏ qua và ghi vào báo cáo nạp, không đọc nội dung.

Nhận dạng dạng đường dẫn (POSIX `/…`, Windows `C:\\…`/`C:/…`, UNC `\\\\server\\share\\…`) là hàm THUẦN
theo chuỗi, dùng `PurePosixPath`/`PureWindowsPath` — kết quả như nhau trên mọi nền tảng, không
hỏi `Path`/`os.path` của máy đang chạy (QA vòng 3.1: `Path("/etc/passwd")` không tuyệt đối trên
Windows). Chỉ bước resolve thật mới dùng `Path` của nền tảng, và chỉ cho đường có cú pháp của
chính nền tảng đó (`is_host_absolute`); cú pháp của nền tảng khác không xác thực được realpath
nên bị từ chối nguyên văn.
"""
from __future__ import annotations

import os
from pathlib import Path, PurePath, PurePosixPath, PureWindowsPath


def root_realpath(root: Path) -> Path:
    """Đích thật của gốc dự án (gọi một lần cho mỗi lần nạp)."""
    return Path(root).resolve()


def is_posix_absolute(text: str) -> bool:
    """Dạng POSIX tuyệt đối (`/…`, `//…`), nhận dạng theo chuỗi trên mọi nền tảng."""
    return PurePosixPath(text).is_absolute()


def is_windows_absolute(text: str) -> bool:
    """Dạng Windows tuyệt đối (`C:\\…`, `C:/…`, UNC `\\\\server\\share\\…`), nhận dạng theo chuỗi trên mọi nền tảng."""
    return PureWindowsPath(text).is_absolute()


def is_absolute_source(text: str) -> bool:
    """Tuyệt đối theo cú pháp POSIX hoặc Windows; cùng kết quả trên Windows, macOS và Linux."""
    return is_posix_absolute(text) or is_windows_absolute(text)


def is_host_absolute(text: str, *, windows: bool | None = None) -> bool:
    """Tuyệt đối theo cú pháp của nền tảng đang chạy (`windows=None`: theo `os.name`).

    Chỉ dạng này mới resolve và xác thực được; `/…` trên Windows hay `C:\\…` trên POSIX là dạng của
    nền tảng khác. Tham số `windows` cho phép kiểm cả hai nền tảng từ một máy.
    """
    on_windows = os.name == "nt" if windows is None else windows
    return is_windows_absolute(text) if on_windows else is_posix_absolute(text)


#: Giới hạn cột `tep.duong_dan_tuong_doi` (schema/graph.sql, CHECK length BETWEEN 1 AND 1024).
MAX_REL_PATH = 1024


def has_nul(text: str) -> bool:
    """Chuỗi có NUL: không phải đường dẫn hợp lệ trên nền tảng nào; `os.lstat` ném `ValueError` (QA #67 vòng 4)."""
    return "\x00" in text


def report_path(text: str) -> str:
    """Dạng an toàn để ghi vào báo cáo nạp: NUL viết thành `\\x00`, phần còn lại giữ nguyên văn."""
    return text.replace("\x00", "\\x00")


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
    if not is_windows_absolute(raw):
        return None
    return relative_posix_in_root(root, PureWindowsPath(raw))


def resolve_inside_root(root_real: Path, rel_path: str) -> Path | None:
    """Đường dẫn tuyệt đối thật của `rel_path` nếu nằm trong `root_real`; `None` nếu ra ngoài.

    Chặn trước I/O: đường dẫn tuyệt đối, `..`, và symlink có đích thật ra ngoài gốc.
    `root_real` phải là kết quả của `root_realpath` (đã resolve).
    """
    if not rel_path or has_nul(rel_path) or is_absolute_source(rel_path):
        return None
    try:
        candidate = (root_real / rel_path).resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    if candidate == root_real:
        return None
    try:
        candidate.relative_to(root_real)
    except ValueError:
        return None
    return candidate
