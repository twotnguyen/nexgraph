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


def pid_alive(pid: int) -> bool:
    """Tiến trình `pid` còn sống không, mà không gửi tín hiệu nào tới nó.

    Không dùng `os.kill(pid, 0)` trên Windows: ở đó mọi tín hiệu ngoài CTRL_* là TerminateProcess. Không chắc
    (không đọc được mã thoát) thì coi là còn sống, vì người gọi dùng kết quả để quyết định có xoá dữ liệu không.
    """
    if pid <= 0:
        return False
    if os.name != "nt":
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True  # tiến trình của người dùng khác
        except OSError:
            return False
        return True

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    kernel32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
    kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
    handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return ctypes.get_last_error() == 5  # ERROR_ACCESS_DENIED: có tiến trình nhưng không được mở
    try:
        code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return True
        return code.value == 259  # STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)
