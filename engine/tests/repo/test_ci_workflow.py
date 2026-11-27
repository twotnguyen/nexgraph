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


REQUIRED_MATRIX_JOBS = ("engine", "desktop", "package")
FLAG = {"engine": "engine", "desktop": "desktop", "package": "package"}


def test_required_jobs_never_skipped_at_job_level():
    """CI-02: `if` ở cấp job làm job matrix bị bỏ, check `engine (macos-latest)`… không bao giờ có kết quả và PR kẹt.
    Bộ lọc theo tệp đổi chỉ được đặt ở từng bước."""
    jobs = _jobs()
    for name in (*REQUIRED_MATRIX_JOBS, "lint", "module-rules"):
        assert "if" not in jobs[name], name
    for name in REQUIRED_MATRIX_JOBS:
        assert "changes" in _needs(jobs[name]), name


def test_changes_job_runs_everything_outside_pull_requests():
    """Push lên main/tag luôn chạy đủ: thứ lọt bộ lọc của PR bị bắt trên commit merge, release luôn có đủ bộ cài."""
    jobs = _jobs()
    pick = next(s for s in jobs["changes"]["steps"] if s.get("id") == "pick")
    assert "node tools/ci/changes.mjs --all" in pick["run"]
    assert '[ "$EVENT" = pull_request ]' in pick["run"]
    assert set(jobs["changes"]["outputs"]) == {"engine", "desktop", "package", "labs"}
    assert (WORKFLOW.parents[2] / "tools" / "ci" / "changes.mjs").is_file()


def test_every_heavy_step_is_gated_by_changes():
    """Bước nào không có điều kiện thì vẫn chạy khi PR không cần nó; bước nào thiếu thì bị bỏ cả trên main."""
    exempt = ("Tắt quét thời gian thực của Defender", "Tag phải khớp version ở 4 nguồn")
    jobs = _jobs()
    for job in REQUIRED_MATRIX_JOBS:
        flag = f"needs.changes.outputs.{FLAG[job]}"
        for step in jobs[job]["steps"]:
            label = step.get("name") or step.get("uses") or step.get("run")
            if label in exempt:
                continue
            assert flag in step.get("if", ""), f"{job}: {label}"


def test_engine_tests_run_in_parallel():
    runs = [s.get("run", "") for s in _jobs()["engine"]["steps"]]
    assert any(r.startswith("uv run --locked pytest tests -q -n auto") for r in runs)
    pyproject = (WORKFLOW.parents[2] / "engine" / "pyproject.toml").read_text(encoding="utf-8")
    assert "pytest-xdist" in pyproject


def test_defender_step_only_on_windows_and_never_fails_the_job():
    for job in REQUIRED_MATRIX_JOBS:
        step = next(s for s in _jobs()[job]["steps"] if s.get("name") == "Tắt quét thời gian thực của Defender")
        assert step["if"].startswith("runner.os == 'Windows'"), job
        assert step["continue-on-error"] is True, job


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
