"""Cấu hình logging của engine (E5/REV-20).

Chỉ `cli.main` gọi `configure_logging()`; import mô-đun không đụng cấu hình logging toàn cục để test và
thư viện nhúng không bị ảnh hưởng. Handler ghi ra **stderr** vì stdout của lệnh `mcp` là giao thức MCP stdio.
"""
from __future__ import annotations

import logging
import os
import sys

PACKAGE = "nexgraph_engine"
DEFAULT_LEVEL = "INFO"
FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
_HANDLER_ATTR = "_nexgraph_stderr_handler"


def level_from_env(value: str | int | None = None) -> int:
    """Mức log từ `NEXGRAPH_LOG_LEVEL` (tên chuẩn hoặc số); sai/thiếu thì INFO."""
    if isinstance(value, int):
        return value
    raw = value if value is not None else os.environ.get("NEXGRAPH_LOG_LEVEL")
    name = (raw or DEFAULT_LEVEL).strip().upper()
    level = logging.getLevelNamesMapping().get(name)
    if level is None:
        try:
            level = int(name)
        except ValueError:
            return logging.INFO
    return level


def configure_logging(level: str | int | None = None, *, stream=None) -> logging.Logger:
    """Gắn handler stderr cho logger `nexgraph_engine` (gọi nhiều lần vẫn một handler)."""
    logger = logging.getLogger(PACKAGE)
    handler = getattr(logger, _HANDLER_ATTR, None)
    if handler is None:
        handler = logging.StreamHandler(sys.stderr if stream is None else stream)
        handler.setFormatter(logging.Formatter(FORMAT))
        setattr(logger, _HANDLER_ATTR, handler)
        logger.addHandler(handler)
    logger.setLevel(level_from_env(level))
    return logger


def reset_logging() -> None:
    """Gỡ handler đã gắn (dùng cho test); không đổi mức của logger."""
    logger = logging.getLogger(PACKAGE)
    handler = getattr(logger, _HANDLER_ATTR, None)
    if handler is not None:
        logger.removeHandler(handler)
        delattr(logger, _HANDLER_ATTR)
