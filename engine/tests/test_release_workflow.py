"""Test khối shell của job `release` trong .github/workflows/ci.yml (REL-06).

Job `release` chỉ chạy sau `version-check`, nên mọi tag tới được bước tạo Release
đều đã qua `tools/ci/check-version.mjs`: bản cuối `vX.Y.Z` hoặc pre-release
`vX.Y.Z-alpha.N` / `-beta.N` / `-rc.N`. Pre-release luôn có dấu `-`, và bước
release phải thêm `--prerelease` đúng cho các tag đó.

Test trích nguyên khối `run:` từ workflow rồi chạy bằng bash với `gh` giả ghi
lại tham số — không gọi GitHub API. `gh` giả là hàm shell định nghĩa ngay trước
khối `run:` và gọi một script Python bằng đường dẫn tuyệt đối tới
`sys.executable`: không dựa exec bit, shebang hay `PATHEXT`, nên chạy được cả
trên Windows (Git for Windows) lẫn macOS/Linux. Log ghi tương đối theo `cwd`.
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

# `gh` giả: ghi tham số vào gh.log (tương đối theo cwd), trả 1 cho
# `release view` để đi nhánh tạo mới — hoặc 0 khi GH_RELEASE_EXISTS=1.
GH_FAKE = r'''import os
import sys
from pathlib import Path

args = sys.argv[1:]
with Path("gh.log").open("a", encoding="utf-8") as log:
    log.write(" ".join(args) + "\n")
if args[:2] == ["release", "view"]:
    sys.exit(0 if os.environ.get("GH_RELEASE_EXISTS") == "1" else 1)
sys.exit(0)
'''

# Tag phát hành × trạng thái release đã tồn tại: 4 tag × 2 = 8 tổ hợp.
TAGS = [
    ("v0.2.0", False),
    ("v0.2.0-alpha.1", True),
    ("v0.2.0-beta.2", True),
    ("v0.2.0-rc.3", True),
]


def find_bash() -> str | None:
    """Chọn bash thật để chạy khối shell, ưu tiên Git for Windows trên Windows.

    `shutil.which('bash')` trên runner Windows có thể trả `C:\\Windows\\System32\\
    bash.exe` (WSL) — không có distro thì hỏng, nên bỏ qua đường dẫn đó và tìm
    Git Bash trước. Trên macOS/Linux hàm chỉ trả `shutil.which('bash')`.
    """
    candidates: list[Path] = []
    if sys.platform == "win32":
        for variable in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"):
            root = os.environ.get(variable)
            if root:
                candidates.append(Path(root) / "Git" / "bin" / "bash.exe")
                candidates.append(Path(root) / "Git" / "usr" / "bin" / "bash.exe")
    found = shutil.which("bash")
    if found:
        candidates.append(Path(found))
    for candidate in candidates:
        if not candidate.is_file():
            continue
        if candidate.name.lower() == "bash.exe" and "system32" in str(candidate).lower():
            continue  # WSL, không phải Git Bash
        return str(candidate)
    return None


BASH = find_bash()

pytestmark = pytest.mark.skipif(
    BASH is None,
    reason="cần bash (Git for Windows trên Windows, hoặc bash POSIX) để chạy khối shell của workflow",
)


def release_script() -> str:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = workflow["jobs"]["release"]["steps"]
    step = next(s for s in steps if s.get("name") == "Tạo GitHub Release")
    return step["run"]


def run_release(tmp_path: Path, tag: str, *, release_exists: bool) -> list[str]:
    assert BASH is not None  # đã skip ở module nếu không có bash
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "NexGraph.zip").write_text("x", encoding="utf-8")
    fake = tmp_path / "fake_gh.py"
    fake.write_text(GH_FAKE, encoding="utf-8")
    # PATH chỉ còn thư mục rỗng: không thể tìm `gh` thật hay dựa exec bit.
    empty_bin = tmp_path / "empty-bin"
    empty_bin.mkdir()
    python = Path(sys.executable).as_posix()
    script = f'gh() {{\n  "{python}" "{fake.as_posix()}" "$@"\n}}\n' + release_script()
    env = dict(
        os.environ,
        PATH=str(empty_bin),
        GITHUB_REF_NAME=tag,
        GH_RELEASE_EXISTS="1" if release_exists else "0",
    )
    res = subprocess.run(
        [BASH, "--noprofile", "--norc", "-eo", "pipefail", "-c", script],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="strict",
        timeout=60,
    )
    assert res.returncode == 0, res.stdout + res.stderr
    log = tmp_path / "gh.log"
    assert log.is_file(), f"gh giả không được gọi:\n{res.stdout}{res.stderr}"
    return log.read_text(encoding="utf-8").splitlines()


@pytest.mark.parametrize(("tag", "is_prerelease"), TAGS)
@pytest.mark.parametrize("release_exists", [False, True])
def test_release_dung_co_prerelease_theo_tag(tmp_path, tag, is_prerelease, release_exists):
    lines = run_release(tmp_path, tag, release_exists=release_exists)
    created = [line for line in lines if line.startswith("release create")]
    uploads = [line for line in lines if line.startswith("release upload")]
    edits = [line for line in lines if line.startswith("release edit")]
    assert any(line.startswith("release view") for line in lines), lines

    if not release_exists:
        assert len(created) == 1, lines
        assert ("--prerelease" in created[0]) is is_prerelease, created[0]
        assert not uploads and not edits, lines
        return

    assert not created, lines
    assert len(uploads) == 1 and "--clobber" in uploads[0], lines
    if is_prerelease:
        assert len(edits) == 1 and "--prerelease" in edits[0], lines
    else:
        assert not edits, lines
