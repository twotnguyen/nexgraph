import os
import sys
import time
from pathlib import Path

import pytest

from nexgraph_engine.store.projects import ProjectPathError, ProjectRegistry


@pytest.fixture
def registry(tmp_path):
    return ProjectRegistry(tmp_path / "appdata")


def make_project(parent: Path, name="bookstore") -> Path:
    p = parent / name
    (p / "lib").mkdir(parents=True)
    (p / "lib" / "main.dart").write_text("void main() {}\n")
    return p


def test_creates_nexgraph_with_gitignore(tmp_path, registry):
    root = make_project(tmp_path)
    info = registry.open_project(root)
    assert info.storage == "in_project"
    assert info.graph_db == root.resolve() / ".nexgraph" / "graph.db" and info.graph_db.exists()
    assert (root / ".nexgraph" / ".gitignore").read_text(encoding="utf-8") == "*\n"
    assert not (root / ".gitignore").exists()  # không tạo hay sửa .gitignore gốc
    assert len(info.project_id) == 36 and info.name == "bookstore"


def test_unicode_path(tmp_path, registry):
    root = make_project(tmp_path / "Đồ án ứng dụng", "bookstore app")
    info = registry.open_project(root)
    assert info.graph_db.exists()
    assert registry.get(info.project_id).path == root.resolve()


def test_renamed_folder_keeps_id(tmp_path, registry):
    root = make_project(tmp_path, "old_name")
    first = registry.open_project(root)
    renamed = root.rename(tmp_path / "Tên mới")
    second = registry.open_project(renamed)
    assert second.project_id == first.project_id
    listed = registry.list_projects()
    assert len(listed) == 1 and listed[0].path == renamed.resolve()


def test_reopen_same_path_same_id(tmp_path, registry):
    root = make_project(tmp_path)
    assert registry.open_project(root).project_id == registry.open_project(root).project_id


@pytest.mark.skipif(sys.platform == "win32" or (hasattr(os, "geteuid") and os.geteuid() == 0),
                    reason="cần quyền chỉ đọc theo kiểu POSIX và không chạy bằng root")
def test_readonly_falls_back(tmp_path, registry):
    root = make_project(tmp_path)
    root.chmod(0o555)
    try:
        info = registry.open_project(root)
    finally:
        root.chmod(0o755)
    assert info.storage == "app_dir"
    assert tmp_path / "appdata" in info.graph_db.parents and info.graph_db.exists()
    assert not (root / ".nexgraph").exists()
    # mở lại khi thư mục đã ghi được vẫn dùng chỗ lưu cũ, không mất index
    assert registry.open_project(root).graph_db == info.graph_db


def test_not_a_directory_rejected(tmp_path, registry):
    f = tmp_path / "file.txt"
    f.write_text("x")
    with pytest.raises(ProjectPathError):
        registry.open_project(f)
    with pytest.raises(ProjectPathError):
        registry.open_project(tmp_path / "missing")


def test_git_detection(tmp_path, registry):
    plain = make_project(tmp_path, "plain")
    git = make_project(tmp_path, "withgit")
    (git / ".git").mkdir()
    assert registry.open_project(plain).is_git is False
    assert registry.open_project(git).is_git is True
    worktree = make_project(tmp_path, "worktree")
    (worktree / ".git").write_text("gitdir: /elsewhere\n")  # .git là tệp (worktree, submodule)
    assert registry.open_project(worktree).is_git is True


def test_registry_lists_most_recent_first(tmp_path, registry):
    a = registry.open_project(make_project(tmp_path, "a"))
    time.sleep(0.01)
    b = registry.open_project(make_project(tmp_path, "b"))
    assert [p.project_id for p in registry.list_projects()] == [b.project_id, a.project_id]
    time.sleep(0.01)
    registry.open_project(tmp_path / "a")
    assert registry.list_projects()[0].project_id == a.project_id
