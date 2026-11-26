import os
import shutil
import subprocess
from pathlib import Path

import pytest

from nexgraph_engine.pipeline.legacy_refresh import refresh_project
from nexgraph_engine.changes.freshness import freshness

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="cần git trong PATH")
GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}


def git(root: Path, *args: str) -> None:
    out = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t.t", "-c", "commit.gpgsign=false", *args],
                         cwd=root, env=GIT_ENV, capture_output=True, text=True, encoding="utf-8")
    assert out.returncode == 0, out.stderr


def commit_all(root: Path) -> None:
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "c")


@pytest.fixture
def git_project(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    git(root, "init", "-q", "-b", "main")
    commit_all(root)
    store, _, _ = index_project(root)
    return store, root


def test_fresh_right_after_index(git_project):
    store, root = git_project
    f = freshness(store, root)
    assert f["stale"] is False and f["changed_files"] == 0 and f["head_commit"] == f["index_commit"]


def test_source_change_is_detected_without_git_metadata(git_project, monkeypatch):
    store, root = git_project
    monkeypatch.setattr("nexgraph_engine.changes.freshness._git_head", lambda _root: None)
    (root / "util.py").write_text("def helper(x):\n    return x + 3\n")
    result = freshness(store, root)
    assert result["head_commit"] is None
    assert result["stale"] and result["changed_files"] == 1


def test_stale_after_edit_and_after_new_commit(git_project):
    store, root = git_project
    (root / "util.py").write_text("def helper(x):\n    return x + 2\n")
    assert freshness(store, root)["stale"] is True and freshness(store, root)["changed_files"] == 1
    commit_all(root)
    f = freshness(store, root)
    assert f["stale"] is True and f["head_commit"] != f["index_commit"]
    refresh_project(store, root)                       # hook post-commit làm đúng việc này
    f = freshness(store, root)
    assert f["stale"] is False and f["head_commit"] == f["index_commit"]


def test_uncommitted_edit_that_the_graph_already_has_is_not_stale(git_project):
    store, root = git_project
    (root / "util.py").write_text("def helper(x):\n    return x + 7\n")
    assert freshness(store, root)["stale"] is True
    refresh_project(store, root)  # app tự refresh khi mở thẻ Thay đổi; Git vẫn báo tệp đổi so với HEAD
    f = freshness(store, root)
    assert f["stale"] is False and f["changed_files"] == 0


def test_commit_without_indexable_changes_clears_stale_after_refresh(git_project):
    store, root = git_project
    (root / "NOTES.txt").write_text("x\n")
    commit_all(root)
    assert freshness(store, root)["stale"] is True
    refresh_project(store, root)
    assert freshness(store, root)["stale"] is False


def test_no_git_uses_baseline(copy_fixture, index_project):
    root = copy_fixture("py_mini")
    store, _, _ = index_project(root)
    assert freshness(store, root) == {**freshness(store, root), "head_commit": None, "stale": False}
    (root / "util.py").write_text("def helper(x):\n    return 0\n")
    assert freshness(store, root)["stale"] is True


def test_reverting_dirty_source_to_head_is_stale(git_project):
    store, root = git_project
    source = root / "util.py"
    original = source.read_text(encoding="utf-8")
    source.write_text("def helper(x):\n    return x + 7\n")
    refresh_project(store, root)
    source.write_text(original)
    assert freshness(store, root)["stale"] is True


def test_recent_edit_with_unchanged_stat_is_still_hashed(copy_fixture, index_project, monkeypatch):
    """Cùng luật với refresh_project: stat không đổi thì tin, trừ khi mtime vừa mới đây (sửa hai lần trong một giây)."""
    root = copy_fixture("py_mini")
    source = root / "util.py"
    # Máy CI chậm lập chỉ mục lâu hơn RACY_SECONDS thật, nên nới ngưỡng để mtime vẫn tính là "vừa mới đây".
    monkeypatch.setattr("nexgraph_engine.changes.freshness.RACY_SECONDS", 3600)
    monkeypatch.setattr("nexgraph_engine.pipeline.legacy_refresh.RACY_SECONDS", 3600)
    source.touch()  # mtime = bây giờ, như tệp vừa lưu ngay trước khi lập chỉ mục
    store, _, _ = index_project(root)
    stat = source.stat()
    original = source.read_text(encoding="utf-8")
    changed = original.replace("+ 1", "+ 2")
    assert len(changed) == len(original)
    source.write_text(changed)
    os.utime(source, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    assert freshness(store, root)["changed_files"] == 1
    assert refresh_project(store, root).changed == 1
    assert freshness(store, root)["stale"] is False


def test_freshness_only_counts_discovered_scope_and_excludes(tmp_path, index_project):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "main.py").write_text("def main():\n    return 1\n")
    (tmp_path / "src" / "ignored.py").write_text("def ignored():\n    return 1\n")
    (tmp_path / "outside.py").write_text("def outside():\n    return 1\n")
    store, _, _ = index_project(tmp_path)
    from nexgraph_engine.pipeline.legacy_indexer import Indexer
    import threading

    Indexer(store, tmp_path, on_progress=lambda event: None, cancel=threading.Event(),
            subdir="src", exclude=["src/ignored.py"]).run()
    (tmp_path / "outside.py").write_text("def outside():\n    return 2\n")
    (tmp_path / "src" / "ignored.py").write_text("def ignored():\n    return 2\n")
    assert freshness(store, tmp_path)["stale"] is False
    (tmp_path / "src" / "main.py").write_text("def main():\n    return 2\n")
    assert freshness(store, tmp_path)["changed_files"] == 1


def test_freshness_counts_indexed_documents_not_unindexed_media(tmp_path, index_project):
    (tmp_path / "main.py").write_text("def main():\n    return 1\n")
    (tmp_path / "notes.md").write_text("initial\n")
    (tmp_path / "audio.mp3").write_bytes(b"initial")
    store, _, _ = index_project(tmp_path)
    from nexgraph_engine.pipeline.legacy_indexer import Indexer
    import threading

    Indexer(store, tmp_path, on_progress=lambda event: None, cancel=threading.Event(), include_docs=True).run()
    (tmp_path / "notes.md").write_text("changed\n")
    (tmp_path / "audio.mp3").write_bytes(b"changed")
    assert freshness(store, tmp_path)["changed_files"] == 1


def test_stats_name_languages_with_generic_support_only(copy_fixture, index_project):
    from nexgraph_engine.api.routes_graph import stats_json
    root = copy_fixture("py_mini")
    (root / "main.go").write_text("package main\n\nfunc main() {}\n")
    store, _, _ = index_project(root)
    assert stats_json(store, root)["generic_languages"] == ["go"]
