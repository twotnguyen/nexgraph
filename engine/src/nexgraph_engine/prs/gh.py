"""Lời gọi GitHub CLI duy nhất của engine: chỉ đọc (`pr list|view|diff`, `repo view`), có timeout.

Test thay `run_gh` bằng hàm giả (monkeypatch `nexgraph_engine.prs.gh.run_gh`), nên mọi nơi gọi qua `gh.run_gh(...)`.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from nexgraph_engine.errors import ApiError
from nexgraph_engine.subprocesses import run_captured

TIMEOUT = 30.0
MAX_PR_NUMBER = 1_000_000_000

_HTTP = {"gh_missing": 409, "gh_auth": 409, "not_github": 409, "gh_timeout": 504, "gh_failed": 502, "pr_not_found": 404}
_MESSAGES = {
    "gh_missing": "Chưa cài GitHub CLI (gh)",
    "gh_auth": "GitHub CLI chưa đăng nhập. Chạy: gh auth login",
    "not_github": "Dự án không có remote GitHub",
    "gh_timeout": "GitHub CLI không phản hồi kịp",
    "gh_failed": "GitHub CLI báo lỗi",
    "pr_not_found": "Không tìm thấy pull request",
}


class GhError(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(_MESSAGES[code] + (f": {detail}" if detail else ""))
        self.code = code

    def api_error(self) -> ApiError:
        return ApiError(_HTTP[self.code], self.code, str(self))


def _classify_failure(stderr: str) -> str:
    s = stderr.lower()
    if "gh auth login" in s or "not logged" in s or "authentication" in s or "http 401" in s:
        return "gh_auth"
    if "no git remote" in s or "none of the git remotes" in s or "not a git repository" in s:
        return "not_github"
    if "could not resolve to a pullrequest" in s or "no pull requests found" in s:
        return "pr_not_found"
    return "gh_failed"


def run_gh(root: Path, args: list[str], timeout: float = TIMEOUT) -> str:
    """Chạy `gh <args>` trong thư mục dự án; trả stdout, ném GhError có mã rõ ràng."""
    try:
        out = run_captured(["gh", *args], cwd=Path(root), timeout=timeout)
    except FileNotFoundError:
        raise GhError("gh_missing") from None
    except subprocess.TimeoutExpired:
        raise GhError("gh_timeout") from None
    except (OSError, subprocess.SubprocessError) as exc:
        raise GhError("gh_failed", type(exc).__name__) from None
    if out.returncode != 0:
        stderr = out.stderr.decode("utf-8", "replace")
        raise GhError(_classify_failure(stderr), stderr.strip().splitlines()[-1][:200] if stderr.strip() else "")
    return out.stdout.decode("utf-8", "replace")


def pr_number(value: object) -> int:
    """Số PR là số nguyên dương; chặn trước khi đưa vào argv của gh."""
    if isinstance(value, bool):
        raise ValueError("Số pull request không hợp lệ")
    if isinstance(value, str):
        if not (value.isascii() and value.isdigit()) or len(value) > 10:  # trước int(): không nhận "+7", " 7", "7_0", "²"
            raise ValueError("Số pull request không hợp lệ")
        value = int(value)
    if not isinstance(value, int) or not 1 <= value <= MAX_PR_NUMBER:
        raise ValueError("Số pull request không hợp lệ")
    return value
