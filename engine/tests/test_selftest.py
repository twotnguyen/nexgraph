from fastapi.testclient import TestClient
from nexgraph_engine.api.app import create_app
from nexgraph_engine.selftest import run_selftest


def test_run_selftest_extracts_nodes():
    result = run_selftest()
    assert result["ok"] is True
    assert result["nodes"] >= 2   # file node + hàm greet


def test_selftest_route():
    c = TestClient(create_app("t" * 40, {"testserver"}))
    r = c.get("/v1/selftest", headers={"Authorization": "Bearer " + "t" * 40})
    assert r.status_code == 200 and r.json()["ok"] is True
