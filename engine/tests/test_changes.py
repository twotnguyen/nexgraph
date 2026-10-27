import hashlib
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from nexgraph_engine.changes import gitdiff
from nexgraph_engine.changes.baseline import baseline_changes
from nexgraph_engine.changes.gitdiff import MAX_FILES, git_changes
from nexgraph_engine.changes.model import read_changes
from nexgraph_engine.index.refresh import refresh_project

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="cần git trong PATH")

GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}


def git(root: Path, *args: str) -> str:
    out = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t.t", "-c", "commit.gpgsign=false",
                          "-c", "core.quotepath=off", *args], cwd=root, env=GIT_ENV, capture_output=True,
                         text=True, encoding="utf-8")
    assert out.returncode == 0, out.stderr
    return out.stdout


def write(root: Path, rel: str, text: str | bytes) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(text if isinstance(text, bytes) else text.encode("utf-8"))


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "Đồ án" / "repo x"
    root.mkdir(parents=True)
    git(root, "init", "-q", "-b", "main")
    write(root, "lib/a.dart", "void a() {}\nvoid b() {}\nvoid c() {}\n")
    write(root, "lib/b.dart", "void d() {}\n")
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "init")
    return root


def by_path(cs):
    return {f.path: f for f in cs.files}


def test_modified_file_hunks(repo):
    write(repo, "lib/a.dart", "void a() {}\nvoid B() {}\nvoid c() {}\nvoid e() {}\n")
    cs = git_changes(repo)
    assert cs.base == "git_head" and len(cs.base_commit) == 40
    f = by_path(cs)["lib/a.dart"]
    assert f.status == "M" and f.ranges == [(2, 2), (4, 4)]


def test_pure_deletion_hunk(repo):
    write(repo, "lib/a.dart", "void a() {}\nvoid c() {}\n")  # xoá dòng 2
    f = by_path(git_changes(repo))["lib/a.dart"]
    assert f.ranges == [(1, 2)]
    write(repo, "lib/a.dart", "")  # xoá hết nội dung
    f = by_path(git_changes(repo))["lib/a.dart"]
    assert f.status == "M" and f.ranges and all(a >= 1 and b >= a for a, b in f.ranges)


def test_unicode_and_space_paths(repo):
    write(repo, "lib/màn hình/đăng nhập.dart", "void x() {}\n")
    write(repo, "lib/a b.dart", "void y() {}\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "more")
    write(repo, "lib/màn hình/đăng nhập.dart", "void x() {}\nvoid x2() {}\n")
    write(repo, "lib/a b.dart", "void z() {}\n")
    got = by_path(git_changes(repo))
    assert got["lib/màn hình/đăng nhập.dart"].ranges == [(2, 2)]
    assert got["lib/a b.dart"].ranges == [(1, 1)]


def test_rename_delete_untracked(repo):
    git(repo, "mv", "lib/b.dart", "lib/c.dart")
    (repo / "lib/a.dart").unlink()
    write(repo, "lib/new.dart", "void n() {}\n")
    write(repo, "lib/staged.dart", "void s() {}\n")
    git(repo, "add", "lib/staged.dart")
    got = by_path(git_changes(repo))
    assert (got["lib/c.dart"].status, got["lib/c.dart"].old_path) == ("R", "lib/b.dart")
    assert got["lib/a.dart"].status == "D" and got["lib/a.dart"].ranges is None
    assert got["lib/new.dart"].status == "A" and got["lib/new.dart"].ranges is None
    assert got["lib/staged.dart"].status == "A"


def test_binary_and_unknown_extensions_skipped(repo):
    write(repo, "assets/logo.png", b"\x89PNG\x00\x01\x02")
    write(repo, "README.md", "hi\n")
    write(repo, "lib/data.json", "{}")
    write(repo, "lib/a.g.dart", "// generated\n")
    write(repo, "build/x.dart", "void x() {}\n")
    assert git_changes(repo).files == []


def test_crlf_file_line_numbers(repo):
    write(repo, "lib/crlf.dart", b"void a() {}\r\nvoid b() {}\r\nvoid c() {}\r\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "crlf")
    write(repo, "lib/crlf.dart", b"void a() {}\r\nvoid B() {}\r\nvoid c() {}\r\n")
    assert by_path(git_changes(repo))["lib/crlf.dart"].ranges == [(2, 2)]


def test_no_commit_falls_back(tmp_path):
    root = tmp_path / "fresh"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    write(root, "lib/a.dart", "void a() {}\n")
    assert git_changes(root) is None


def test_git_missing_falls_back(repo, monkeypatch):
    monkeypatch.setenv("PATH", "")
    assert git_changes(repo) is None


def test_not_a_repo_falls_back(tmp_path):
    root = tmp_path / "plain"
    write(root, "lib/a.dart", "void a() {}\n")
    assert git_changes(root) is None


def snapshot(d: Path) -> dict[str, str]:
    return {str(p.relative_to(d)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(d.rglob("*")) if p.is_file()}


def test_git_directory_is_byte_identical(repo):
    write(repo, "lib/a.dart", "void a() {}\nvoid B() {}\n")
    write(repo, "lib/new.dart", "void n() {}\n")
    os.utime(repo / "lib/a.dart", (1, 1))  # stat khác index: git status thường ghi lại index
    before = snapshot(repo / ".git")
    git_changes(repo)
    assert snapshot(repo / ".git") == before


def test_truncates_over_max_files(repo, monkeypatch):
    monkeypatch.setattr(gitdiff, "MAX_FILES", 3)
    for i in range(6):
        write(repo, f"lib/n{i}.dart", f"void n{i}() {{}}\n")
    cs = git_changes(repo)
    assert len(cs.files) == 3 and cs.truncated
    assert MAX_FILES == 500


# --- chế độ không Git / không có commit -------------------------------------------------------
def test_baseline_changes_via_hashes(tmp_path, index_project):
    root = tmp_path / "plain"
    write(root, "lib/a.dart", "void a() {}\n")
    write(root, "lib/b.dart", "void b() {}\n")
    store, _, _ = index_project(root)
    assert baseline_changes(store).files == []
    write(root, "lib/a.dart", "void a2() {}\n")
    write(root, "lib/c.dart", "void c() {}\n")
    (root / "lib/b.dart").unlink()
    refresh_project(store, root)  # tăng dần không đổi mốc
    cs = baseline_changes(store)
    got = by_path(cs)
    assert cs.base == "last_index" and cs.note.startswith("Không có Git")
    assert {p: f.status for p, f in got.items()} == {"lib/a.dart": "M", "lib/c.dart": "A", "lib/b.dart": "D"}
    assert all(f.ranges is None for f in cs.files)


def test_read_changes_reasons(tmp_path, index_project, monkeypatch):
    root = tmp_path / "fresh"
    root.mkdir()
    git(root, "init", "-q", "-b", "main")
    write(root, "lib/a.dart", "void a() {}\n")
    store, _, _ = index_project(root)
    cs = read_changes(root, store)
    assert cs.base == "last_index" and cs.note.startswith("Repo Git chưa có commit")
    monkeypatch.setenv("PATH", "")
    assert read_changes(root, store).note.startswith("Không có Git")
    plain = tmp_path / "plain"
    write(plain, "lib/a.dart", "void a() {}\n")
    store2, _, _ = index_project(plain)
    assert read_changes(plain, store2).note.startswith("Không có Git")


def test_read_changes_prefers_git(repo, index_project):
    store, _, _ = index_project(repo)
    write(repo, "lib/a.dart", "void a() {}\nvoid B() {}\nvoid c() {}\n")
    assert read_changes(repo, store).base == "git_head"
