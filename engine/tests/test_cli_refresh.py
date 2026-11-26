import json
import os
import shutil
import subprocess
import sys

import pytest

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="cần git trong PATH")


def _cli(*args):
    return subprocess.run([sys.executable, "-m", "nexgraph_engine.cli", "refresh", *args], capture_output=True, text=True, encoding="utf-8",
                          env={**os.environ, "PYTHONIOENCODING": "utf-8"})


def test_refresh_after_edit_reports_change(api, copy_fixture, tmp_path):
    root = copy_fixture("py_mini")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    (root / "util.py").write_text("def helper(x):\n    return x * 3\n")
    r = _cli("--project", str(root), "--data-dir", str(tmp_path / "appdata"))
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["status"] == "ok" and out["changed"] == 1
    assert json.loads(_cli("--project", str(root), "--data-dir", str(tmp_path / "appdata")).stdout)["changed"] == 0


def test_refresh_unindexed_project_exits_3(api, copy_fixture, tmp_path):
    root = copy_fixture("py_mini")
    r = _cli("--project", str(root), "--data-dir", str(tmp_path / "appdata"))
    assert r.returncode == 3 and "chưa được lập chỉ mục" in r.stderr


# --- W4: luật bỏ qua, log, timeout ---

def _git(root, *args):
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, text=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                        "GIT_COMMITTER_EMAIL": "t@t"})


def _indexed_repo(api, copy_fixture):
    root = copy_fixture("py_mini")
    (root / ".gitignore").write_text(".nexgraph/\n")
    _git(root, "init", "-q", "-b", "main")
    _git(root, "add", "-A")
    _git(root, "commit", "-qm", "init")
    assert api.index(api.open(root)["project_id"])["state"] == "done"
    return root


def _refresh_json(root, appdata, *extra, env=None):
    r = subprocess.run([sys.executable, "-m", "nexgraph_engine.cli", "refresh", "--project", str(root), "--data-dir", str(appdata), *extra],
                       capture_output=True, text=True, encoding="utf-8", env={**os.environ, "PYTHONIOENCODING": "utf-8", **(env or {})})
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def _log(appdata):
    lines = (appdata / "logs" / "refresh.log").read_text(encoding="utf-8").splitlines()
    return [(line.split(" ", 2)[1], json.loads(line.split(" ", 2)[2])) for line in lines]


def test_refresh_skips_and_logs(api, copy_fixture, tmp_path):
    root, appdata = _indexed_repo(api, copy_fixture), tmp_path / "appdata"
    assert _refresh_json(root, appdata, env={"NEXGRAPH_SKIP_HOOK": "1"})["reason"] == "skip_env"
    assert _refresh_json(root, appdata, "--hook", "post-rewrite", "amend")["reason"] == "amend"
    assert _refresh_json(root, appdata, "--hook", "post-checkout", "a" * 40, "b" * 40, "0")["reason"] == "no_branch_switch"
    assert _refresh_json(root, appdata, "--hook", "post-checkout", "a" * 40, "a" * 40, "1")["reason"] == "no_branch_switch"
    (root / ".git" / "rebase-merge").mkdir()
    assert _refresh_json(root, appdata)["reason"] == "rebase"
    assert _refresh_json(root, appdata, "--hook", "post-commit")["reason"] == "rebase"
    # git vẫn giữ rebase-merge/ khi post-rewrite chạy, nên post-rewrite không được bỏ qua vì nó
    assert _refresh_json(root, appdata, "--hook", "post-rewrite", "rebase")["status"] == "ok"
    (root / ".git" / "rebase-merge").rmdir()
    (root / ".git" / "MERGE_HEAD").write_text("x\n")
    assert _refresh_json(root, appdata, "--hook", "post-commit")["reason"] == "merge"
    assert _refresh_json(root, appdata, "--hook", "post-merge", "0")["status"] == "ok"
    (root / ".git" / "MERGE_HEAD").unlink()
    (root / ".git" / "CHERRY_PICK_HEAD").write_text("x\n")
    assert _refresh_json(root, appdata, "--hook", "post-checkout", "a" * 40, "b" * 40, "1")["reason"] == "cherry_pick"
    log = _log(appdata)
    assert log[0] == ("manual", {"status": "skipped", "reason": "skip_env", "added": 0, "changed": 0, "removed": 0, "seconds": 0.0})
    assert [h for h, _ in log][-3:] == ["post-commit", "post-merge", "post-checkout"]


