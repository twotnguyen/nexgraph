"""NG-PIPE-1: chạy pipeline của mã vendor trong tiến trình con, huỷ được.

Fixture `graphify_import_app` (4 tệp mã Python/TS) là cùng fixture N1-E1 dùng để đo bộ nạp,
nên đầu ra vendor ở đây so được với `graphify_import_snapshots`.
"""
import json
import os
import shlex
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import pytest

from nexgraph_engine.pipeline import run_pipeline, spawn_and_wait
from nexgraph_engine.pipeline.runner import Step

FIXTURES = Path(__file__).parent / "fixtures"
ARTIFACTS = ("graph.json", "GRAPH_REPORT.md", "graph.html", "GRAPH_TREE.html")


@pytest.fixture
def fixture_root(tmp_path):
    root = tmp_path / "Đồ án" / "pipeline app"
    shutil.copytree(FIXTURES / "graphify_import_app", root)
    return root


def test_pipeline_writes_all_artifacts(fixture_root):
    result = run_pipeline(fixture_root)

    assert result.ok and not result.cancelled
    assert [step.name for step in result.steps] == ["extract", "cluster", "tree", "callflow"]
    assert [step.returncode for step in result.steps] == [0, 0, 0, 0]
    out = fixture_root / ".nexgraph"
    for name in ARTIFACTS:
        assert (out / name).is_file(), name
    callflows = sorted(out.glob("*-callflow.html"))
    assert len(callflows) == 1 and callflows[0].stat().st_size > 1000
    data = json.loads((out / "graph.json").read_text(encoding="utf-8"))
    assert len(data["nodes"]) >= 4 and len(data["links"]) >= 3
    assert (out / "manifest.json").is_file()
    # Tiến trình con không để lại rác: mọi tệp nằm trong `<root>/.nexgraph`.
    assert result.out_dir == (fixture_root / ".nexgraph").resolve()


def test_cancel_kills_child_process(tmp_path):
    """Huỷ giữa chừng: dừng tiến trình con và không để tiến trình mồ côi."""
    cancel = threading.Event()
    argv = [sys.executable, "-c", "import time; print('started', flush=True); time.sleep(60)"]

    result = spawn_and_wait(argv, cwd=tmp_path, on_line=lambda line: cancel.set(), cancel=cancel,
                            timeout=30)

    assert result.cancelled and not result.timed_out
    assert "started" in " ".join(result.tail)
    assert result.child_pid > 0
    if os.name != "nt":
        with pytest.raises(ProcessLookupError):
            os.kill(result.child_pid, 0)


def test_child_cli_runs_vendor_step(fixture_root):
    """Bản đóng gói chạy lại chính binary engine: `pipeline-run` là subcommand của CLI."""
    out = fixture_root / ".nexgraph"
    r = subprocess.run([sys.executable, "-m", "nexgraph_engine.cli", "pipeline-run",
                        "--root", str(fixture_root), "--out", str(out), "extract", ".", "--code-only"],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    assert (out / "graph.json").is_file()
    assert (out / "manifest.json").is_file()


def test_cancelled_pipeline_reports_cancel(fixture_root):
    cancel = threading.Event()
    cancel.set()
    result = run_pipeline(fixture_root, steps=(Step("extract", ("extract", ".", "--code-only")),), cancel=cancel)
    assert result.cancelled and not result.ok
    assert not (fixture_root / ".nexgraph" / "graph.json").exists()


def test_child_env_stops_vendor_reexec(tmp_path, monkeypatch):
    """Vendor tự chạy lại `[sys.executable, "-m", "graphify", ...]` khi thiếu PYTHONHASHSEED.

    Ở bản đóng gói `sys.executable` là binary engine, không hiểu `-m graphify`. Môi trường runner
    đưa cho tiến trình con phải làm vendor bỏ qua bước re-exec này ở mọi lệnh bị ghim seed.
    """
    import graphify.__main__ as vendor_cli

    from nexgraph_engine.pipeline.runner import child_env

    monkeypatch.delenv("PYTHONHASHSEED", raising=False)  # biến có sẵn trên máy sẽ che lỗi của mã cũ
    env = child_env(tmp_path / "out")
    env.pop("PYTEST_CURRENT_TEST", None)  # tiến trình con thật không chạy dưới pytest
    monkeypatch.setattr(os, "environ", env)
    calls = []
    monkeypatch.setattr(vendor_cli, "_reexec", lambda argv, env, windows=None: calls.append(argv))
    for command in sorted(vendor_cli._HASHSEED_PINNED_COMMANDS):
        monkeypatch.setattr(sys, "argv", ["graphify", command, "."])
        vendor_cli._pin_hash_seed_if_needed()
    assert calls == []


@pytest.mark.skipif(os.name == "nt", reason="launcher giả là shell script; Windows do job package kiểm")
def test_frozen_engine_runs_extract_step(fixture_root, tmp_path, monkeypatch):
    """Giả lập bản cài: `sys.executable` là binary `nexgraph-engine` chỉ nhận subcommand của CLI.

    Smoke bộ cài từng đỏ: `invalid choice: 'graphify'` vì vendor re-exec chính binary với `-m graphify`.
    """
    from nexgraph_engine.pipeline.runner import run_step

    launcher = tmp_path / "bin" / "nexgraph-engine"
    launcher.parent.mkdir()
    code = (f"import sys; sys.executable = {str(launcher)!r}; "
            "from nexgraph_engine.interfaces.cli import main; sys.exit(main(sys.argv[1:]))")
    launcher.write_text(f"#!/bin/sh\nexec {shlex.quote(sys.executable)} -c {shlex.quote(code)} \"$@\"\n",
                        encoding="utf-8")
    launcher.chmod(0o755)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(launcher))
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.delenv("PYTHONHASHSEED", raising=False)

    out = fixture_root / ".nexgraph"
    step = run_step(fixture_root, out, Step("extract", ("extract", ".", "--code-only")), timeout=120)

    assert step.returncode == 0, "\n".join(step.tail)
    assert (out / "graph.json").is_file()
