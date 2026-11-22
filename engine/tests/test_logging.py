"""E5/REV-20: engine có logging ra stderr, mức theo `NEXGRAPH_LOG_LEVEL`, không log secret."""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import time

import pytest

from nexgraph_engine.api.routes_projects import _last_run
from nexgraph_engine.index.events import EventBus
from nexgraph_engine.index.jobs import JobManager
from nexgraph_engine.logging_setup import configure_logging, level_from_env, reset_logging
from nexgraph_engine.store.projects import ProjectInfo


@pytest.fixture(autouse=True)
def _clean_engine_logger():
    reset_logging()
    yield
    reset_logging()


def _env(**extra: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env.update(extra)
    return env


def _wait(manager: JobManager, job_id: str, timeout: float = 20) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        job = manager.get(job_id)
        if job is not None and job["state"] in ("done", "error", "cancelled"):
            return job
        time.sleep(0.01)
    raise AssertionError("job không kết thúc")


def test_configure_logs_to_stderr_not_stdout(capsys):
    logger = configure_logging()
    logger.info("xin chào engine")
    out, err = capsys.readouterr()
    assert out == ""
    assert "xin chào engine" in err
    assert "INFO" in err and "nexgraph_engine" in err


def test_single_handler_when_configured_twice():
    configure_logging()
    configure_logging()
    assert len(logging.getLogger("nexgraph_engine").handlers) == 1


def test_level_from_environment(monkeypatch, capsys):
    monkeypatch.setenv("NEXGRAPH_LOG_LEVEL", "WARNING")
    logger = configure_logging()
    assert logger.level == logging.WARNING
    logger.info("ẩn")
    logger.warning("hiện")
    _, err = capsys.readouterr()
    assert "ẩn" not in err
    assert "hiện" in err


def test_level_defaults_to_info_and_ignores_garbage(monkeypatch):
    monkeypatch.delenv("NEXGRAPH_LOG_LEVEL", raising=False)
    assert level_from_env() == logging.INFO
    assert level_from_env("khong-phai-muc") == logging.INFO
    assert level_from_env("debug") == logging.DEBUG
    assert level_from_env("20") == logging.INFO


def test_import_does_not_configure_logging():
    code = ("import logging, nexgraph_engine.index.jobs, nexgraph_engine.api.app;"
            "print(len(logging.getLogger('nexgraph_engine').handlers))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, env=_env(), timeout=120)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "0"


def test_cli_mcp_logs_to_stderr_and_keeps_stdout_clean(tmp_path):
    """stdout của lệnh `mcp` là giao thức: log chỉ được ra stderr."""
    r = subprocess.run([sys.executable, "-m", "nexgraph_engine.cli", "mcp", "--project", str(tmp_path / "chua-index")],
                       capture_output=True, text=True, env=_env(NEXGRAPH_LOG_LEVEL="INFO"), timeout=120)
    assert r.returncode == 3, r.stderr
    assert r.stdout == ""
    assert "nexgraph_engine" in r.stderr and "INFO" in r.stderr


def test_failed_job_logs_error_with_traceback(caplog):
    manager = JobManager(None, EventBus())

    def work(_ctx):
        raise RuntimeError("hỏng job semantic")

    caplog.set_level(logging.DEBUG, logger="nexgraph_engine")
    job = _wait(manager, manager.start_task(None, "semantic", work))
    assert job["state"] == "error"
    records = [r for r in caplog.records if r.levelno >= logging.ERROR and "thất bại" in r.getMessage()]
    assert records, [r.getMessage() for r in caplog.records]
    assert records[0].exc_info is not None
    assert "hỏng job semantic" in str(records[0].exc_info[1])
    manager.shutdown()


def test_readable_graph_failure_is_logged_not_silent(tmp_path, caplog):
    """`_last_run` từng nuốt lỗi: dự án hỏng `graph.db` hiện như chưa lập chỉ mục, không dấu vết."""
    db = tmp_path / "graph.db"
    db.write_bytes(b"khong phai sqlite")
    info = ProjectInfo("p1", tmp_path, "p1", False, "in_project", db, 0)
    caplog.set_level(logging.WARNING, logger="nexgraph_engine")
    assert _last_run(info) == (None, None)
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings and warnings[0].exc_info is not None
    assert "graph.db" in warnings[0].getMessage()


def test_authorization_token_never_logged(api, caplog):
    secret = "sk-" + "9" * 40
    caplog.set_level(logging.DEBUG, logger="nexgraph_engine")
    response = api.client.get("/v1/projects", headers={"Authorization": f"Bearer {secret}"})
    assert response.status_code == 401
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "unauthorized" in text
    assert secret not in text
    assert secret not in response.text
