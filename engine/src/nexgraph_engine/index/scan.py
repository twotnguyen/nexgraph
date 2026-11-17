"""Quét sơ bộ một project trước khi lập chỉ mục: đếm tệp mã để cảnh báo project lớn và gợi ý thư mục con."""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath

from nexgraph_engine.index.discovery import discover
from nexgraph_engine.store.projects import ProjectPathError

LARGE_FILE_COUNT = 5_000  # cận dưới của tầng L (spec §6.1)
MAX_TOP_DIRS = 20


@dataclass(frozen=True)
class ScanInfo:
    files: int
    by_language: dict[str, int]
    top_dirs: list[tuple[str, int]]
    large: bool


def scan_project(root: Path) -> ScanInfo:
    langs: Counter[str] = Counter()
    dirs: Counter[str] = Counter()
    total = 0
    for f in discover(root):
        total += 1
        langs[f.language] += 1
        parts = f.rel_path.split("/")
        if len(parts) >= 2:
            dirs[parts[0]] += 1
        if len(parts) >= 3:
            dirs[f"{parts[0]}/{parts[1]}"] += 1
    top = sorted(dirs.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_TOP_DIRS]
    return ScanInfo(files=total, by_language=dict(langs), top_dirs=top, large=total > LARGE_FILE_COUNT)


def resolve_subdir(root: Path, subdir: str) -> str:
    """Kiểm tra `subdir` là thư mục tương đối nằm trong `root`; trả đường dẫn chuẩn hoá dùng `/`."""
    raw = subdir.strip()
    if not raw or raw.startswith("/") or "\\" in raw or PureWindowsPath(raw).drive:
        raise ProjectPathError(f"Thư mục con không hợp lệ: {subdir!r}")
    parts = [p for p in PurePosixPath(raw).parts if p != "."]
    if not parts or ".." in parts:
        raise ProjectPathError(f"Thư mục con không hợp lệ: {subdir!r}")
    normalized = "/".join(parts)
    try:
        target = (Path(root) / normalized).resolve()
        root_resolved = Path(root).resolve()
    except (ValueError, OSError) as exc:  # NUL byte trong path -> 400 bad_path thay vì 500
        raise ProjectPathError(f"Thư mục con không hợp lệ: {subdir!r} ({exc})") from exc
    if not target.is_dir() or not target.is_relative_to(root_resolved):
        raise ProjectPathError(f"Thư mục con không tồn tại hoặc nằm ngoài dự án: {subdir!r}")
    return normalized
