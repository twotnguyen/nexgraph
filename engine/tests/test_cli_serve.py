import json
import os
import subprocess
import sys
import urllib.request

import pytest

TOKEN = "k" * 40


def start(data_dir, token=TOKEN):
    env = {**os.environ, "NEXGRAPH_TOKEN": token} if token else {k: v for k, v in os.environ.items() if k != "NEXGRAPH_TOKEN"}
    return subprocess.Popen([sys.executable, "-m", "nexgraph_engine.cli", "serve", "--data-dir", str(data_dir), "--port", "0"],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", env=env)


def read_ready(p):
    for line in p.stdout:
        line = line.strip()
        if line.startswith("{") and json.loads(line).get("event") == "ready":
            return json.loads(line)
    pytest.fail("no ready line")


def test_serve_prints_ready_and_serves_health(tmp_path):
    p = start(tmp_path / "data")
    try:
        ready = read_ready(p)
        assert ready["pid"] == p.pid
        req = urllib.request.Request(f"http://127.0.0.1:{ready['port']}/v1/health",
                                     headers={"Authorization": f"Bearer {TOKEN}"})
        assert json.load(urllib.request.urlopen(req, timeout=5))["status"] == "ok"
        assert (tmp_path / "data").is_dir()
    finally:
        p.kill()


def test_serve_accepts_unicode_data_dir(tmp_path):
    d = tmp_path / "Đồ án ứng dụng" / "dữ liệu"
    p = start(d)
    try:
        read_ready(p)
        assert d.is_dir()
    finally:
        p.kill()


def test_serve_requires_token(tmp_path):
    p = start(tmp_path, token=None)
    assert p.wait(timeout=20) == 2
    assert "NEXGRAPH_TOKEN is required (>=32 chars)" in p.stderr.read()
