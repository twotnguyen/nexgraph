"""Run a subprocess with captured output and no access to the engine's stdin."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from tempfile import TemporaryFile


def run_captured(
    argv: list[str], *, cwd: Path, timeout: float, env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[bytes]:
    if os.name != "nt":
        return subprocess.run(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                              capture_output=True, timeout=timeout)

    # Git for Windows can spawn a child that keeps inherited handles open.
    # With pipes, subprocess.run() kills the wrapper on timeout and then waits
    # for EOF. File handles let that cleanup finish without waiting for the child.
    with TemporaryFile() as stdout, TemporaryFile() as stderr:
        result = subprocess.run(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=stdout, stderr=stderr, timeout=timeout)
        stdout.seek(0)
        stderr.seek(0)
        return subprocess.CompletedProcess(result.args, result.returncode, stdout.read(), stderr.read())
