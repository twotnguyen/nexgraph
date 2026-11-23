"""Test khối shell của job `release` trong .github/workflows/ci.yml (REL-06).

Job `release` chỉ chạy sau `version-check`, nên mọi tag tới được bước tạo Release
đều đã qua `scripts/ci/check-version.mjs`: bản cuối `vX.Y.Z` hoặc pre-release
`vX.Y.Z-alpha.N` / `-beta.N` / `-rc.N`. Pre-release luôn có dấu `-`, và bước
release phải thêm `--prerelease` đúng cho các tag đó.

Test trích nguyên khối `run:` từ workflow rồi chạy bằng bash với `gh` giả ghi
lại tham số — không gọi GitHub API.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
BASH = shutil.which("bash") or "bash"

pytestmark = [
    pytest.mark.skipif(
        shutil.which("bash") is None, reason="cần bash để chạy khối shell của workflow"
    ),
    # Job release chạy trên ubuntu-latest; Git Bash/WSL trên Windows không đại diện
    # cho runner đó và cách MSYS xử lý exec bit của `gh` giả khác POSIX.
    pytest.mark.skipif(sys.platform == "win32", reason="khối release chỉ chạy trên ubuntu-latest"),
]


def release_script() -> str:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = workflow["jobs"]["release"]["steps"]
    step = next(s for s in steps if s.get("name") == "Tạo GitHub Release")
    return step["run"]


def run_release(tmp_path: Path, tag: str) -> list[str]:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "NexGraph.zip").write_text("x", encoding="utf-8")
    log = tmp_path / "gh.log"
    bindir = tmp_path / "bin"
    bindir.mkdir()
    gh = bindir / "gh"
    gh.write_text(
        "#!/bin/sh\n"
        'printf \'%s\\n\' "$*" >> "' + str(log) + '"\n'
        'if [ "$1" = "release" ] && [ "$2" = "view" ]; then exit 1; fi\n'
        "exit 0\n",
        encoding="utf-8",
    )
    gh.chmod(0o755)
    env = dict(
        os.environ,
        PATH=str(bindir) + os.pathsep + os.environ.get("PATH", ""),
        GITHUB_REF_NAME=tag,
    )
    res = subprocess.run(
        [BASH, "--noprofile", "--norc", "-eo", "pipefail", "-c", release_script()],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="strict",
        timeout=60,
    )
    assert res.returncode == 0, res.stdout + res.stderr
    return log.read_text(encoding="utf-8").splitlines()


def test_tag_pre_release_tao_release_prerelease(tmp_path):
    lines = run_release(tmp_path, "v0.2.0-alpha.1")
    created = [line for line in lines if line.startswith("release create")]
    assert len(created) == 1, lines
    assert "--prerelease" in created[0]


def test_tag_on_dinh_khong_co_co_prerelease(tmp_path):
    lines = run_release(tmp_path, "v0.2.0")
    created = [line for line in lines if line.startswith("release create")]
    assert len(created) == 1, lines
    assert "--prerelease" not in created[0]
