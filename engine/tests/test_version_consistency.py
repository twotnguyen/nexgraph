"""Version của gói phải khớp nhau ở bốn tệp phát hành.

Bốn tệp: `package.json` (gốc), `apps/desktop/package.json`,
`engine/pyproject.toml`, `engine/src/nexgraph_engine/__init__.py`
(cộng dòng version của chính gói trong `engine/uv.lock`).
Bản alpha viết theo semver ở package.json (`0.2.0-alpha.1`) và theo PEP 440
ở phía Python (`0.2.0a1`); test quy đổi rồi so.
"""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

from nexgraph_engine import __version__

REPO = Path(__file__).resolve().parents[2]


def _semver_to_pep440(version: str) -> str:
    """`0.2.0-alpha.1` → `0.2.0a1`, `0.2.0-rc.2` → `0.2.0rc2`, `0.2.0` → `0.2.0`."""
    tag = {"alpha": "a", "beta": "b", "rc": "rc"}
    return re.sub(
        r"-(alpha|beta|rc)\.?(\d*)",
        lambda m: tag[m.group(1)] + m.group(2),
        version,
    )


def _pyproject_version(path: Path | None = None) -> str:
    source = path or (REPO / "engine" / "pyproject.toml")
    version = tomllib.loads(source.read_text(encoding="utf-8"))["project"]["version"]
    return str(version)


def _lock_version(path: Path | None = None) -> str:
    source = path or (REPO / "engine" / "uv.lock")
    lock = tomllib.loads(source.read_text(encoding="utf-8"))
    for package in lock.get("package", []):
        if package.get("name") == "nexgraph-engine":
            return str(package["version"])
    raise AssertionError(
        'không thấy khối [[package]] name = "nexgraph-engine" trong uv.lock'
    )


def test_version_khop_o_bon_tep():
    root = json.loads((REPO / "package.json").read_text(encoding="utf-8"))["version"]
    desktop = json.loads(
        (REPO / "apps" / "desktop" / "package.json").read_text(encoding="utf-8")
    )["version"]
    assert desktop == root, f"package.json gốc {root} khác apps/desktop {desktop}"
    assert _pyproject_version() == __version__, (
        f"pyproject.toml {_pyproject_version()} khác __init__ {__version__}"
    )
    assert _semver_to_pep440(desktop) == __version__, (
        f"apps/desktop {desktop} khác __init__ {__version__}"
    )


def test_uv_lock_khop_version_goi():
    assert _lock_version() == _pyproject_version()


PYPROJECT_CO_DONG_VERSION = """
[tool.example]
version = "0.2.0a1"

[project]
name = "nexgraph-engine"
version = "0.2.0a0"
"""


def test_pyproject_doc_dung_bang_project(tmp_path: Path) -> None:
    """`[tool.*].version` đứng trước không được che `[project].version` (Minor review-61)."""
    path = tmp_path / "pyproject.toml"
    path.write_text(PYPROJECT_CO_DONG_VERSION, encoding="utf-8")
    assert _pyproject_version(path) == "0.2.0a0"


UV_LOCK_KHOA_KHONG_THEO_THU_TU = """
[[package]]
version = "0.2.0a1"
name = "nexgraph-engine"
source = { editable = "." }

[[package]]
name = "nexgraph-engine-extra"
version = "9.9.9"
"""


def test_uv_lock_doc_block_theo_ten(tmp_path: Path) -> None:
    """Đọc block `[[package]]` theo tên, không phụ thuộc thứ tự khoá (Minor review-61)."""
    path = tmp_path / "uv.lock"
    path.write_text(UV_LOCK_KHOA_KHONG_THEO_THU_TU, encoding="utf-8")
    assert _lock_version(path) == "0.2.0a1"
