import sqlite3

from fastapi.testclient import TestClient

from nexgraph_engine.schema.db import GRAPH_SCHEMA_VERSION

TOKEN = "t" * 40
INTERNAL_ERROR_MESSAGE = "Lỗi nội bộ engine. Xem log để biết chi tiết."
OUTDATED_MESSAGE = "CSDL đồ thị cũ hơn ứng dụng. Mở lại dự án bằng ứng dụng để nâng cấp."
GRAPH_READONLY_MESSAGE = "Không ghi được CSDL đồ thị: tệp đang chỉ đọc hoặc thiếu quyền ghi."


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
    # Contract lỗi v1: đúng một khoá top-level "error", trong đó đúng "code" và "message".
    assert r.json() == {"error": {"code": "internal_error", "message": INTERNAL_ERROR_MESSAGE}}
    assert "sk-secret" not in r.text
    assert "RuntimeError" not in r.text


def test_refresh_of_newer_graph_reports_schema_version_code(api, copy_fixture):
    """MIN-47-eng: đường refresh/watch phải trả `code` ổn định, không chỉ câu tiếng Việt chung."""
    project_id = _indexed(api, copy_fixture)
    _set_user_version(api, project_id, GRAPH_SCHEMA_VERSION + 1)

    with TestClient(api.app, raise_server_exceptions=False) as client:
        r = client.post(f"/v1/projects/{project_id}/refresh", headers={"Authorization": f"Bearer {TOKEN}"})

    assert r.status_code == 400
    assert r.json() == {"error": {
        "code": "schema_version",
        "message": f"CSDL phiên bản {GRAPH_SCHEMA_VERSION + 1}, ứng dụng chỉ hỗ trợ đến {GRAPH_SCHEMA_VERSION}",
    }}


def test_refresh_on_readonly_graph_reports_graph_readonly_code(api, copy_fixture, monkeypatch):
    """`chmod 444 graph.db` (toast lỗi refresh nền của desktop) phải có mã riêng để desktop dịch."""
    import nexgraph_engine.index.refresh_service as refresh_service

    project_id = _indexed(api, copy_fixture)

    def readonly_open(path, *, read_only=False):
        raise sqlite3.OperationalError("attempt to write a readonly database")

    monkeypatch.setattr(refresh_service, "open_graph_db", readonly_open)
    with TestClient(api.app, raise_server_exceptions=False) as client:
        r = client.post(f"/v1/projects/{project_id}/refresh", headers={"Authorization": f"Bearer {TOKEN}"})

    assert r.status_code == 409
    assert r.json() == {"error": {"code": "graph_readonly", "message": GRAPH_READONLY_MESSAGE}}
    assert "Lỗi nội bộ engine" not in r.text
    # Không lộ câu kỹ thuật của SQLite ra ngoài (thông điệp cố định).
    assert "attempt to write" not in r.text


def test_method_not_allowed_has_stable_code(api):
    """Lỗi HTTP chung cũng phải có mã riêng thay vì bucket `http_error`."""
    r = api.delete("/v1/health")

    assert r.status_code == 405
    assert r.json()["error"]["code"] == "method_not_allowed"


def test_graph_error_maps_oserror_only_for_graph_db():
    """MIN-48: OSError ở bất kỳ route nào từng bị dán nhãn `graph_readonly`; chỉ lỗi trên graph.db mới đúng."""
    import errno

    from nexgraph_engine.api.errors import graph_error
    from nexgraph_engine.schema.db import SchemaOutdatedError
    from nexgraph_engine.store.publication import GraphWriteBusy

    def code_of(exc: BaseException) -> str | None:
        mapped = graph_error(exc)
        return None if mapped is None else mapped.code

    assert code_of(sqlite3.OperationalError("database is locked")) == "graph_busy"
    assert code_of(GraphWriteBusy("bận")) == "graph_busy"
    assert code_of(OSError(errno.EROFS, "Read-only file system", "/data/p/.nexgraph/graph.db")) == "graph_readonly"
    assert code_of(OSError(errno.EACCES, "Permission denied", "/data/p/.nexgraph/graph.db")) == "graph_readonly"
    # Lỗi quyền ghi ở transcript/tệp nguồn không phải CSDL đồ thị: giữ 500 để không báo sai đối tượng.
    assert code_of(OSError(errno.EACCES, "Permission denied", "/data/transcripts/p/2026.jsonl")) is None
    assert code_of(OSError(errno.EROFS, "Read-only file system")) is None
    assert code_of(SchemaOutdatedError("cũ")) == "schema_outdated"
    assert code_of(sqlite3.OperationalError("no such table: nut")) is None
    assert code_of(RuntimeError("bí mật")) is None


def test_graph_unavailable_code_for_unopenable_database():
    """MIN-48: 'unable to open database file' là thiếu tệp/đường dẫn, không phải 'tệp chỉ đọc'."""
    from nexgraph_engine.api.errors import graph_error

    mapped = graph_error(sqlite3.OperationalError("unable to open database file"))
    assert mapped is not None
    assert (mapped.status, mapped.code) == (503, "graph_unavailable")
    assert "chỉ đọc" not in mapped.message
    assert mapped.message == "Không mở được CSDL đồ thị: thiếu tệp hoặc không mở được đường dẫn."


def test_open_store_rejects_newer_schema(api, copy_fixture):
    project_id = _indexed(api, copy_fixture)
    _set_user_version(api, project_id, GRAPH_SCHEMA_VERSION + 1)

    r = api.get(f"/v1/projects/{project_id}/stats")

    assert r.status_code == 400
    assert r.json() == {"error": {
        "code": "schema_version",
        "message": f"CSDL phiên bản {GRAPH_SCHEMA_VERSION + 1}, ứng dụng chỉ hỗ trợ đến {GRAPH_SCHEMA_VERSION}",
    }}


def test_open_store_rejects_outdated_schema(api, copy_fixture):
    project_id = _indexed(api, copy_fixture)
    _set_user_version(api, project_id, GRAPH_SCHEMA_VERSION - 1)

    r = api.get(f"/v1/projects/{project_id}/stats")

    assert r.status_code == 409
    assert r.json() == {"error": {"code": "schema_outdated", "message": OUTDATED_MESSAGE}}
