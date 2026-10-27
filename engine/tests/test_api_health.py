from fastapi.testclient import TestClient
from nexgraph_engine import VENDOR_COMMIT, __version__
from nexgraph_engine.api.app import create_app

TOKEN = "t" * 40


def client():
    return TestClient(create_app(TOKEN, {"testserver"}))


def test_health_ok_with_token():
    r = client().get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "api_version": "1",
                        "engine_version": __version__, "vendor_commit": VENDOR_COMMIT}


def test_rejects_missing_or_wrong_token():
    c = client()
    assert c.get("/v1/health").status_code == 401
    r = c.get("/v1/health", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_rejects_foreign_host():
    r = client().get("/v1/health", headers={"Authorization": f"Bearer {TOKEN}", "Host": "evil.com"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden_host"
