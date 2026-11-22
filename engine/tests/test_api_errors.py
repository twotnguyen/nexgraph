import sqlite3

from fastapi.testclient import TestClient

from nexgraph_engine.schema.db import GRAPH_SCHEMA_VERSION

TOKEN = "t" * 40


def _set_user_version(api, project_id: str, version: int) -> None:
    info = api.app.state.services.registry.get(project_id)
    conn = sqlite3.connect(info.graph_db)
    conn.execute(f"PRAGMA user_version = {version}")
    conn.close()


def _indexed(api, copy_fixture) -> str:
    project_id = api.open(copy_fixture("bookstore_app"))["project_id"]
    assert api.index(project_id)["state"] == "done"
    return project_id


def test_unexpected_error_is_internal_error_without_leaking_details(api):
    @api.app.get("/v1/boom")
    def boom():
        raise RuntimeError("bí mật nội bộ sk-secret")

    # TestClient mặc định ném lại lỗi; tắt để nhận đúng phản hồi mà client HTTP thấy.
    with TestClient(api.app, raise_server_exceptions=False) as client:
        r = client.get("/v1/boom", headers={"Authorization": f"Bearer {TOKEN}"})

    assert r.status_code == 500
    error = r.json()["error"]
    assert error["code"] == "internal_error"
    assert set(error) == {"code", "message"}
    assert "sk-secret" not in error["message"]
    assert "RuntimeError" not in error["message"]


def test_open_store_rejects_newer_schema(api, copy_fixture):
    project_id = _indexed(api, copy_fixture)
    _set_user_version(api, project_id, GRAPH_SCHEMA_VERSION + 1)

    r = api.get(f"/v1/projects/{project_id}/stats")

    assert r.status_code == 400
    assert r.json()["error"]["code"] == "schema_version"


def test_open_store_rejects_outdated_schema(api, copy_fixture):
    project_id = _indexed(api, copy_fixture)
    _set_user_version(api, project_id, GRAPH_SCHEMA_VERSION - 1)

    r = api.get(f"/v1/projects/{project_id}/stats")

    assert r.status_code == 409
    error = r.json()["error"]
    assert error["code"] == "schema_outdated"
    assert error["message"] == ("CSDL đồ thị cũ hơn ứng dụng. Mở lại dự án bằng ứng dụng để nâng cấp.")
