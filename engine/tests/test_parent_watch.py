import os
import subprocess
import sys
import time

TOKEN = "p" * 40


def start(data_dir, *extra):
    env = {**os.environ, "NEXGRAPH_TOKEN": TOKEN}
    return subprocess.Popen(
        [sys.executable, "-m", "nexgraph_engine.cli", "serve", "--data-dir", str(data_dir), "--port", "0", *extra],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
    )


def wait_ready(p):
    for line in p.stdout:
        if '"ready"' in line:
            return


def test_exits_when_stdin_closes_with_flag(tmp_path):
    """Tiến trình cha chết thì stdin đóng: engine phải tự thoát để không mồ côi."""
    p = start(tmp_path, "--exit-on-stdin-close")
    wait_ready(p)
    p.stdin.close()
    assert p.wait(timeout=10) == 0


def test_keeps_running_when_stdin_closes_without_flag(tmp_path):
    p = start(tmp_path)
    try:
        wait_ready(p)
        p.stdin.close()
        time.sleep(1.0)
        assert p.poll() is None
    finally:
        p.kill()
