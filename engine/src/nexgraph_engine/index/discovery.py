"""Quét thư mục project: chọn tệp mã cần phân tích, bỏ tệp sinh tự động, thư mục build và mọi symlink."""
from __future__ import annotations

import hashlib
import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pathspec

# Thư mục luôn bỏ (spec §5.5); `.nexgraph/` là dữ liệu của chính NexGraph.
SKIP_DIRS = frozenset({".git", ".nexgraph", "build", ".dart_tool", "node_modules"})
GENERATED_SUFFIXES = (".g.dart", ".freezed.dart", ".gr.dart", ".config.dart", ".mocks.dart",
                      "_generated.dart", ".pb.dart")

# Chỉ các ngôn ngữ trong lộ trình (ADR 0006); .json, .sql, .xml... không phải mã cần lập đồ thị.
LANGUAGE_BY_EXT = {
    ".dart": "dart", ".py": "python",
    ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".cs": "csharp", ".cshtml": "csharp", ".razor": "csharp",
}
_TEST_DIRS = frozenset({"test", "tests", "__tests__", "integration_test"})
_TEST_SUFFIXES = ("_test.dart", "_test.py", ".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx",
                  ".test.js", ".spec.js")


@dataclass(frozen=True)
class DiscoveredFile:
    rel_path: str
    language: str
    size: int
    mtime: int
    is_test: bool
    oversized: bool


def language_of(rel_path: str) -> str | None:
    return LANGUAGE_BY_EXT.get(os.path.splitext(rel_path)[1].lower())


def is_test_path(rel_path: str) -> bool:
    parts = rel_path.split("/")
    name = parts[-1]
    return (bool(_TEST_DIRS & set(parts[:-1])) or name.endswith(_TEST_SUFFIXES)
            or (name.startswith("test_") and name.endswith(".py")))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load_ignore(directory: Path) -> pathspec.PathSpec | None:
    gi = directory / ".gitignore"
    try:
        lines = gi.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None
    return pathspec.PathSpec.from_lines("gitignore", lines)


def _ignored(rel: str, rules: list[tuple[str, pathspec.PathSpec]]) -> bool:
    for base, spec in rules:
        sub = rel[len(base) + 1:] if base else rel
        if spec.match_file(sub):
            return True
    return False


def discover(root: Path, *, max_file_bytes: int = 2_000_000, subdir: str | None = None) -> Iterator[DiscoveredFile]:
    root = Path(root)
    found: list[DiscoveredFile] = []

    def inside(rel_dir: str) -> bool:
        return subdir is None or rel_dir == subdir or rel_dir.startswith(subdir + "/")

    def on_path_to_subdir(rel_dir: str) -> bool:
        return subdir is not None and subdir.startswith(rel_dir + "/")

    def walk(directory: Path, rel_dir: str, rules: list[tuple[str, pathspec.PathSpec]]) -> None:
        spec = _load_ignore(directory)
        if spec is not None:
            rules = [*rules, (rel_dir, spec)]
        try:
            entries = sorted(os.scandir(directory), key=lambda e: e.name)
        except OSError:
            return
        for entry in entries:
            if entry.is_symlink() or "\\" in entry.name:
                continue  # không theo symlink (tránh vòng lặp và đọc ngoài project); tên có \ vi phạm RB3
            rel = f"{rel_dir}/{entry.name}" if rel_dir else entry.name
            if entry.is_dir(follow_symlinks=False):
                if entry.name in SKIP_DIRS or _ignored(rel + "/", rules):
                    continue
                if inside(rel) or on_path_to_subdir(rel):  # chỉ đi xuống nhánh dẫn tới thư mục con
                    walk(Path(entry.path), rel, rules)
            elif entry.is_file(follow_symlinks=False):
                language = language_of(entry.name)
                if not inside(rel_dir) or language is None or entry.name.endswith(GENERATED_SUFFIXES) or _ignored(rel, rules):
                    continue
                st = entry.stat(follow_symlinks=False)
                found.append(DiscoveredFile(rel, language, st.st_size, int(st.st_mtime),
                                            is_test_path(rel), st.st_size > max_file_bytes))

    walk(root, "", [])
    yield from sorted(found, key=lambda f: f.rel_path)
