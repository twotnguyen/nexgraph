import os
import shutil
import subprocess
from pathlib import Path

import pytest

from nexgraph_engine.index.refresh import refresh_project
from nexgraph_engine.store.freshness import freshness

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="cần git trong PATH")
GIT_ENV = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull}


def git(root: Path, *args: str) -> None:
    out = subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t.t", "-c", "commit.gpgsign=false", *args],
                         cwd=root, env=GIT_ENV, capture_output=True, text=True)
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


def test_stats_name_languages_with_generic_support_only(copy_fixture, index_project):
    from nexgraph_engine.api.routes_graph import stats_json
    root = copy_fixture("py_mini")
    (root / "main.go").write_text("package main\n\nfunc main() {}\n")
    store, _, _ = index_project(root)
    assert stats_json(store, root)["generic_languages"] == ["go"]