def test_refresh_linked_worktree_reads_its_own_git_dir(api, copy_fixture, tmp_path):
    main = _indexed_repo(api, copy_fixture)
    wt = tmp_path / "wt"
    _git(main, "worktree", "add", "-q", str(wt))
    assert (wt / ".git").is_file()
    assert api.index(api.open(wt)["project_id"])["state"] == "done"
    gitdir = main / ".git" / "worktrees" / "wt"
    (gitdir / "rebase-apply").mkdir()
    assert _refresh_json(wt, tmp_path / "appdata")["reason"] == "rebase"
    assert _refresh_json(main, tmp_path / "appdata")["status"] == "ok"


def test_refresh_timeout_exits_124_and_logs(api, copy_fixture, tmp_path):
    root, appdata = _indexed_repo(api, copy_fixture), tmp_path / "appdata"
    code = ("import time, nexgraph_engine.pipeline.legacy_refresh as r; r.refresh_project = lambda *a, **k: time.sleep(30); "
            "from nexgraph_engine.cli import main; raise SystemExit(main(['refresh', '--project', %r, '--data-dir', %r]))"
            % (str(root), str(appdata)))
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=20,
                       env={**os.environ, "NEXGRAPH_REFRESH_TIMEOUT": "1"})
    assert r.returncode == 124
    assert _log(appdata)[-1][1]["status"] == "timeout"


@pytest.mark.skipif(sys.platform == "win32", reason="hook shell ghi tay dùng đường dẫn POSIX")
def test_real_git_hooks_merge_rebase_cherry_pick(api, copy_fixture, tmp_path):
    root, appdata = _indexed_repo(api, copy_fixture), tmp_path / "appdata"
    for name in ("post-commit", "post-checkout", "post-merge", "post-rewrite"):
        hook = root / ".git" / "hooks" / name
        hook.write_text(f"#!/bin/sh\n'{sys.executable}' -m nexgraph_engine.cli refresh --project '{root}' --data-dir '{appdata}' "
                        f"--hook {name} \"$@\" </dev/null >/dev/null 2>&1\n")
        hook.chmod(0o755)

    def run(*args):
        n = len(_log(appdata)) if (appdata / "logs" / "refresh.log").exists() else 0
        _git(root, *args)
        return _log(appdata)[n:]

    def edit(name, body):
        (root / name).write_text(body)
        _git(root, "commit", "-qam", f"edit {name} {body[:10]}")

    assert [r["reason"] for _, r in run("checkout", "-qb", "side")] == ["no_branch_switch"]  # HEAD không đổi
    edit("util.py", "def helper(x):\n    return x * 3\n")
    run("checkout", "-q", "main")
    edit("main.py", "print(1)\n")
    got = run("merge", "-q", "--no-edit", "side")
    assert got and got[-1][0] == "post-merge" and got[-1][1]["status"] == "ok", got

    run("checkout", "-qb", "topic", "HEAD~2")
    (root / "extra.py").write_text("def extra():\n    return 1\n")
    _git(root, "add", "extra.py")
    _git(root, "commit", "-qm", "extra")
    got = run("rebase", "-q", "main")
    assert got[-1][0] == "post-rewrite" and got[-1][1]["status"] == "ok", got
    assert all(r["status"] == "skipped" for h, r in got if h == "post-commit"), got

    run("checkout", "-q", "main")
    run("checkout", "-qb", "src")
    for name in ("a", "b"):
        (root / f"{name}.py").write_text(f"def {name}():\n    return 1\n")
        _git(root, "add", f"{name}.py")
        _git(root, "commit", "-qm", f"add {name}")
    run("checkout", "-q", "main")
    got = run("cherry-pick", "main..src")
    commits = [r for h, r in got if h == "post-commit"]
    assert [r.get("reason") for r in commits] == ["cherry_pick", None], got
    assert commits[-1]["status"] == "ok"


# --- W4 review: trạng thái chụp trong hook, chờ khoá, timeout sai ---

