"""Lỗi nghiệp vụ dùng chung giữa API, MCP và tầng domain.

Không phụ thuộc FastAPI để tầng domain (`query/`, `flows/`, `report/`, `mcp/`) không phải import ngược vào `api/`.
"""
from __future__ import annotations


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
