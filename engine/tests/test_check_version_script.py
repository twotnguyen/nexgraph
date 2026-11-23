"""Test cho scripts/ci/check-version.mjs (REL-07).

Script là một phần của job CI `version-check`: so version của tag với 4 nguồn
(root package.json, apps/desktop/package.json, engine/pyproject.toml,
engine/src/nexgraph_engine/__init__.py) và chuẩn hoá pre-release giữa semver
và PEP 440. Test chạy script bằng Node trên cây thư mục tạm.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "ci" / "check-version.mjs"
NODE = shutil.which("node") or "node"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="cần Node.js để chạy scripts/ci/check-version.mjs"
)

SOURCES = (
    "package.json",
    "apps/desktop/package.json",
    "engine/pyproject.toml",
    "engine/src/nexgraph_engine/__init__.py",
)


def make_tree(root: Path, *, npm: str, desktop: str, pyproject: str, engine: str) -> Path:
    """Dựng cây tối thiểu 4 nguồn version dưới root."""
    (root / "apps" / "desktop").mkdir(parents=True)
    (root / "engine" / "src" / "nexgraph_engine").mkdir(parents=True)
    (root / "package.json").write_text(json.dumps({"name": "nexgraph", "version": npm}), encoding="utf-8")
    (root / "apps" / "desktop" / "package.json").write_text(
        json.dumps({"name": "@nexgraph/desktop", "version": desktop}), encoding="utf-8"
    )
    (root / "engine" / "pyproject.toml").write_text(
        '[project]\nname = "nexgraph-engine"\nversion = "' + pyproject + '"\n', encoding="utf-8"
    )
    (root / "engine" / "src" / "nexgraph_engine" / "__init__.py").write_text(
        '__version__ = "' + engine + '"\n', encoding="utf-8"
    )
    return root


def run_check(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [NODE, str(SCRIPT), *args, "--root", str(root)],
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_script_ton_tai():
    assert SCRIPT.is_file(), f"thiếu script {SCRIPT}"


def test_ban_on_dinh_khop_tag(tmp_path):
    root = make_tree(tmp_path, npm="0.1.2", desktop="0.1.2", pyproject="0.1.2", engine="0.1.2")
    res = run_check(root, "v0.1.2")
    assert res.returncode == 0, res.stdout + res.stderr
    assert "OK" in res.stdout


def test_pre_release_alpha_semver_va_pep440_tuong_duong(tmp_path):
    # npm dùng semver 0.2.0-alpha.1, Python dùng PEP 440 0.2.0a1; tag là bản npm.
    root = make_tree(
        tmp_path,
        npm="0.2.0-alpha.1",
        desktop="0.2.0-alpha.1",
        pyproject="0.2.0a1",
        engine="0.2.0a1",
    )
    res = run_check(root, "v0.2.0-alpha.1")
    assert res.returncode == 0, res.stdout + res.stderr


def test_beta_va_rc_chuan_hoa(tmp_path):
    root = make_tree(
        tmp_path, npm="0.2.0-beta.2", desktop="0.2.0-beta.2", pyproject="0.2.0b2", engine="0.2.0b2"
    )
    assert run_check(root, "v0.2.0-beta.2").returncode == 0
    root = make_tree(
        tmp_path / "rc", npm="0.2.0-rc.3", desktop="0.2.0-rc.3", pyproject="0.2.0rc3", engine="0.2.0rc3"
    )
    assert run_check(root, "v0.2.0-rc.3").returncode == 0


def test_lech_mot_nguon_thi_fail_va_neu_ten_tep(tmp_path):
    root = make_tree(
        tmp_path,
        npm="0.2.0-alpha.1",
        desktop="0.2.0-alpha.1",
        pyproject="0.1.2",
        engine="0.2.0a1",
    )
    res = run_check(root, "v0.2.0-alpha.1")
    assert res.returncode != 0
    out = res.stdout + res.stderr
    assert "engine/pyproject.toml" in out
    assert "0.1.2" in out


def test_thieu_tep_version_thi_fail(tmp_path):
    root = make_tree(tmp_path, npm="0.1.2", desktop="0.1.2", pyproject="0.1.2", engine="0.1.2")
    (root / "engine" / "src" / "nexgraph_engine" / "__init__.py").unlink()
    res = run_check(root, "v0.1.2")
    assert res.returncode != 0
    assert "engine/src/nexgraph_engine/__init__.py" in (res.stdout + res.stderr)


def test_khong_co_tag_thi_fail(tmp_path):
    root = make_tree(tmp_path, npm="0.1.2", desktop="0.1.2", pyproject="0.1.2", engine="0.1.2")
    res = run_check(root)
    assert res.returncode != 0
    assert "tag" in (res.stdout + res.stderr).lower()


def test_tag_khong_hop_le_thi_fail(tmp_path):
    root = make_tree(tmp_path, npm="0.1.2", desktop="0.1.2", pyproject="0.1.2", engine="0.1.2")
    res = run_check(root, "v1.2")
    assert res.returncode != 0
