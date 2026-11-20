"""Clone repo GitHub/GitLab vào `<data_dir>/clones/` (thay `graphify clone`, hàm gốc gọi sys.exit nên không dùng lại được)."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
from pathlib import Path
from tempfile import TemporaryFile

_REPO_URL = re.compile(r"https://(github\.com|gitlab\.com)/([A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+)/?")


def parse_repo_url(url: str) -> str:
    """Tên repo của URL `https://github.com/<owner>/<repo>` hoặc `https://gitlab.com/<nhóm>/…/<repo>`; sai thì ValueError."""
    match = _REPO_URL.fullmatch(url.strip())
    if not match:
        raise ValueError("Chỉ nhận URL https://github.com/<chủ>/<repo> hoặc https://gitlab.com/<nhóm>/<repo>")
    host, path = match.groups()
    parts = path.split("/")
    if host == "github.com" and len(parts) != 2:
        raise ValueError("URL GitHub phải có dạng https://github.com/<chủ>/<repo>")
    if any(p.startswith(("-", ".")) for p in parts):
        raise ValueError("Tên chủ hoặc repo không hợp lệ")
    name = parts[-1].removesuffix(".git")
    if not name:
        raise ValueError("Thiếu tên repo")
    return name


def git_remote(url: str) -> str:
    """Địa chỉ đưa cho git; test thay bằng repo cục bộ để không gọi mạng."""
    return url


def clone_repo(url: str, dest: Path, *, depth: int, cancel: threading.Event) -> None:
    """`git clone --depth` có thể huỷ; lỗi hoặc huỷ thì xoá `dest`."""
    git = shutil.which("git")
    if git is None:
        raise RuntimeError("Cần cài git để mở dự án từ URL")
    dest.parent.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}  # repo riêng tư không được treo chờ nhập mật khẩu
    # Tệp tạm thay pipe: Git for Windows có thể để tiến trình con giữ handle (xem subprocesses.run_captured).
    with TemporaryFile() as err:
        proc = subprocess.Popen([git, "clone", "--depth", str(depth), "--", git_remote(url), str(dest)],
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=err, env=env)
        try:
            while proc.poll() is None:
                if cancel.wait(0.2):
                    proc.kill()
                    proc.wait()
                    raise RuntimeError("Đã huỷ")
            if proc.returncode != 0:
                err.seek(0)
                detail = err.read().decode("utf-8", "replace").strip()[-1200:]
                raise RuntimeError(f"git clone thất bại: {detail}")
        except BaseException:
            shutil.rmtree(dest, ignore_errors=True)
            raise
