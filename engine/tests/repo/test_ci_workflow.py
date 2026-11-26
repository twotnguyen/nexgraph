"""Bất biến của .github/workflows/ci.yml (CI-1, phần an toàn tách từ #75).

`package` chạy song song với test để rút đường găng CI của mọi PR (13 → ~7,5 phút), nhưng
phát hành vẫn chỉ xảy ra khi test xanh: `release` phải chờ `engine`, `desktop` và `package`.
Tên 8 check bắt buộc của ruleset `main-guard` không được đổi (7 job + `module-rules`, ADR 0026 pha 4e).
"""

from pathlib import Path

import yaml

WORKFLOW = Path(__file__).resolve().parents[3] / ".github" / "workflows" / "ci.yml"


def _jobs() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))["jobs"]


def _needs(job: dict) -> set[str]:
    needs = job.get("needs") or []
    return {needs} if isinstance(needs, str) else set(needs)


def test_package_runs_in_parallel_with_tests():
    assert _needs(_jobs()["package"]) & {"engine", "desktop"} == set()


def test_release_still_waits_for_tests_and_package():
    release = _jobs()["release"]
    assert {"version-check", "engine", "desktop", "package"} <= _needs(release)
    assert release["if"] == "startsWith(github.ref, 'refs/tags/v')"


def test_required_check_names_unchanged():
    jobs = _jobs()
    assert jobs["lint"]["name"] == "lint"
    for job in ("engine", "desktop", "package"):
        assert jobs[job]["name"] == f"{job} (${{{{ matrix.os }}}})"
        assert jobs[job]["strategy"]["matrix"]["os"] == ["macos-latest", "windows-latest"]
    assert jobs["module-rules"]["name"] == "module-rules"


def test_module_rules_job_blocks():
    """ADR 0026 pha 4e: luật phụ thuộc là check bắt buộc thứ 8 (`module-rules`), chạy chế độ chặn, release chờ nó."""
    jobs = _jobs()
    job = jobs["module-rules"]
    assert job["name"] == "module-rules"
    runs = [s.get("run", "") for s in job["steps"]]
    assert "pnpm rules:strict" in runs
    assert "pnpm rules:report" not in runs
    assert "module-rules" in _needs(jobs["release"])


def test_labs_job_reports_without_gating():
    """ADR 0026 pha 1: labs/ (Code-OSS thử nghiệm) có job riêng, không thuộc check bắt buộc, không chặn phát hành."""
    jobs = _jobs()
    job = jobs["labs"]
    assert job["name"] not in {"lint", "engine", "desktop", "package", "module-rules"}
    runs = [s.get("run", "") for s in job["steps"]]
    assert "pnpm --dir labs/extension test" in runs
    assert "labs" not in _needs(jobs["release"])
    desktop_runs = " ".join(s.get("run", "") for s in jobs["desktop"]["steps"])
    assert "extension" not in desktop_runs
