import json
import os
import shutil
import subprocess
import sys

import pytest

pytestmark = pytest.mark.skipif(shutil.which("git") is None, reason="cần git trong PATH")


def _cli(*args):
    return subprocess.run([sys.executable, "-m", "nexgraph_engine.cli", "refresh", *args], capture_output=True, text=True,
                          env={**os.environ, "PYTHONIOENCODING": "utf-8"})


def test_refresh_after_edit_reports_change(api, copy_fixture, tmp_path):
    root = copy_fixture("py_mini")
    pid = api.open(root)["project_id"]
    assert api.index(pid)["state"] == "done"
    (root / "util.py").write_text("def helper(x):\n    return x * 3\n")
    r = _cli("--project", str(root), "--data-dir", str(tmp_path / "appdata"))
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["status"] == "ok" and out["changed"] == 1
    assert json.loads(_cli("--project", str(root), "--data-dir", str(tmp_path / "appdata")).stdout)["changed"] == 0


def test_refresh_unindexed_project_exits_3(api, copy_fixture, tmp_path):
    root = copy_fixture("py_mini")
    r = _cli("--project", str(root), "--data-dir", str(tmp_path / "appdata"))
    assert r.returncode == 3 and "chưa được lập chỉ mục" in r.stderr
