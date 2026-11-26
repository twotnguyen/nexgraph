from fastapi.testclient import TestClient
from nexgraph_engine.interfaces.api.app import create_app
from nexgraph_engine.interfaces.selftest import run_selftest


def test_run_selftest_extracts_nodes():
    result = run_selftest()
    assert result["ok"] is True
    assert result["nodes"] >= 2   # file node + hàm greet


def test_selftest_route():
    c = TestClient(create_app("t" * 40, {"testserver"}))
    r = c.get("/v1/selftest", headers={"Authorization": "Bearer " + "t" * 40})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_selftest_reports_supported_sqlite():
    r = run_selftest()
    assert tuple(int(x) for x in r["sqlite"].split(".")[:3]) >= (3, 43, 0)


def test_selftest_lists_loaded_grammars():
    # Bộ cài Windows/macOS thiếu grammar thì selftest phải nói ra, không mất ngôn ngữ âm thầm (W2).
    r = run_selftest()
    assert {"tree_sitter_python", "tree_sitter_sql", "tree_sitter_pascal", "tree_sitter_hcl",
            "tree_sitter_language_pack", "robot"} <= set(r["grammars"])
    assert r["missing_grammars"] == [] or r["missing_grammars"] == ["tree_sitter_vb_dotnet"]
