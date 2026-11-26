"""ENG-extract-killed: cache trích xuất của engine bị dừng cứng không nằm lại trong thư mục tạm."""
import os
import subprocess
import sys

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
