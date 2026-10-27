"""Plugin pytest: bỏ qua các lỗi đã biết của test upstream Graphify (KNOWN_FAILURES.txt).

Không sửa tests/conftest.py của bản chép. Nạp bằng `-p conftest_known`.
Dòng kết thúc bằng .py: bỏ qua cả module lúc thu thập. Dòng khác: node id, gắn skip.
"""
from pathlib import Path

import pytest

_FILE = Path(__file__).with_name("KNOWN_FAILURES.txt")


def _entries() -> list[str]:
    out = []
    for raw in _FILE.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            out.append(line)
    return out


_MODULES = {e for e in _entries() if e.endswith(".py")}
_NODES = {e for e in _entries() if not e.endswith(".py")}


def pytest_ignore_collect(collection_path, config):
    rel = Path(collection_path).relative_to(Path(__file__).parent).as_posix()
    return True if rel in _MODULES else None


def pytest_collection_modifyitems(items):
    skip = pytest.mark.skip(reason="known upstream failure")
    for item in items:
        if item.nodeid in _NODES:
            item.add_marker(skip)
