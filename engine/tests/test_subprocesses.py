import subprocess
import sys
import time

import pytest

from nexgraph_engine.core.subprocesses import run_captured


def test_captures_output_and_does_not_inherit_stdin(tmp_path):
    script = (
        "import sys; assert sys.stdin.buffer.read() == b''; "
        "sys.stdout.buffer.write(b'left\\x00right'); "
        "sys.stderr.buffer.write(b'error'); sys.exit(7)"
    )
    result = run_captured([sys.executable, "-c", script], cwd=tmp_path, timeout=5)
    assert result.returncode == 7
    assert result.stdout == b"left\x00right"
    assert result.stderr == b"error"


@pytest.mark.skipif(sys.platform != "win32", reason="Windows subprocess timeout cleanup")
def test_timeout_does_not_wait_for_child_with_inherited_output(tmp_path):
    ready = tmp_path / "child-ready"
    release = tmp_path / "release-child"
    child = """
from pathlib import Path
import sys
import time

Path(sys.argv[1]).touch()
release = Path(sys.argv[2])
deadline = time.monotonic() + 8
while not release.exists() and time.monotonic() < deadline:
    time.sleep(0.05)
"""
    wrapper = """
import subprocess
import sys
import time

subprocess.Popen([sys.executable, "-c", *sys.argv[1:]], stdout=sys.stdout, stderr=sys.stderr)
time.sleep(15)
"""
    started = time.monotonic()
    try:
        with pytest.raises(subprocess.TimeoutExpired):
            run_captured([sys.executable, "-c", wrapper, child, str(ready), str(release)],
                         cwd=tmp_path, timeout=2)
        assert ready.exists(), "The wrapper did not start its child before timeout"
        assert time.monotonic() - started < 6, "Timeout waited for the child to close its output"
    finally:
        release.touch()
