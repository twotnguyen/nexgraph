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


def _pyproject_version() -> str:
    text = (REPO / "engine" / "pyproject.toml").read_text(encoding="utf-8")
    match = re.search(r'^version = "([^"]+)"', text, re.MULTILINE)
    assert match, "không thấy version trong engine/pyproject.toml"
    return match.group(1)


def _lock_version() -> str:
    text = (REPO / "engine" / "uv.lock").read_text(encoding="utf-8")
    match = re.search(
        r'\[\[package\]\]\nname = "nexgraph-engine"\nversion = "([^"]+)"', text
    )
    assert match, 'không thấy khối [[package]] name = "nexgraph-engine" trong uv.lock'
    return match.group(1)


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
