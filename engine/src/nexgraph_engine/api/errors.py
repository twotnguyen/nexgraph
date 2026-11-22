"""Chuyển lỗi nghiệp vụ sang phản hồi HTTP (định nghĩa lỗi nằm ở `nexgraph_engine.errors`)."""
import sqlite3
from pathlib import Path

from fastapi.responses import JSONResponse

from nexgraph_engine.errors import ApiError
from nexgraph_engine.schema.db import SchemaOutdatedError, SchemaVersionError, open_graph_db

__all__ = ["ApiError", "error_response", "open_graph_readonly"]

OUTDATED_MESSAGE = "CSDL đồ thị cũ hơn ứng dụng. Mở lại dự án bằng ứng dụng để nâng cấp."


def error_response(status: int, code: str, message: str, *, job_id: str | None = None) -> JSONResponse:
    error = {"code": code, "message": message}
    if job_id is not None:
        error["job_id"] = job_id
    return JSONResponse({"error": error}, status_code=status)


def open_graph_readonly(path: Path) -> sqlite3.Connection:
    """Mở graph.db chỉ đọc; lỗi phiên bản schema thành ApiError thay vì 500."""
    try:
        return open_graph_db(path, read_only=True)
    except SchemaVersionError as exc:
        raise ApiError(400, "schema_version", str(exc)) from exc
    except SchemaOutdatedError as exc:
        raise ApiError(409, "schema_outdated", OUTDATED_MESSAGE) from exc
