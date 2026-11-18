"""Chuyển lỗi nghiệp vụ sang phản hồi HTTP (định nghĩa lỗi nằm ở `nexgraph_engine.errors`)."""
from fastapi.responses import JSONResponse

from nexgraph_engine.errors import ApiError

__all__ = ["ApiError", "error_response"]


def error_response(status: int, code: str, message: str, *, job_id: str | None = None) -> JSONResponse:
    error = {"code": code, "message": message}
    if job_id is not None:
        error["job_id"] = job_id
    return JSONResponse({"error": error}, status_code=status)
