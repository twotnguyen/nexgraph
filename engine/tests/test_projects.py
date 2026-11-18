import os
import sqlite3
import sys
import time
from pathlib import Path

import pytest

from nexgraph_engine.store.projects import ProjectPathError, ProjectRegistry
from nexgraph_engine.schema.db import open_app_db


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


def test_remove_preserves_cache_for_app_data_projects(tmp_path, registry, monkeypatch):
    root = make_project(tmp_path)
    meta = root.resolve() / ".nexgraph"
    make_dir = Path.mkdir

    def mkdir(path, *args, **kwargs):
        if path == meta:
            raise PermissionError(path)
        return make_dir(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", mkdir)
    first = registry.open_project(root)
    assert first.storage == "app_dir"
    assert registry.remove(first.project_id)
    assert registry.get(first.project_id) is None and registry.list_projects() == []
    assert not registry.remove(first.project_id)
    assert first.graph_db.is_file()
    monkeypatch.undo()
    reopened = registry.open_project(root)
    assert reopened.project_id == first.project_id and reopened.graph_db == first.graph_db


def test_v1_registry_can_be_read_and_upgrades_without_losing_projects(tmp_path, registry):
    registered = registry.open_project(make_project(tmp_path))
    file = registry.app_data_dir / "app.db"
    with sqlite3.connect(file) as conn:
        conn.execute("ALTER TABLE du_an_da_mo DROP COLUMN da_go")
        conn.execute("PRAGMA user_version = 1")
    conn.close()

    legacy = ProjectRegistry(registry.app_data_dir, read_only=True)
    assert legacy.get(registered.project_id) == registered
    assert [info.project_id for info in legacy.list_projects()] == [registered.project_id]

    upgraded = ProjectRegistry(registry.app_data_dir)
    with open_app_db(file, read_only=True) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
    conn.close()
    assert upgraded.remove(registered.project_id)
    assert legacy.list_projects() == []


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


def test_open_project_with_outdated_schema(tmp_path, registry):
    root = make_project(tmp_path, "outdated")
    db_file = root / ".nexgraph" / "graph.db"
    db_file.parent.mkdir()
    conn = sqlite3.connect(db_file)
    conn.execute("CREATE TABLE du_an (ma_du_an TEXT PRIMARY KEY, ten TEXT, co_git INTEGER, phien_ban_schema INTEGER, tao_luc INTEGER)")
    conn.execute("INSERT INTO du_an VALUES ('11111111-2222-3333-4444-555555555555', 'outdated', 0, 1, 0)")
    conn.execute("CREATE TABLE lan_lap_chi_muc (ma_lan INTEGER PRIMARY KEY, ma_du_an TEXT, loai TEXT, trang_thai TEXT, bat_dau_luc INTEGER, ket_thuc_luc INTEGER, so_tep_tong INTEGER, commit_sha TEXT, thu_muc_con TEXT)")
    conn.execute("PRAGMA user_version = 2")
    conn.commit()
    conn.close()

    info = registry.open_project(root)
    assert info.project_id == "11111111-2222-3333-4444-555555555555"
    conn = sqlite3.connect(db_file)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 5
    conn.close()
