"""Xác thực đích thật (realpath) của tệp nguồn phải nằm trong gốc dự án (QA #67.2).

`graph.json` do vendor sinh có thể nhắc tới đường dẫn tuyệt đối, `../` hoặc symlink trỏ ra
ngoài dự án. Mọi chỗ đọc tệp (metadata, sha256, span) phải đi qua đây **trước khi** mở tệp;
mục không hợp lệ bị bỏ qua và ghi vào báo cáo nạp, không đọc nội dung.
"""
from __future__ import annotations

from pathlib import Path


def root_realpath(root: Path) -> Path:
    """Đích thật của gốc dự án (gọi một lần cho mỗi lần nạp)."""
    return Path(root).resolve()


def resolve_inside_root(root_real: Path, rel_path: str) -> Path | None:
    """Đường dẫn tuyệt đối thật của `rel_path` nếu nằm trong `root_real`; `None` nếu ra ngoài.

    Chặn trước I/O: đường dẫn tuyệt đối, `..`, và symlink có đích thật ra ngoài gốc.
    `root_real` phải là kết quả của `root_realpath` (đã resolve).
    """
    if not rel_path or Path(rel_path).is_absolute():
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
