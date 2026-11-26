"""ENG-extract-killed: cache trích xuất của engine bị dừng cứng không nằm lại trong thư mục tạm."""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from nexgraph_engine.index import generic
from nexgraph_engine.subprocesses import pid_alive


def _dead_pid() -> int:
    p = subprocess.Popen([sys.executable, "-I", "-c", "pass"])
    p.wait(timeout=60)
    return p.pid


def test_pid_alive_without_killing():
    """Trên Windows `os.kill(pid, 0)` là TerminateProcess, nên không được dùng để hỏi tiến trình còn sống."""
    assert pid_alive(os.getpid())
    assert pid_alive(os.getpid())  # hỏi lần hai: tiến trình vẫn còn
    assert not pid_alive(_dead_pid())
    assert not pid_alive(0)


def _wait_dead(pid: int) -> None:
    deadline = time.monotonic() + 10
    while pid_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not pid_alive(pid)


def test_cache_of_hard_killed_engine_is_removed_by_next_process(watched_tmp, monkeypatch):
    """Engine bị dừng cứng (taskkill /F khi thoát app trên Windows, SIGKILL khi quá hạn, crash) không chạy
    `atexit`, nên cache trích xuất bị bỏ lại; tiến trình engine kế tiếp phải dọn nó."""
    code = ("import os, time; from nexgraph_engine.index.generic import _cache_root; "
            "print(os.getpid(), _cache_root(), flush=True); time.sleep(120)")
    p = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True, encoding="utf-8")
    try:
        pid_text, path = p.stdout.readline().split(maxsplit=1)
        pid, orphan = int(pid_text), Path(path.strip())
        os.kill(pid, getattr(signal, "SIGKILL", signal.SIGTERM))  # Windows: SIGTERM là TerminateProcess
    finally:
        p.kill()
        p.wait(timeout=60)  # thu dọn tiến trình con (POSIX: không để zombie)
    _wait_dead(pid)
    assert orphan.is_dir()  # đúng tình huống: atexit không chạy

    monkeypatch.setattr(generic, "_cache_dir", None)
    root = generic._cache_root()
    try:
        assert not orphan.exists()
        assert root.name.startswith(f"nexgraph-extract-{os.getpid()}-")
    finally:
        generic.reset_cache_root()


def test_sweep_keeps_caches_of_live_processes_and_recent_legacy(watched_tmp, monkeypatch):
    dead = watched_tmp / f"nexgraph-extract-{_dead_pid()}-mocoi"
    live = watched_tmp / f"nexgraph-extract-{os.getppid()}-dangchay"
    legacy_old = watched_tmp / "nexgraph-extract-cu8kytu"     # tên kiểu cũ (không pid), lâu không đổi
    legacy_new = watched_tmp / "nexgraph-extract-moi3xq9z"    # tên kiểu cũ, vừa dùng: có thể của engine bản cũ đang chạy
    other = watched_tmp / "khac-cua-app-khac"
    for d in (dead, live, legacy_old, legacy_new, other):
        (d / "ast").mkdir(parents=True)
    two_days_ago = time.time() - 2 * 24 * 3600
    os.utime(legacy_old, (two_days_ago, two_days_ago))

    monkeypatch.setattr(generic, "_cache_dir", None)
    root = generic._cache_root()
    try:
        left = {p.name for p in watched_tmp.iterdir()} - {root.name}
        assert left == {live.name, legacy_new.name, other.name}
    finally:
        generic.reset_cache_root()
