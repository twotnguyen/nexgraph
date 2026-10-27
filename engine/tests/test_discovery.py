import os
import sys
import time
from pathlib import Path

import pytest

from nexgraph_engine.index.discovery import discover, is_test_path, language_of, sha256_file


def write(root: Path, rel: str, text: str = "void main() {}\n") -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def rels(root: Path, **kw) -> list[str]:
    return [f.rel_path for f in discover(root, **kw)]


def test_skips_ignored_and_generated(tmp_path):
    for rel in ("build/x.dart", ".dart_tool/y.dart", ".nexgraph/z.dart", "node_modules/m.js", ".git/h.dart",
                "lib/a.g.dart", "lib/b.freezed.dart", "lib/c_generated.dart", "lib/d.pb.dart", "lib/keep.dart"):
        write(tmp_path, rel)
    assert rels(tmp_path) == ["lib/keep.dart"]


def test_respects_gitignore_root_and_nested(tmp_path):
    write(tmp_path, ".gitignore", "secret/\n")
    write(tmp_path, "secret/s.dart")
    write(tmp_path, "lib/.gitignore", "*.tmp.dart\n")
    write(tmp_path, "lib/x.tmp.dart")
    write(tmp_path, "lib/keep.dart")
    write(tmp_path, "other/x.tmp.dart")  # luật của lib/ không áp dụng ngoài lib/
    assert rels(tmp_path) == ["lib/keep.dart", "other/x.tmp.dart"]


def test_nexgraph_dir_ignored(tmp_path):
    write(tmp_path, ".nexgraph/graph.db", "binary")
    write(tmp_path, ".nexgraph/nested/a.dart")
    write(tmp_path, "lib/a.dart")
    assert rels(tmp_path) == ["lib/a.dart"]


def test_symlink_loop_terminates(tmp_path):
    write(tmp_path, "lib/a.dart")
    try:
        os.symlink(tmp_path, tmp_path / "lib" / "loop", target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("không tạo được symlink")
    start = time.time()
    assert rels(tmp_path) == ["lib/a.dart"]
    assert time.time() - start < 5


def test_symlink_outside_not_followed(tmp_path):
    outside = tmp_path / "outside"
    write(outside, "secret.dart")
    root = tmp_path / "proj"
    write(root, "lib/a.dart")
    try:
        os.symlink(outside / "secret.dart", root / "lib" / "leak.dart")
        os.symlink(outside, root / "lib" / "dir", target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("không tạo được symlink")
    assert rels(root) == ["lib/a.dart"]


def test_oversized_flagged(tmp_path):
    write(tmp_path, "lib/big.dart", "a" * 3_000_000)
    write(tmp_path, "lib/small.dart")
    by = {f.rel_path: f for f in discover(tmp_path)}
    assert by["lib/big.dart"].oversized is True and by["lib/small.dart"].oversized is False


def test_rel_path_forward_slash_unicode_and_metadata(tmp_path):
    write(tmp_path, "lib/screens/màn_hình.dart", "abc")
    (f,) = list(discover(tmp_path))
    assert f.rel_path == "lib/screens/màn_hình.dart" and "\\" not in f.rel_path
    assert f.language == "dart" and f.size == 3 and f.mtime > 0 and f.is_test is False


@pytest.mark.skipif(sys.platform == "win32", reason="Windows không cho dấu \\ trong tên tệp")
def test_backslash_in_name_skipped(tmp_path):
    write(tmp_path, "lib/we\\ird.dart")
    write(tmp_path, "lib/ok.dart")
    assert rels(tmp_path) == ["lib/ok.dart"]


def test_languages_and_unknown_extensions(tmp_path):
    for rel in ("a.dart", "a.py", "a.ts", "a.tsx", "a.js", "a.cs", "a.cshtml", "a.json", "a.md", "a.sql", "a.png"):
        write(tmp_path, rel)
    got = {f.rel_path: f.language for f in discover(tmp_path)}
    assert got == {"a.dart": "dart", "a.py": "python", "a.ts": "typescript", "a.tsx": "typescript",
                   "a.js": "javascript", "a.cs": "csharp", "a.cshtml": "csharp"}
    assert language_of("x/y.md") is None


@pytest.mark.parametrize("rel,expected", [
    ("test/a_test.dart", True), ("integration_test/x.dart", True), ("lib/a_test.dart", True),
    ("lib/a.dart", False), ("tests/test_x.py", True), ("pkg/test_x.py", True), ("src/a.test.ts", True),
    ("src/a.spec.ts", True), ("src/__tests__/a.ts", True), ("src/latest.dart", False),
])
def test_is_test_path(rel, expected):
    assert is_test_path(rel) is expected


def test_sha256(tmp_path):
    write(tmp_path, "a.dart", "hello")
    assert sha256_file(tmp_path / "a.dart") == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"


def test_subdir_keeps_rel_paths_from_root(tmp_path):
    write(tmp_path, "lib/a.dart")
    write(tmp_path, "lib/sub/b.dart")
    write(tmp_path, "test/t_test.dart")
    write(tmp_path, "main.dart")
    assert rels(tmp_path, subdir="lib") == ["lib/a.dart", "lib/sub/b.dart"]
    assert rels(tmp_path, subdir="lib/sub") == ["lib/sub/b.dart"]
    assert rels(tmp_path, subdir="nope") == []


def test_parent_gitignore_applies_to_subdir(tmp_path):
    write(tmp_path, ".gitignore", "lib/generated/\n*.skip.dart\n")
    write(tmp_path, "lib/generated/g.dart")
    write(tmp_path, "lib/x.skip.dart")
    write(tmp_path, "lib/keep.dart")
    assert rels(tmp_path, subdir="lib") == ["lib/keep.dart"]
