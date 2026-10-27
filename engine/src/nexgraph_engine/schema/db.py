"""Mở CSDL SQLite của NexGraph (đồ thị theo project và cá nhân theo ứng dụng)."""
import sqlite3
from importlib import resources
from pathlib import Path
from typing import Literal

SCHEMA_VERSION = 1
MIN_SQLITE = (3, 43, 0)  # FTS5 contentless_delete


class SchemaVersionError(RuntimeError):
    """CSDL do phiên bản NexGraph mới hơn tạo ra."""


class UnsupportedSqliteError(RuntimeError):
    """SQLite của Python đang chạy quá cũ."""


def load_sql(name: Literal["graph", "app"]) -> str:
    return resources.files("nexgraph_engine.schema").joinpath(f"{name}.sql").read_text(encoding="utf-8")


def _open(path: Path, sql_name: Literal["graph", "app"], *, read_only: bool, wal: bool) -> sqlite3.Connection:
    if sqlite3.sqlite_version_info < MIN_SQLITE:
        raise UnsupportedSqliteError(
            f"SQLite {sqlite3.sqlite_version} quá cũ, cần >= {'.'.join(map(str, MIN_SQLITE))}"
        )
    if read_only:
        conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > SCHEMA_VERSION:
        conn.close()
        raise SchemaVersionError(f"CSDL phiên bản {version}, ứng dụng chỉ hỗ trợ đến {SCHEMA_VERSION}")
    if version == 0 and not read_only:
        conn.executescript(load_sql(sql_name))
    if wal and not read_only:
        conn.execute("PRAGMA journal_mode = WAL")
    return conn


def open_graph_db(path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    return _open(path, "graph", read_only=read_only, wal=True)


def open_app_db(path: Path) -> sqlite3.Connection:
    return _open(path, "app", read_only=False, wal=True)
