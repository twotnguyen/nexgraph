import os
import sys
from pathlib import Path

import pytest

from nexgraph_engine.index import scan
from nexgraph_engine.index.discovery import discover
from nexgraph_engine.index.scan import ScanInfo, resolve_subdir, scan_project
from nexgraph_engine.store.projects import ProjectPathError


def write(root: Path, rel: str, text: str = "x") -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def test_scan_counts_languages_and_top_dirs(copy_fixture):
    root = copy_fixture("bookstore_app")
    info = scan_project(root)
    assert isinstance(info, ScanInfo)
    assert info.files == len(list(discover(root))) == 9
    assert info.by_language == {"dart": 9} and info.large is False
    dirs = dict(info.top_dirs)
    assert info.top_dirs[0] == ("lib", 8) and info.top_dirs[1] == ("lib/services", 2)
    assert dirs["test"] == 1 and {"lib/models", "lib/screens", "lib/widgets"} <= set(dirs)
    assert [c for _, c in info.top_dirs] == sorted((c for _, c in info.top_dirs), reverse=True)


def test_scan_multi_language(copy_fixture):
    info = scan_project(copy_fixture("py_mini"))
    assert info.by_language == {"python": 3}


def test_large_flag_follows_threshold(copy_fixture, monkeypatch):
    root = copy_fixture("bookstore_app")
    assert scan_project(root).large is False
    monkeypatch.setattr(scan, "LARGE_FILE_COUNT", 2)
    assert scan_project(root).large is True


def test_scan_limits_top_dirs_to_twenty(tmp_path):
    for i in range(30):
        write(tmp_path, f"pkg{i:02d}/a.dart")
    assert len(scan_project(tmp_path).top_dirs) == 20


def test_scan_empty_project(tmp_path):
    info = scan_project(tmp_path)
    assert (info.files, info.by_language, info.top_dirs, info.large) == (0, {}, [], False)


def test_subdir_rejects_escape_and_missing(tmp_path):
    root = tmp_path / "proj"
    write(root, "lib/a.dart")
    write(root, "lib/file.txt")
    outside = tmp_path / "outside"
    outside.mkdir()
    bad = ["", "  ", "..", "../x", "/etc", "lib/../..", "nope", "lib/file.txt", "C:\\Windows", "lib\\x"]
    for s in bad:
        with pytest.raises(ProjectPathError):
            resolve_subdir(root, s)
    if sys.platform != "win32":
        os.symlink(outside, root / "lib" / "leak", target_is_directory=True)
        with pytest.raises(ProjectPathError):
            resolve_subdir(root, "lib/leak")
    assert resolve_subdir(root, "lib") == "lib" and resolve_subdir(root, "./lib/") == "lib"
