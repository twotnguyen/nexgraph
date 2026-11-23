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
    # Node ghi stdout/stderr bằng UTF-8; phải chỉ định encoding, nếu không Python lấy
    # locale mặc định — trên Windows là code page ANSI (cp1252) nên chuỗi tiếng Việt
    # của script thành mojibake hoặc UnicodeDecodeError (stdout = None).
    return subprocess.run(
        [NODE, str(SCRIPT), *args, "--root", str(root)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="strict",
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


def test_chi_doc_version_trong_bang_project(tmp_path):
    root = make_tree(
        tmp_path,
        npm="0.2.0-alpha.1",
        desktop="0.2.0-alpha.1",
        pyproject="0.2.0a1",
        engine="0.2.0a1",
    )
    # Bảng khác đứng trước [project] với version lệch: không được lấy nhầm version của bảng đó.
    (root / "engine" / "pyproject.toml").write_text(
        "[tool.example]\n"
        'version = "0.2.0a1"\n'
        "\n"
        "[project]\n"
        'name = "nexgraph-engine"\n'
        'version = "0.2.0a0"\n',
        encoding="utf-8",
    )
    res = run_check(root, "v0.2.0-alpha.1")
    assert res.returncode != 0, res.stdout + res.stderr
    out = res.stdout + res.stderr
    assert "engine/pyproject.toml" in out
    assert "0.2.0a0" in out


def test_bo_qua_version_o_bang_khac(tmp_path):
    root = make_tree(
        tmp_path,
        npm="0.2.0-alpha.1",
        desktop="0.2.0-alpha.1",
        pyproject="0.2.0a1",
        engine="0.2.0a1",
    )
    (root / "engine" / "pyproject.toml").write_text(
        '[tool.example]\nversion = "9.9.9"\n\n[project]\nname = "nexgraph-engine"\nversion = "0.2.0a1"\n',
        encoding="utf-8",
    )
    res = run_check(root, "v0.2.0-alpha.1")
    assert res.returncode == 0, res.stdout + res.stderr


def test_doc_version_bang_toml_parser_chuan(tmp_path):
    # Review vòng 3 (Important 3): chuỗi literal nhiều dòng của `description` chứa
    # `version = "0.2.0rc3"`; version thật của [project] là 0.2.0rc2. Parser theo
    # dòng đọc nhầm chuỗi trong description nên báo 4/4 OK; TOML parser chuẩn
    # (tomllib) phải thấy 0.2.0rc2 và chặn tag v0.2.0-rc.3.
    root = make_tree(
        tmp_path,
        npm="0.2.0-rc.3",
        desktop="0.2.0-rc.3",
        pyproject="0.2.0rc3",
        engine="0.2.0rc3",
    )
    (root / "engine" / "pyproject.toml").write_text(
        "[project]\n"
        'name = "fixture"\n'
        "description = '''\n"
        "Ví dụ cấu hình:\n"
        'version = "0.2.0rc3"\n'
        "'''\n"
        'version = "0.2.0rc2"\n',
        encoding="utf-8",
    )
    res = run_check(root, "v0.2.0-rc.3")
    assert res.returncode != 0, res.stdout + res.stderr
    out = res.stdout + res.stderr
    assert "engine/pyproject.toml" in out
    assert "0.2.0rc2" in out
    assert "OK: tag" not in res.stdout


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


@pytest.mark.parametrize(
    ("tag", "suggestion"),
    [
        ("v0.2.0a1", "v0.2.0-alpha.1"),
        ("v0.2.0b2", "v0.2.0-beta.2"),
        ("v0.2.0rc1", "v0.2.0-rc.1"),
    ],
)
def test_tag_pep440_bi_tu_choi_kem_goi_y_semver(tmp_path, tag, suggestion):
    # Tag phát hành phải là semver; PEP 440 chỉ dùng trong pyproject/__init__ của engine.
    root = make_tree(
        tmp_path,
        npm="0.2.0-alpha.1",
        desktop="0.2.0-alpha.1",
        pyproject="0.2.0a1",
        engine="0.2.0a1",
    )
    res = run_check(root, tag)
    assert res.returncode != 0, res.stdout + res.stderr
    out = res.stdout + res.stderr
    assert "không hợp lệ" in out
    assert suggestion in out
    assert "OK: tag" not in res.stdout


def test_tag_khong_hop_le_thi_fail(tmp_path):
    root = make_tree(tmp_path, npm="0.1.2", desktop="0.1.2", pyproject="0.1.2", engine="0.1.2")
    res = run_check(root, "v1.2")
    assert res.returncode != 0
    out = res.stdout + res.stderr
    # Khẳng định chẩn đoán chứ không chỉ mã thoát: thiếu script cũng làm Node trả mã khác 0.
    assert "không hợp lệ" in out
    assert "v1.2" in out
    assert "vX.Y.Z" in out


@pytest.mark.parametrize(
    ("tag", "version"),
    [
        # SemVer: numeric identifier không được có số 0 thừa (pre-release lẫn core).
        ("v0.2.0-alpha.01", "0.2.0-alpha.01"),
        ("v01.2.3", "01.2.3"),
    ],
)
def test_tu_choi_so_0_thua_theo_semver(tmp_path, tag, version):
    # Manifest khớp y nguyên tag: parser cũ (regex \d+) cho qua, exit 0.
    root = make_tree(tmp_path, npm=version, desktop=version, pyproject=version, engine=version)
    res = run_check(root, tag)
    assert res.returncode != 0, res.stdout + res.stderr
    out = res.stdout + res.stderr
    assert "không hợp lệ" in out
    assert tag in out
    assert "OK: tag" not in res.stdout


def test_so_npm_nguyen_van_khong_trim(tmp_path):
    # Hai nguồn npm có khoảng trắng thừa: phải so nguyên văn với tag (bỏ đúng `v`),
    # không trim — trước đây trim nên vẫn báo 4/4 OK.
    root = make_tree(tmp_path, npm=" 0.2.0 ", desktop=" 0.2.0 ", pyproject="0.2.0", engine="0.2.0")
    res = run_check(root, "v0.2.0")
    assert res.returncode != 0, res.stdout + res.stderr
    out = res.stdout + res.stderr
    assert "package.json" in out
    assert "apps/desktop/package.json" in out
    assert out.count("LỆCH") == 2
    assert "OK: tag" not in res.stdout
