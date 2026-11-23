"""Chuyển lỗi nghiệp vụ sang phản hồi HTTP (định nghĩa lỗi nằm ở `nexgraph_engine.errors`)."""
import errno
import sqlite3
from pathlib import Path

from fastapi.responses import JSONResponse

from nexgraph_engine.errors import ApiError
from nexgraph_engine.schema.db import SchemaOutdatedError, SchemaVersionError, open_graph_db
from nexgraph_engine.store.publication import GraphWriteBusy, is_busy_error

__all__ = ["ApiError", "error_response", "graph_error", "http_code", "open_graph_readonly"]

OUTDATED_MESSAGE = "CSDL đồ thị cũ hơn ứng dụng. Mở lại dự án bằng ứng dụng để nâng cấp."
INTERNAL_MESSAGE = "Lỗi nội bộ engine. Xem log để biết chi tiết."
# Mã ổn định cho desktop dịch (MIN-47-eng): câu tiếng Việt vẫn giữ nguyên cho client cũ.
GRAPH_READONLY_MESSAGE = "Không ghi được CSDL đồ thị: tệp đang chỉ đọc hoặc thiếu quyền ghi."
GRAPH_UNAVAILABLE_MESSAGE = "Không mở được CSDL đồ thị: thiếu tệp hoặc không mở được đường dẫn."
GRAPH_BUSY_MESSAGE = "Đồ thị đang được cập nhật bởi tiến trình khác. Thử lại sau."
_UNAVAILABLE_MARKERS = ("unable to open database file",)
_READONLY_MARKERS = ("readonly", "read-only", "permission denied",
                     "access is denied", "operation not permitted")
_HTTP_CODES = {404: "not_found", 405: "method_not_allowed"}


def error_response(status: int, code: str, message: str, *, job_id: str | None = None) -> JSONResponse:
    error = {"code": code, "message": message}
    if job_id is not None:
        error["job_id"] = job_id
    return JSONResponse({"error": error}, status_code=status)


def http_code(status: int) -> str:
    """Mã lỗi cho `HTTPException`: 404/405 có mã riêng thay vì bucket `http_error`."""
    return _HTTP_CODES.get(status, "http_error")


def graph_error(exc: BaseException) -> ApiError | None:
    """Lỗi CSDL đồ thị đã biết → `ApiError` có mã ổn định, để desktop dịch câu thay vì hiện tiếng Việt.

    Đường refresh/watch của desktop chỉ nhận `code`/`message` của engine (MIN-47-eng); lỗi ghi CSDL
    (tệp chỉ đọc, khoá ghi, schema mới hơn) phải phân biệt được thay vì gộp vào `internal_error`.
    Thông điệp là câu cố định: không lộ đường dẫn hay chi tiết SQLite ra ngoài.
    """
    if isinstance(exc, SchemaVersionError):
        return ApiError(400, "schema_version", str(exc))
    if isinstance(exc, SchemaOutdatedError):
        return ApiError(409, "schema_outdated", OUTDATED_MESSAGE)
    if isinstance(exc, GraphWriteBusy):
        return ApiError(409, "graph_busy", GRAPH_BUSY_MESSAGE)
    if isinstance(exc, sqlite3.OperationalError):
        if is_busy_error(exc):
            return ApiError(409, "graph_busy", GRAPH_BUSY_MESSAGE)
        text = str(exc).lower()
        if any(marker in text for marker in _UNAVAILABLE_MARKERS):
            return ApiError(503, "graph_unavailable", GRAPH_UNAVAILABLE_MESSAGE)
        if any(marker in text for marker in _READONLY_MARKERS):
            return ApiError(409, "graph_readonly", GRAPH_READONLY_MESSAGE)
        return None
    if isinstance(exc, OSError) and exc.errno in (errno.EACCES, errno.EPERM, errno.EROFS):
        # Chỉ lỗi quyền ghi trên chính graph.db mới là "CSDL đồ thị chỉ đọc"; lỗi quyền ở transcript,
        # tệp nguồn hay thư mục tạm không được báo sai đối tượng (MIN-48).
        filename = getattr(exc, "filename", None)
        if filename and Path(filename).name == "graph.db":
            return ApiError(409, "graph_readonly", GRAPH_READONLY_MESSAGE)
        return None
    return None


def open_graph_readonly(path: Path) -> sqlite3.Connection:
    """Mở graph.db chỉ đọc; lỗi phiên bản schema thành ApiError thay vì 500."""
    try:
        return open_graph_db(path, read_only=True)
    except SchemaVersionError as exc:
        raise ApiError(400, "schema_version", str(exc)) from exc
    except SchemaOutdatedError as exc:
        raise ApiError(409, "schema_outdated", OUTDATED_MESSAGE) from exc