def test_refresh_uses_git_state_snapshot_from_hook(api, copy_fixture, tmp_path):
    """Hook chụp trạng thái git đồng bộ (NEXGRAPH_GIT_STATE…) trước khi chạy nền; CLI tin bản chụp, không đọc đĩa muộn."""
    root, appdata = _indexed_repo(api, copy_fixture), tmp_path / "appdata"
    snap = {"NEXGRAPH_GIT_STATE": " CHERRY_PICK_HEAD", "NEXGRAPH_SEQ_TODO": "", "NEXGRAPH_HEAD_SUBJECT": ""}
    assert _refresh_json(root, appdata, "--hook", "post-checkout", "a" * 40, "b" * 40, "1", env=snap)["reason"] == "cherry_pick"
    (root / ".git" / "rebase-merge").mkdir()  # git đã đi tiếp; bản chụp lúc hook chạy là sạch
    assert _refresh_json(root, appdata, "--hook", "post-commit", env={**snap, "NEXGRAPH_GIT_STATE": ""})["status"] == "ok"
    (root / ".git" / "rebase-merge").rmdir()
    seq = {**snap, "NEXGRAPH_GIT_STATE": " CHERRY_PICK_HEAD", "NEXGRAPH_SEQ_TODO": "pick abc add a\npick def add b",
           "NEXGRAPH_HEAD_SUBJECT": "add a"}
    assert _refresh_json(root, appdata, "--hook", "post-commit", env=seq)["reason"] == "cherry_pick"
    assert _refresh_json(root, appdata, "--hook", "post-commit", env={**seq, "NEXGRAPH_HEAD_SUBJECT": "other"})["status"] == "ok"


def test_hook_refresh_waits_for_busy_writer_instead_of_skipping(api, copy_fixture, tmp_path):
    import threading
    import time

    from nexgraph_engine.mcp.server import resolve_graph_db
    from nexgraph_engine.store.publication import graph_writer

    root, appdata = _indexed_repo(api, copy_fixture), tmp_path / "appdata"
    db = resolve_graph_db(root, appdata)
    held, release = threading.Event(), threading.Event()

    def hold():
        with graph_writer(db):
            held.set()
            release.wait(10)

    t = threading.Thread(target=hold)
    t.start()
    held.wait(5)
    try:
        assert _refresh_json(root, appdata)["reason"] == "index_running"  # chạy tay: vẫn bỏ qua ngay
        threading.Timer(2.0, release.set).start()
        started = time.monotonic()
        out = _refresh_json(root, appdata, "--hook", "post-commit")
        assert out["status"] == "ok" and time.monotonic() - started >= 1.5
    finally:
        release.set()
        t.join()


def test_invalid_refresh_timeout_falls_back_to_default(api, copy_fixture, tmp_path):
    root, appdata = _indexed_repo(api, copy_fixture), tmp_path / "appdata"
    assert _refresh_json(root, appdata, env={"NEXGRAPH_REFRESH_TIMEOUT": "10s"})["status"] == "ok"


def test_killed_refresh_does_not_block_later_refreshes(api, copy_fixture, tmp_path):
    from contextlib import closing

    from nexgraph_engine.mcp.server import resolve_graph_db
    from nexgraph_engine.schema.db import open_graph_db
    from nexgraph_engine.store.graph_store import GraphStore

    root, appdata = _indexed_repo(api, copy_fixture), tmp_path / "appdata"
    with closing(open_graph_db(resolve_graph_db(root, appdata))) as conn:
        GraphStore(conn).begin_run(files_total=1, kind="tang_dan")  # lần refresh bị kill giữa chừng (os._exit)
        conn.commit()
    (root / "extra.py").write_text("def extra():\n    return 1\n", encoding="utf-8")
    out = _refresh_json(root, appdata)
    assert out["status"] == "ok" and out["added"] == 1
    pid = api.open(root)["project_id"]
    (root / "extra2.py").write_text("def extra2():\n    return 2\n", encoding="utf-8")
    with closing(open_graph_db(resolve_graph_db(root, appdata))) as conn:
        GraphStore(conn).begin_run(files_total=1, kind="tang_dan")
        conn.commit()
    r = api.post(f"/v1/projects/{pid}/refresh")
    assert r.status_code == 200 and r.json()["added"] == 1
